// نظام ملائم العقاري — وظيفة الاستخراج agent-run (الجولة B من docs/TASK_AGENT.md، والموجّه من docs/TASK_ROUTER.md)
//
// ثلاثة أفعال:
//   status — للمستخدم المسجَّل: هل الاستخراج مفعَّل (هل ضُبط OPENROUTER_API_KEY)؟
//   run    — للمستخدم الذي يرى الطلب: يبدأ التنفيذ ويعود فوراً؛ العمل يكمل في الخلفية.
//   sweep  — لمهمة pg_cron فقط (سر في Vault): يعيد استدعاء الطلبات العالقة، ويذكر أسماء
//            الإعدادات المضبوطة (الأسماء فقط، لا القيم).
//
// ما لا تفعله هذه الوظيفة أبداً: الكتابة في projects / clients / client_requirements.
// تكتب مسودات في agent_drafts وحالة الطلب وسجل النداءات فقط؛ الاعتماد في Postgres (agent_apply_draft).
// المفتاح يُقرأ من أسرار Supabase ولا يغادر هذه الوظيفة إلا إلى OpenRouter، ولا يُطبع ولا يُسجَّل.
//
// كل طلب يمر على موجّه الجهد (_shared/effort-router): السريعة أولاً (DeepSeek V4.1 Flash)، ثم
// السريعة بالتفكير، ثم التصعيد إلى Astra (فشل استدلالي) أو Opus (غيره). الجوالات والبريد تُخفى من
// النصوص قبل كل نداء وتُعاد في المسودات. سقف يومي للإنفاق وللتصعيد قبل كل نداء.
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  type AttemptOutcome, chat, ChatError, type ChatMessage, type ChatPart, type ChatResult, CODE_CLASS, classifyFailure,
  DEFAULT_MAX_REJECT_RATIO, DEFAULT_REASONING_THRESHOLD, defaultTiers, type Effort, firstStep, isFailure, nextStep,
  parseJson, reasoningFor, Redactor, resumeLadder, scoreEffort, shouldSaveLadder, type Step, type Tier, type TierId,
} from "../_shared/effort-router/mod.ts";
import { kindPrompt, schemaFor, SYSTEM_PROMPT } from "./schema.ts";
import { buildParts, estimateTokens, hasFiles, loadSources, SourceError, type SourceRow } from "./sources.ts";
import {
  buildClientDraft, buildProjectDraft, buildUpdateDraft, type DraftSpec, hasProjectChanges, hasUnitChanges,
  matchUnit, type PhoneNormalizer, type Restore, type Src, updateTarget,
} from "./validate.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
const fail = (message: string, status = 400) => json({ status: "error", message }, status);

/* ===================== الإعدادات وضبط التكلفة ===================== */

const env = (name: string) => Deno.env.get(name);
const numEnv = (name: string, fallback: number) => {
  const n = Number(env(name));
  return Number.isFinite(n) && (env(name) ?? "").trim() !== "" ? n : fallback;
};

const MAX_ATTEMPTS = 3; // محاولات الطلب الواحد لأخطاء البنية (تشمل ما يعيده المُجدوِل)
const LEASE_SECONDS = 300; // أطول من حد تشغيل الوظيفة، فلا يعمل نداءان على طلب واحد
const MAX_INPUT_TOKENS = numEnv("AGENT_MAX_INPUT_TOKENS", 150_000); // سقف مدخلات النداء الواحد (تقدير)
const MAX_OUTPUT_TOKENS = 16_000; // سقف الناتج المرئي؛ يُرفع بقدر التفكير حين يُشغَّل
const REASONING_THRESHOLD = numEnv("AGENT_REASONING_THRESHOLD", DEFAULT_REASONING_THRESHOLD);
const MAX_REJECT_RATIO = numEnv("AGENT_MAX_REJECT_RATIO", DEFAULT_MAX_REJECT_RATIO);
const SWEEP_BATCH = 3;
// حد تشغيل الوظيفة 150 ث في الخطة المجانية: لا نبدأ نداءً لا يتسع له الوقت الباقي
const RUN_BUDGET_MS = 140_000;
const MIN_CALL_MS = 25_000;

// أسماء الإعدادات التي يذكرها sweep إن كانت مضبوطة — الأسماء فقط، لا القيم أبداً
const CONFIG_NAMES = [
  "OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "AGENT_MODEL_FAST", "AGENT_MODEL_REASON", "AGENT_MODEL_GENERAL",
  "AGENT_FAST_PROVIDERS", "AGENT_GENERAL_PROVIDERS", "AGENT_REASONING_THRESHOLD", "AGENT_MAX_REJECT_RATIO",
  "AGENT_MAX_INPUT_TOKENS", "AGENT_PDF_ENGINE",
];
const configured = () => CONFIG_NAMES.filter((name) => (env(name) ?? "").trim() !== "");

const DISABLED_AR = "الاستخراج التلقائي غير مفعّل — لم يُضبط السر OPENROUTER_API_KEY في أسرار Supabase بعد. الطلب محفوظ ومرفقاته مخزّنة.";

const apiKey = () => (env("OPENROUTER_API_KEY") ?? "").trim();

function service(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/* ===================== الدخول ===================== */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("طلب غير مدعوم", 405);

  try {
    const db = service();
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    // المُجدوِل: لا هوية مستخدم، بل سر من Vault تتحقق منه القاعدة
    if (action === "sweep") {
      const secret = req.headers.get("x-agent-cron") ?? "";
      const { data: ok } = await db.rpc("agent_cron_secret_ok", { p_secret: secret });
      if (ok !== true) return fail("غير مصرح", 401);
      const { data: ids, error } = await db.rpc("agent_pending_requests", { p_max_attempts: MAX_ATTEMPTS, p_limit: SWEEP_BATCH });
      if (error) return fail("تعذّر قراءة الطلبات المعلّقة", 500);
      const list = ((ids ?? []) as unknown[]).map((row) => typeof row === "string" ? row : Object.values(row as object)[0] as string);
      const deadline = Date.now() + RUN_BUDGET_MS;
      EdgeRuntime.waitUntil((async () => {
        // طلب لا يتسع له الوقت الباقي يبقى في الانتظار للدورة التالية
        for (const id of list) {
          if (deadline - Date.now() < 60_000) break;
          await processRequest(db, id, deadline);
        }
      })());
      return json({ status: "accepted", count: list.length, enabled: apiKey() !== "", secrets: configured() }, 202);
    }

    // المستخدم: رمز جلسة صالح لحساب غير موقوف
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return fail("غير مصرح", 401);
    const { data: caller, error: callerErr } = await db.auth.getUser(token);
    if (callerErr || !caller?.user) return fail("غير مصرح", 401);
    const { data: me } = await db.from("profiles").select("id, role, is_blocked").eq("id", caller.user.id).maybeSingle();
    if (!me || me.is_blocked) return fail("غير مصرح", 403);

    if (action === "status") {
      return json({ status: "success", enabled: apiKey() !== "", message: apiKey() ? null : DISABLED_AR });
    }

    if (action === "run") {
      const id = String(body.request_id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("طلب غير صالح");
      const { data: request } = await db.from("agent_requests").select("id, requested_by, status").eq("id", id).maybeSingle();
      if (!request || (request.requested_by !== me.id && me.role !== "admin")) return fail("الطلب غير موجود", 404);
      EdgeRuntime.waitUntil(processRequest(db, id, Date.now() + RUN_BUDGET_MS));
      return json({ status: "accepted", enabled: apiKey() !== "" }, 202);
    }

    return fail("إجراء غير معروف");
  } catch (e) {
    console.error(e);
    return fail("خطأ داخلي", 500);
  }
});

/* ===================== تنفيذ طلب ===================== */

class Stop extends Error {
  constructor(message: string, readonly retry = false) {
    super(message);
  }
}

// نتيجة تقييم محاولة واحدة: مسودات جاهزة، أو سؤال الموظف عن الهدف، أو فشل بسبب
interface Evaluation {
  outcome: AttemptOutcome;
  drafts: DraftSpec[] | "asked" | null;
  notes: string[]; // ملاحظات المدقق بالعربية: رسالة الإصلاح، وما يبقى لإنسان
}

async function processRequest(db: SupabaseClient, id: string, deadline: number) {
  // الحجز ذرّي في القاعدة: إن كان طلب آخر يعمل عليه أو انتهى، لا شيء يحدث هنا
  const { data: claimed, error: claimErr } = await db.rpc("agent_claim_request", {
    p_request: id, p_lease_seconds: LEASE_SECONDS, p_max_attempts: MAX_ATTEMPTS,
  });
  const request = Array.isArray(claimed) ? claimed[0] : claimed;
  if (claimErr || !request) return;

  const spent = { tokens: request.tokens_used ?? 0, cost: Number(request.cost_usd ?? 0) };
  const inserted: string[] = [];
  try {
    const key = apiKey();
    if (!key) throw new Stop(DISABLED_AR);
    if (request.kind === "external") throw new Stop("الاستيراد من مصدر خارجي لم يُفعَّل بعد (الجولة C)");
    const schema = schemaFor(request.kind);
    if (!schema) throw new Stop("نوع طلب غير مدعوم");

    // 1) قراءة المصادر
    const { data: rows, error: srcErr } = await db.from("agent_sources")
      .select("id, kind, storage_path, url, bytes, pages, sha256")
      .eq("request_id", id).order("created_at", { ascending: true });
    if (srcErr) throw new Stop("تعذّر قراءة مصادر الطلب", true);
    if (!rows || rows.length === 0) throw new Stop("لا مصادر على هذا الطلب");

    const loaded = await loadSources(rows as SourceRow[], async (path) => {
      const { data, error } = await db.storage.from("agent-sources").download(path);
      if (error || !data) throw new Stop("تعذّر تحميل ملف من المخزن", true);
      return new Uint8Array(await data.arrayBuffer());
    });
    for (const [sourceId, pages] of loaded.pages) {
      await db.from("agent_sources").update({ pages }).eq("id", sourceId);
    }
    if (loaded.srcs.every((s) => s.kind === "url")) {
      throw new Stop("الروابط لا تُفتح في هذه المرحلة — ألصق النص أو ارفع الملف");
    }

    // 2) الإخفاء مرة واحدة للطلب: النموذج يرى [PHONE_n] و[EMAIL_n]، والخريطة في الذاكرة فقط.
    // المدقق يطابق الاقتباس على هذا النص نفسه، ثم تُعاد القيم الأصلية قبل الحفظ.
    const redactor = new Redactor();
    const seen: Src[] = loaded.srcs.map((s) => s.text === undefined ? s : { ...s, text: redactor.redact(s.text) });
    const restore: Restore = (s) => redactor.restore(s);
    const tail = `${kindPrompt(request.kind)}\n\n<employee_request>\n${redactor.redact(String(request.instruction).slice(0, 4000))}\n</employee_request>`;

    // 3) السلّم: الطبقة الأولى من نوع المصادر وطلب الموظف ودرجة الجهد، أو الموضع المحفوظ إن أُعيد
    // الطلب إلى الانتظار بعد أن تجاوز السلّم خطوته الأولى (مهلة نداء مصعّد مثلاً)
    const tiers = defaultTiers(env);
    const available = Object.keys(tiers) as TierId[];
    const effort = scoreEffort({ kind: request.kind, sources: loaded.srcs });
    const resumed = resumeLadder(request.ladder, { available, hasFiles: hasFiles(loaded) });
    let step: Step | null = resumed?.step ?? firstStep({
      deep: request.effort_hint === "deep",
      hasFiles: hasFiles(loaded),
      reasoning: reasoningFor(effort, REASONING_THRESHOLD),
      available,
    });
    if (!step) throw new Stop("لا طبقة نموذج متاحة تقرأ مصادر هذا الطلب");

    let notes: string[] = resumed?.notes ?? [];
    while (step) {
      const tier = tiers[step.tier]!;
      // يُحفظ قبل النداء: مهلة أو انقطاع أو توقف الوظيفة كلها تُعيد الطلب إلى هذه الخطوة
      if (shouldSaveLadder(step)) await saveLadder(db, id, step, notes);
      const parts = buildParts(loaded, seen, tier.supportsFiles);
      const content: ChatPart[] = [...parts, { type: "text", text: tail }];
      if (step.repair && notes.length) content.push({ type: "text", text: repairText(notes) });

      const estimate = estimateTokens(parts, loaded, SYSTEM_PROMPT + tail);
      if (estimate > MAX_INPUT_TOKENS) {
        throw new Stop(`المصادر أطول من سقف الطلب الواحد (قرابة ${estimate.toLocaleString("en")} رمزاً من ${MAX_INPUT_TOKENS.toLocaleString("en")}) — قسّمها على أكثر من طلب`);
      }
      await checkBudget(db, step, notes);
      const remaining = deadline - Date.now();
      if (remaining < MIN_CALL_MS) throw new Stop("انتهى وقت التشغيل قبل اكتمال المحاولات", true);

      await stage(db, id, "extracting");
      const messages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content }];
      let result: ChatResult;
      try {
        result = await chat({
          tier, apiKey: key, messages, reasoning: step.reasoning, maxTokens: MAX_OUTPUT_TOKENS,
          schema: { name: request.kind, schema }, plugins: pdfPlugins(tier, parts),
          timeoutMs: Math.min(110_000, remaining - 5_000),
        });
      } catch (e) {
        // المزوّد الذي رفض النداء وسببه (الجوالات والبريد تُخفى إن ردّدها المزوّد)
        const why = e instanceof ChatError
          ? { provider: e.provider, error: redactor.redact(`${e.kind} ${e.status ?? ""} ${e.message}`).slice(0, 500) }
          : { provider: null, error: redactor.redact(String((e as Error)?.message ?? e)).slice(0, 500) };
        await logCall(db, id, step, tier, effort, null, "error", null, why);
        throw e;
      }
      spent.tokens += result.usage.prompt + result.usage.completion;
      spent.cost += result.usage.costUsd ?? 0;

      await stage(db, id, "validating");
      const ev = await evaluate(db, id, request, result, seen, restore);
      const failed = isFailure(ev.outcome, MAX_REJECT_RATIO);
      const failure = failed ? classifyFailure(ev.outcome) : null;
      await logCall(db, id, step, tier, effort, result, failed ? "invalid" : "ok", failure);

      if (!failed && ev.drafts === "asked") {
        await finish(db, id, { status: "ready", tokens_used: spent.tokens, cost_usd: spent.cost, error_ar: null }, true);
        return;
      }
      if (!failed && Array.isArray(ev.drafts)) {
        const status = await draftStatusFor(db, request.requested_by);
        for (const d of ev.drafts) inserted.push(await saveDraft(db, id, request.requested_by, d, status));
        const done = await finish(db, id, { status: "ready", tokens_used: spent.tokens, cost_usd: spent.cost, error_ar: null });
        // أُلغي الطلب أثناء التنفيذ: لا تبقى مسودات لطلب ملغى
        if (!done && inserted.length) await db.from("agent_drafts").delete().in("id", inserted);
        return;
      }
      notes = ev.notes;
      step = nextStep(step, failure!, available);
    }

    // كل المحاولات فشلت: الطلب يفشل، وملاحظات المدقق تبقى في رسالته ليراجعها إنسان
    throw new Stop(humanReview(notes));
  } catch (e) {
    if (inserted.length) await db.from("agent_drafts").delete().in("id", inserted);
    const { message, retry } = describe(e);
    // رسالة المزوّد تُسجَّل للتشخيص (لا تحمل المفتاح)؛ الموظف يرى الرسالة العربية فقط
    if (!(e instanceof Stop) || retry) {
      console.error("agent-run", id, e instanceof ChatError ? `${e.kind} ${e.status ?? ""} ${e.message.slice(0, 400)}` : e);
    }
    const again = retry && (request.attempts ?? 1) < MAX_ATTEMPTS;
    await finish(db, id, {
      status: again ? "queued" : "failed",
      tokens_used: spent.tokens || null,
      cost_usd: spent.cost || null,
      error_ar: again ? message + " — ستُعاد المحاولة تلقائياً" : message,
    });
  }
}

/* ===================== تقييم محاولة ===================== */

function hard(kind: NonNullable<AttemptOutcome["hard"]>, note: string): Evaluation {
  return { outcome: { hard: kind, returned: 0, rejected: 0, rejections: [] }, drafts: null, notes: [note] };
}

// شكل الناتج في المستوى الأعلى؛ في وضع json_object لا يضمنه المزوّد، والمدقق يكمل الباقي
function shapeOk(kind: string, out: unknown): boolean {
  // deno-lint-ignore no-explicit-any
  const o = out as any;
  if (!o || typeof o !== "object" || Array.isArray(o)) return false;
  if (kind === "client") return typeof o.client === "object" && o.client !== null;
  if (kind === "project") return typeof o.project === "object" && o.project !== null && Array.isArray(o.units);
  if (kind === "update") return typeof o.target === "object" && o.target !== null && Array.isArray(o.changes);
  return false;
}

async function evaluate(
  // deno-lint-ignore no-explicit-any
  db: SupabaseClient, id: string, request: any, result: ChatResult, seen: Src[], restore: Restore,
): Promise<Evaluation> {
  if (result.finishReason === "length") return hard("truncated", "الناتج مقطوع لأنه بلغ سقف الطول — اختصر الناتج ولا تكرر النصوص");
  let out: unknown;
  try {
    out = parseJson(result.text);
  } catch {
    return hard("parse", "الناتج ليس JSON صالحاً");
  }
  if (!shapeOk(request.kind, out)) return hard("schema", "شكل الناتج لا يطابق المخطط المطلوب");

  const normalizePhone: PhoneNormalizer = async (raw) => {
    const { data } = await db.rpc("normalize_phone", { p: raw });
    return typeof data === "string" ? data : null;
  };

  let drafts: DraftSpec[];
  if (request.kind === "client") {
    const draft = await buildClientDraft(out, seen, normalizePhone, restore);
    await attachClientDuplicates(db, draft);
    drafts = [draft];
  } else if (request.kind === "project") {
    const draft = await buildProjectDraft(out, seen, normalizePhone, restore);
    // الاسم المبني («فيلا – حي السامر») وصف لا هوية: لا يُطابَق به، وإلا صارت كل فلل الحي «الاسم مطابق».
    // الاسم الذي ذكره المصدر (stated) يبقى دليلاً ولو لم يُتحقق من اقتباسه.
    const generated = draft.evidence.name?.suggested && !draft.evidence.name.stated;
    const probe = generated ? { ...draft.proposed, name: undefined } : draft.proposed;
    const { data: dups } = await db.rpc("agent_find_duplicates", { p_kind: "project", p: probe });
    draft.duplicates = Array.isArray(dups) ? dups : [];
    drafts = [draft];
  } else {
    const picked = await buildUpdateDrafts(db, id, request.target_id, out, seen, normalizePhone, restore);
    if (picked === "asked") return { outcome: { returned: 0, rejected: 0, rejections: [] }, drafts: "asked", notes: [] };
    if ("fail" in picked && picked.fail === "empty") return hard("empty", picked.note);
    if ("fail" in picked) {
      return {
        outcome: { returned: 1, rejected: 1, rejections: [picked.fail] },
        drafts: null,
        notes: [picked.note],
      };
    }
    drafts = picked;
  }

  const outcome: AttemptOutcome = { returned: 0, rejected: 0, rejections: [] };
  const notes: string[] = [];
  for (const d of drafts) {
    outcome.returned += d.stats.returned;
    outcome.rejected += d.stats.rejected;
    outcome.rejections.push(...d.stats.rejections);
    for (const c of d.conflicts) {
      if (c.code && CODE_CLASS[c.code]) notes.push((c.field ? c.field + ": " : "") + c.note);
    }
  }
  if (!drafts.some((d) => Object.keys(d.proposed).length)) {
    outcome.hard = "empty";
    notes.unshift("لم يُستخرج من المصادر أي حقل مدعوم بدليل — راجع المصدر أو التعليمات");
  }
  return { outcome, drafts, notes };
}

function repairText(notes: string[]): string {
  const list = [...new Set(notes)].slice(0, 20).map((n) => "- " + n).join("\n");
  return `رفض المدقق المحاولة السابقة لهذه الأسباب:\n${list}\n\nصحّح ما سبق وفق التعليمات والمصادر نفسها، ولا تخمّن قيمة لا يذكرها المصدر. أعد JSON المصحّح فقط.`;
}

function humanReview(notes: string[]): string {
  const list = [...new Set(notes)].slice(0, 8).join(" • ");
  return "تعذّر الاستخراج آلياً بعد محاولات التصعيد — يحتاج مراجعة يدوية" + (list ? ". ملاحظات التحقق: " + list : "");
}

// PDF: القراءة الأصلية في النموذج أولاً (افتراض OpenRouter). AGENT_PDF_ENGINE يفرض محرّكاً
// آخر إن تبيّن أن القراءة الأصلية لا تعمل: pdf-text (صار cloudflare-ai، مجاني) أو mistral-ocr.
function pdfPlugins(tier: Tier, parts: ChatPart[]): unknown[] | undefined {
  const engine = (env("AGENT_PDF_ENGINE") ?? "").trim();
  if (!engine || engine === "native" || tier.reasoningStyle !== "openrouter") return undefined;
  if (!parts.some((p) => p.type === "file")) return undefined;
  return [{ id: "file-parser", pdf: { engine } }];
}

/* ===================== السقف اليومي والسجل ===================== */

async function checkBudget(db: SupabaseClient, step: Step, notes: string[]) {
  const { data, error } = await db.rpc("agent_router_budget");
  if (error || !data) throw new Stop("تعذّر قراءة سقف الإنفاق اليومي", true);
  const b = data as { spent_usd: number; usd_cap: number; escalations: number; escalation_cap: number };
  const tail = notes.length ? " — " + humanReview(notes) : "";
  if (Number(b.spent_usd) >= Number(b.usd_cap)) {
    throw new Stop(`بلغ إنفاق المساعد اليوم سقفه (${Number(b.spent_usd).toFixed(2)} من ${Number(b.usd_cap)} دولار) — يُستأنف غداً أو يرفع المدير السقف${tail}`);
  }
  if (step.escalation && Number(b.escalations) >= Number(b.escalation_cap)) {
    throw new Stop(`بلغ التصعيد إلى النماذج الأغلى اليوم سقفه (${b.escalations} من ${b.escalation_cap}) — يُستأنف غداً أو يرفع المدير السقف${tail}`);
  }
}

function reasoningLabel(tier: Tier, step: Step): string {
  if (!step.reasoning) return "off";
  return tier.reasoning.max_tokens ? `max_tokens:${tier.reasoning.max_tokens}` : `effort:${tier.reasoning.effort ?? "medium"}`;
}

async function logCall(
  db: SupabaseClient, id: string, step: Step, tier: Tier, effort: Effort,
  result: ChatResult | null, outcome: "ok" | "invalid" | "error", failure: string | null,
  why: { provider: string | null; error: string } | null = null,
) {
  const { error } = await db.from("agent_model_calls").insert({
    request_id: id,
    attempt: step.attempt,
    tier: tier.id,
    model: tier.model,
    // من خدم النداء، أو من رفضه إن سمّاه OpenRouter
    provider: result?.provider ?? why?.provider ?? null,
    error: why?.error ?? null,
    reasoning: reasoningLabel(tier, step),
    escalated: step.escalation,
    effort_score: effort.score,
    effort_reasons: effort.reasons,
    prompt_tokens: result?.usage.prompt ?? null,
    completion_tokens: result?.usage.completion ?? null,
    reasoning_tokens: result?.usage.reasoning ?? null,
    cost_usd: result?.usage.costUsd ?? null,
    outcome,
    failure_class: failure,
  });
  if (error) console.error("agent_model_calls", id, error.message);
}

/* ===================== أدوات الطلب ===================== */

function describe(e: unknown): { message: string; retry: boolean } {
  if (e instanceof Stop) return { message: e.message, retry: e.retry };
  if (e instanceof SourceError) return { message: e.message, retry: false };
  if (e instanceof ChatError) {
    switch (e.kind) {
      case "auth": return { message: "مفتاح OpenRouter غير صالح أو بلا صلاحية", retry: false };
      case "credits": return { message: "رصيد OpenRouter غير كافٍ — اشحن الرصيد ثم أعد الطلب", retry: false };
      case "rate_limit": return { message: "خدمة الاستخراج مشغولة الآن", retry: true };
      case "no_route": return { message: "لم يوجد مزوّد مسموح يقبل هذا الطلب — راجع قائمة المزوّدين", retry: false };
      case "refusal": return { message: "رفض النموذج معالجة هذا المصدر", retry: false };
      case "bad_request":
      case "schema":
        return { message: "رفضت خدمة الاستخراج الطلب — قد يكون الملف تالفاً أو كبيراً", retry: false };
      default: return { message: "تعذّر الوصول إلى خدمة الاستخراج", retry: true };
    }
  }
  return { message: "خطأ داخلي أثناء التنفيذ", retry: true };
}

async function stage(db: SupabaseClient, id: string, value: string) {
  await db.from("agent_requests").update({ stage: value }).eq("id", id).eq("status", "running");
}

// موضع السلّم قبل خطوة بعد الأولى. فشل الحفظ لا يوقف التنفيذ: أسوأ حالاته بدء الإعادة من السريعة.
async function saveLadder(db: SupabaseClient, id: string, step: Step, notes: string[]) {
  const { error } = await db.from("agent_requests")
    .update({ ladder: { step, notes: [...new Set(notes)].slice(0, 50) } })
    .eq("id", id).eq("status", "running");
  if (error) console.error("agent-run ladder", id, error.message);
}

// الإنهاء بشرط أن الطلب ما زال قيد التنفيذ: الإلغاء من المستخدم لا يُداس عليه.
// keepCandidates: سؤال الموظف عن الهدف كتب المرشّحين ورسالته على الطلب قبل الإنهاء.
// موضع السلّم يبقى مع العودة إلى الانتظار فقط؛ أي نهاية أخرى تمسحه.
async function finish(db: SupabaseClient, id: string, patch: Record<string, unknown>, keepCandidates = false): Promise<boolean> {
  const values = keepCandidates ? { ...patch, error_ar: undefined } : patch;
  const ladder = patch.status === "queued" ? {} : { ladder: null };
  const { data } = await db.from("agent_requests")
    .update({ ...values, ...ladder, stage: null, lease_until: null })
    .eq("id", id).eq("status", "running").select("id");
  return Boolean(data && data.length);
}

// مسودات طلب أنشأه المدير تدخل «بانتظار الاعتماد» مباشرة، فلا يرسلها لنفسه واحدة واحدة (عروض واتساب).
// مسودة الموظف تبقى «مسودة» حتى يراجعها ويرسلها.
async function draftStatusFor(db: SupabaseClient, requestedBy: string | null): Promise<"draft" | "submitted"> {
  if (!requestedBy) return "draft";
  const { data } = await db.from("profiles").select("role").eq("id", requestedBy).maybeSingle();
  return data?.role === "admin" ? "submitted" : "draft";
}

async function saveDraft(
  db: SupabaseClient, id: string, requestedBy: string | null, d: DraftSpec, status: "draft" | "submitted" = "draft",
): Promise<string> {
  const { data: row, error } = await db.from("agent_drafts").insert({
    request_id: id,
    target_kind: d.target_kind,
    target_id: d.target_id,
    proposed: d.proposed,
    evidence: d.evidence,
    missing: d.missing,
    conflicts: d.conflicts,
    duplicates: d.duplicates,
    suspicious: d.suspicious,
    baseline_hash: d.baseline_hash,
    status,
    created_by: requestedBy,
  }).select("id").single();
  if (error || !row) throw new Stop("تعذّر حفظ المسودة", true);
  return row.id;
}

/* ===================== المكرّرات والعميل القائم ===================== */

// الجوال المطبَّع أولاً، والاسم وحده لا يُعدّ تطابقاً. إن طابق الجوال عميلاً واحداً قائماً،
// تصير المسودة تعديلاً عليه (والطلب العقاري يُضاف لملفه) بدل عميل ثانٍ برقم مكرر.
async function attachClientDuplicates(db: SupabaseClient, draft: DraftSpec) {
  const { data: dups } = await db.rpc("agent_find_duplicates", { p_kind: "client", p: draft.proposed });
  draft.duplicates = Array.isArray(dups) ? dups : [];
  if (draft.duplicates.length !== 1) {
    if (draft.duplicates.length > 1) {
      draft.conflicts.push({ note: "الجوال يطابق أكثر من عميل قائم — راجع المكرّرات قبل الاعتماد", code: "duplicate" });
    }
    return;
  }
  // deno-lint-ignore no-explicit-any
  const existing = draft.duplicates[0] as any;
  const { data: snap } = await db.rpc("agent_target_snapshot", { p_kind: "client", p_id: existing.id });
  if (!snap?.hash) return;
  draft.target_id = existing.id;
  draft.baseline_hash = snap.hash;
  for (const [key, ev] of Object.entries(draft.evidence)) {
    if (!key.includes(".")) ev.before = snap.row?.[key] ?? null;
  }
  draft.conflicts.push({ note: "الجوال مسجّل للعميل «" + (existing.name ?? "") + "» — المسودة تعديل على ملفه لا عميل جديد", code: "duplicate" });
}

/* ===================== التحديث: تحديد السجل الهدف ===================== */

type UpdatePick = DraftSpec[] | "asked" | { fail: string; note: string };

// مرشّحون: يُسأل الموظف (نجاح، لا فشل). لا مرشّح: فشل استدلالي — ربما أخطأ النموذج قراءة الاسم.
async function askUser(db: SupabaseClient, id: string, candidates: unknown[], message: string, missing: string): Promise<UpdatePick> {
  if (!candidates.length) return { fail: "unit_ambiguous", note: missing };
  await db.from("agent_requests").update({ candidates, error_ar: message }).eq("id", id).eq("status", "running");
  return "asked";
}

async function buildUpdateDrafts(
  db: SupabaseClient, id: string, pickedTarget: string | null, out: unknown,
  srcs: Src[], normalizePhone: PhoneNormalizer, restore: Restore,
): Promise<UpdatePick> {
  const target = updateTarget(out, restore);
  const wantsUnit = hasUnitChanges(out);
  const wantsProject = hasProjectChanges(out);
  if (!wantsUnit && !wantsProject) return { fail: "empty", note: "لم يذكر الناتج أي تغيير قابل للتطبيق من المصدر" };

  // 1) المشروع: ما اختاره الموظف، أو تطابق اسم واحد بعد التطبيع. غير ذلك يُسأل الموظف.
  let projectId: number | null = null;
  let unitOrd: number | null = null;
  if (pickedTarget) {
    const [p, u] = pickedTarget.split("/");
    projectId = Number(p);
    unitOrd = u ? Number(u) : null;
  } else {
    const { data: found } = await db.rpc("agent_find_duplicates", {
      p_kind: "update", p: { name: target.project_name ?? "", district: target.district ?? "" },
    }) as { data: { id: string; name?: string; district?: string; reason?: string; rank?: string }[] | null };
    const list = found ?? [];
    const exact = list.filter((c) => c.rank === "1");
    if (exact.length === 1) {
      projectId = Number(exact[0].id);
    } else {
      return askUser(db, id, list.map((c) => ({
        id: String(c.id), kind: "project", label: [c.name, c.district].filter(Boolean).join(" — "), reason: c.reason,
      })), "تعذّر تحديد المشروع المقصود بثقة — اختر المشروع",
      `لم يُعثر على مشروع باسم «${target.project_name ?? ""}» — اكتب اسم المشروع كما يرد في المصدر حرفياً`);
    }
  }

  const { data: projectSnap } = await db.rpc("agent_target_snapshot", { p_kind: "project", p_id: String(projectId) });
  if (!projectSnap?.hash) throw new Stop("المشروع المختار لم يعد موجوداً");

  const drafts: DraftSpec[] = [];
  if (wantsProject) {
    const d = await buildUpdateDraft(out, srcs, normalizePhone, "project", String(projectId), projectSnap.row, projectSnap.hash, restore);
    if (d) drafts.push(d);
  }

  // 2) الوحدة داخل المشروع: الاسم المطبَّع، وإلا يُسأل الموظف من وحدات هذا المشروع
  if (wantsUnit) {
    if (unitOrd === null) {
      const m = matchUnit(projectSnap.row?.details?.models, target.unit_name);
      if (m.ord === null) {
        return askUser(db, id, m.candidates.map((c) => ({
          id: projectId + "/" + c.ord, kind: "unit", label: projectSnap.row?.name + " — " + c.name, reason: "وحدة في المشروع",
        })), "تعذّر تحديد الوحدة المقصودة بثقة — اختر الوحدة",
        `المشروع بلا وحدات تطابق «${target.unit_name ?? ""}»`);
      }
      unitOrd = m.ord;
    }
    const { data: unitSnap } = await db.rpc("agent_target_snapshot", { p_kind: "unit", p_id: projectId + "/" + unitOrd });
    if (!unitSnap?.hash) throw new Stop("الوحدة المختارة لم تعد موجودة");
    const d = await buildUpdateDraft(out, srcs, normalizePhone, "unit", projectId + "/" + unitOrd, unitSnap.row, unitSnap.hash, restore);
    if (d) drafts.push(d);
  }
  return drafts;
}
