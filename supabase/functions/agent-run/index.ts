// نظام ملائم العقاري — وظيفة الاستخراج agent-run (الجولة B من docs/TASK_AGENT.md، والموجّه من docs/TASK_ROUTER.md)
//
// أربعة أفعال:
//   status — للمستخدم المسجَّل: هل الاستخراج مفعَّل (هل ضُبط OPENROUTER_API_KEY)؟
//   run    — للمستخدم الذي يرى الطلب: يبدأ التنفيذ ويعود فوراً؛ العمل يكمل في الخلفية.
//   recheck_twins — للمدير بعد تعديل مقترح مسودة مشروع جديد: يعيد مطابقتها بالمسودات
//            المعلّقة الأخرى (التوائم) بقيمها الجديدة، ولا يكتب إلا سطور التوائم في المكرّرات. بلا نموذج ولا تكلفة.
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
  afterTimeout, type AttemptOutcome, chat, ChatError, type ChatMessage, type ChatPart, type ChatResult, CODE_CLASS, classifyFailure,
  DEFAULT_MAX_REJECT_RATIO, DEFAULT_REASONING_THRESHOLD, defaultTiers, type Effort, firstStep, isFailure, nextStep,
  parseJson, reasoningFor, Redactor, resumeLadder, scoreEffort, shouldSaveLadder, type Step, type Tier, type TierId,
} from "../_shared/effort-router/mod.ts";
import { kindPrompt, schemaFor, SYSTEM_PROMPT } from "./schema.ts";
import { buildParts, estimateTokens, hasFiles, loadSources, SourceError, type SourceRow } from "./sources.ts";
import {
  buildClientDraft, buildProjectDraft, buildUpdateDraft, districtFromName, districtHintName, districtNote, type DraftFacts,
  type DraftSpec, existingProjectMatch, fmtArea, fmtPrice, forcedNewNote, hasProjectChanges, hasUnitChanges, matchUnit, NEW_PROJECT,
  normText, type PhoneNormalizer, type Restore, rpcMissing, type Src, type TwinCheck, type TwinEntry, twinEntry, twinLines, type TwinPlan,
  twinReason, twinRecheck, updateTarget, withoutTwin, withTwin,
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
const UUID = /^[0-9a-f-]{36}$/i;
// المسودة المعلّقة: مسودة، أو بانتظار الاعتماد، أو معادة للموظف
const OPEN_DRAFT = ["draft", "submitted", "returned"];

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
// مهلة النداء: السريعة 110 ث؛ الطبقة الثقيلة المستأنفة بعد مهلة السريعة تأخذ وقت التشغيل كله تقريباً
const FAST_WINDOW_MS = 110_000;
const HEAVY_WINDOW_MS = 130_000;
// نداء قُطع بمهلة يُكمله المزوّد ويُفوتره كاملاً (الطلب غير متدفق)، ولا تعود تكلفته: يُسجَّل بتقدير أعلى
// فيدخل سقف الإنفاق اليومي. يُضبط لكل طبقة بـ AGENT_TIMEOUT_COST_FAST/_REASON/_GENERAL
const TIMEOUT_COST_USD: Record<TierId, number> = {
  fast: numEnv("AGENT_TIMEOUT_COST_FAST", 0.01),
  reason: numEnv("AGENT_TIMEOUT_COST_REASON", 0.25),
  general: numEnv("AGENT_TIMEOUT_COST_GENERAL", 0.5),
};

// أسماء الإعدادات التي يذكرها sweep إن كانت مضبوطة — الأسماء فقط، لا القيم أبداً
const CONFIG_NAMES = [
  "OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "AGENT_MODEL_FAST", "AGENT_MODEL_REASON", "AGENT_MODEL_GENERAL",
  "AGENT_FAST_PROVIDERS", "AGENT_GENERAL_PROVIDERS", "AGENT_REASONING_THRESHOLD", "AGENT_MAX_REJECT_RATIO",
  "AGENT_MAX_INPUT_TOKENS", "AGENT_PDF_ENGINE", "AGENT_TIMEOUT_COST_FAST", "AGENT_TIMEOUT_COST_REASON", "AGENT_TIMEOUT_COST_GENERAL",
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
        // طلب لا يتسع الوقت الباقي لمهلة ندائه كاملة يبقى في الانتظار للدورة التالية (الحجز يستهلك محاولة، ونداء
        // بمهلة ناقصة يُقطع ولا يُصعَّد). الأول في الدورة يُحجز دائماً ويأخذ وقت التشغيل كله
        for (const [i, id] of list.entries()) {
          const left = deadline - Date.now();
          if (left < 60_000) break;
          if (i > 0 && left < (await needsHeavyWindow(db, id) ? HEAVY_WINDOW_MS : FAST_WINDOW_MS) + 5_000) continue;
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
      if (!UUID.test(id)) return fail("طلب غير صالح");
      const { data: request } = await db.from("agent_requests").select("id, requested_by, status").eq("id", id).maybeSingle();
      if (!request || (request.requested_by !== me.id && me.role !== "admin")) return fail("الطلب غير موجود", 404);
      EdgeRuntime.waitUntil(processRequest(db, id, Date.now() + RUN_BUDGET_MS));
      return json({ status: "accepted", enabled: apiKey() !== "" }, 202);
    }

    // بعد حفظ تعديل على مقترح مسودة (approvals.js): للمدير وحده. المسودة مشروع جديد معلّق وحدها لها توائم
    if (action === "recheck_twins") {
      const draftId = String(body.draft_id ?? "");
      if (!UUID.test(draftId)) return fail("مسودة غير صالحة");
      const { data: draft, error: draftErr } = await db.from("agent_drafts")
        .select("id, request_id, target_kind, target_id, status, proposed, evidence, duplicates").eq("id", draftId).maybeSingle();
      if (draftErr) return fail("تعذّر قراءة المسودة", 500);
      if (!draft) return fail("المسودة غير موجودة", 404);
      // للمدير وحده: لو أتيح لمقدّم الطلب لعدّل مسودته وأعاد الفحص ليقرأ في مكرّراته أسماء مسودات زملائه المعلّقة
      // بأي حيّ أو سعر يجرّبه، بلا استخراج مدفوع ولا سقف يومي. محرّر المسودة (approvals.js) للمدير وحده أصلاً
      if (me.role !== "admin") return fail("المسودة غير موجودة", 404);
      if (draft.target_kind !== "project" || draft.target_id !== null || !OPEN_DRAFT.includes(draft.status)) {
        return json({ status: "skipped", message: "ليست مسودة مشروع جديد معلّقة — لا توائم تُعاد مطابقتها" });
      }
      const done = await recheckTwins(db, draft);
      if (!done) return fail("تعذّر قراءة المسودات المعلّقة — لم يتغيّر شيء", 500);
      if (done.failed) return json({ status: "error", message: "تعذّرت كتابة بعض سطور التوائم", ...done }, 500);
      return json({ status: "success", ...done });
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
  // أحياء المشاريع القائمة لملاحظة «الحي من الاسم»: تُقرأ مرة في التشغيل، وحين تحتاجها مسودة فقط
  let districtList: Promise<KnownDistrict[] | null> | undefined;
  const districts = () => districtList ??= knownDistricts(db, id);
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
      const windowMs = Math.min(step.tier === "fast" ? FAST_WINDOW_MS : HEAVY_WINDOW_MS, remaining - 5_000);
      try {
        result = await chat({
          tier, apiKey: key, messages, reasoning: step.reasoning, maxTokens: MAX_OUTPUT_TOKENS,
          schema: { name: request.kind, schema }, plugins: pdfPlugins(tier, parts), timeoutMs: windowMs,
        });
      } catch (e) {
        // المزوّد الذي رفض النداء وسببه (الجوالات والبريد تُخفى إن ردّدها المزوّد)
        const why = e instanceof ChatError
          ? { provider: e.provider, error: redactor.redact(`${e.kind} ${e.status ?? ""} ${e.message}`).slice(0, 500) }
          : { provider: null, error: redactor.redact(String((e as Error)?.message ?? e)).slice(0, 500) };
        // انتهت مهلتنا نحن (لا 408/504 من المزوّد): التكلفة تقديرية وتُحتسب
        const aborted = e instanceof ChatError && e.kind === "timeout" && e.status === null;
        const estimate = aborted ? TIMEOUT_COST_USD[tier.id] : null;
        if (estimate !== null) {
          spent.cost += estimate;
          why.error = (why.error + " — تكلفة تقديرية").slice(0, 500);
        }
        await logCall(db, id, step, tier, effort, null, "error", null, why, estimate);
        // أخذت السريعة مهلتها كاملة ولم تكمل: الناتج أطول مما تكتبه فيها، فالإعادة عليها تنتهي مثلها. يُحفظ الطلب
        // على الطبقة العامة ويُستأنف منها. مهلة أقصر (وقت تشغيل باقٍ قليل)، أو سقف تصعيد يومي بلغ حدّه (فيُفشل
        // الطلب إن صُعّد)، تُعاد على السريعة كما هي
        if (aborted && step.tier === "fast" && windowMs >= FAST_WINDOW_MS) {
          const next = afterTimeout(step, available);
          if (next && await canEscalate(db)) await saveLadder(db, id, next, notes);
        }
        throw e;
      }
      spent.tokens += result.usage.prompt + result.usage.completion;
      spent.cost += result.usage.costUsd ?? 0;

      await stage(db, id, "validating");
      const ev = await evaluate(db, id, request, result, seen, restore, districts);
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
        if (!done) {
          if (inserted.length) await db.from("agent_drafts").delete().in("id", inserted);
          return;
        }
        await linkTwins(db, id, ev.drafts, inserted, request.kind === "project");
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

// نداء الطلب التالي على طبقة ثقيلة: خطوته المحفوظة (agent_requests.ladder، استئناف بعد مهلة السريعة)،
// وإلا الخطوة الأولى كما يختارها firstStep — ملف (PDF أو صورة) إلى العامة، و«عميق» إلى طبقة التفكير
async function needsHeavyWindow(db: SupabaseClient, id: string): Promise<boolean> {
  const { data } = await db.from("agent_requests").select("ladder, effort_hint, agent_sources(kind)").eq("id", id).maybeSingle();
  if (!data) return false;
  const tier = data.ladder?.step?.tier;
  if (typeof tier === "string") return tier !== "fast";
  const sources = (data.agent_sources ?? []) as { kind?: string }[];
  return data.effort_hint === "deep" || sources.some((s) => s?.kind === "pdf" || s?.kind === "image");
}

// بقي في سقف التصعيد اليومي متسع (تعذّرت القراءة: لا)
async function canEscalate(db: SupabaseClient): Promise<boolean> {
  const { data, error } = await db.rpc("agent_router_budget");
  if (error || !data) return false;
  const b = data as { spent_usd: number; usd_cap: number; escalations: number; escalation_cap: number };
  return Number(b.escalations) < Number(b.escalation_cap) && Number(b.spent_usd) < Number(b.usd_cap);
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
  districts: () => Promise<KnownDistrict[] | null>,
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
    const found = Array.isArray(dups) ? dups : [];
    // الاسم يطابق مشروعاً قائماً: لا مسودة، ويُسأل مقدّم الطلب كما في التحديث (يرسله تحديثاً، أو يختار «أنشئه مشروعاً جديداً»
    // فتُبنى المسودة وعليها ملاحظة للمدير). خيار واحد دائماً، فلا يعود askUser بفشل
    const existing = existingProjectMatch(draft, found, request.target_id);
    if (existing) {
      await askUser(db, id, existing.candidates, existing.message, "");
      return { outcome: { returned: 0, rejected: 0, rejections: [] }, drafts: "asked", notes: [] };
    }
    // اختار «جديد»: الملاحظة دائماً، ولو أعاد النموذج بعد الاختيار اسماً لا يطابق
    if (request.target_id === NEW_PROJECT) draft.conflicts.push(forcedNewNote(draft, found));
    draft.duplicates = [...found, ...await pendingTwins(db, id, draft)];
    await noteDistrictFromName(id, draft, districts);
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
  estimatedCost: number | null = null,
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
    cost_usd: result?.usage.costUsd ?? estimatedCost,
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
      case "timeout": return { message: "انتهت مهلة النموذج قبل أن يُكمل الاستخراج (عرض طويل أو خدمة بطيئة الآن)", retry: true };
      case "network": return { message: "انقطع الاتصال بخدمة الاستخراج", retry: true };
      case "server": return { message: "أعادت خدمة الاستخراج خطأً مؤقتاً", retry: true };
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

/* ===================== المسودات المعلّقة المتطابقة ===================== */

// مسودات مشاريع جديدة معلّقة (مسودة، بانتظار الاعتماد، أو معادة للموظف) في طلبات غير الطلب id، الأحدث أولاً،
// بمكرّراتها (إعادة المطابقة تكتب فيها). null: تعذّرت القراءة
async function pendingDrafts(db: SupabaseClient, id: string) {
  const { data, error } = await db.from("agent_drafts").select("id, request_id, proposed, evidence, duplicates")
    .eq("target_kind", "project").is("target_id", null).in("status", OPEN_DRAFT)
    .neq("request_id", id).order("created_at", { ascending: false }).limit(500);
  if (error) {
    console.error("agent-run twins", id, error.message);
    return null;
  }
  return data ?? [];
}

// سبب مطابقة مسودة أخرى لهذه المسودة، أو null. undefined: صفٌّ أسقط الفحص — يُسجَّل، ولا يُحكم عليه بمطابقة ولا بعدمها
// deno-lint-ignore no-explicit-any
function checkTwin(draft: DraftFacts, row: any): string | null | undefined {
  try {
    return twinReason(draft, row);
  } catch (e) {
    console.error("agent-run twins row", row?.id, String((e as Error)?.message ?? e).slice(0, 200));
    return undefined;
  }
}

// مسودات مشاريع جديدة معلّقة (مسودة، بانتظار الاعتماد، أو معادة للموظف) في طلبات أخرى تطابق هذه المسودة:
// العرض نفسه منشوراً في مجموعتين أو مرسلاً مرتين. تُذكر في مكرّراتها بنوع draft ورابط طلبها.
async function pendingTwins(db: SupabaseClient, id: string, draft: DraftFacts): Promise<TwinEntry[]> {
  const out: TwinEntry[] = [];
  for (const row of await pendingDrafts(db, id) ?? []) {
    const reason = checkTwin(draft, row);
    if (reason) out.push(twinEntry(row.request_id, row.id, row.proposed, reason));
  }
  return out;
}

// التنبيه على المسودتين: المسودة الأقدم تُضاف إليها الجديدة في مكرّراتها (وظيفة الخدمة وحدها تكتبه؛ الحارس يمنع غيرها).
// يُعاد الفحص بعد الحفظ: نسختان من العرض نفسه تُستخرجان معاً (إرسال دفعة من واتساب) لا ترى إحداهما الأخرى في فحص
// التقييم، فالتي تصل هنا بعد حفظ الأخرى تراها وتربط الاثنتين.
// كل سطر يُلحق وحده (linkTwin)، في مكرّرات التوأم وفي مكرّرات المسودة نفسها: لا تُكتب قائمة كاملة فوق ما كتبه تشغيل متزامن
async function linkTwins(db: SupabaseClient, id: string, drafts: DraftSpec[], ids: string[], isProject: boolean) {
  type Twin = { kind?: string; draft_id?: string; reason?: string | null };
  for (let i = 0; i < drafts.length; i++) {
    if (!ids[i]) continue;
    const twins = drafts[i].duplicates as Twin[];
    if (isProject && drafts[i].target_kind === "project" && !drafts[i].target_id) {
      const late = (await pendingTwins(db, id, drafts[i]))
        .filter((t) => !twins.some((k) => k?.kind === "draft" && k.draft_id === t.draft_id));
      for (const twin of late) {
        twins.push(twin);
        await linkTwin(db, id, ids[i], twin);
      }
    }
    for (const twin of twins) {
      if (twin?.kind !== "draft" || !twin.draft_id) continue;
      await linkTwin(db, id, twin.draft_id, twinEntry(id, ids[i], drafts[i].proposed, twin.reason ?? null));
    }
  }
}

// سطر توأم يُلحق بمكرّرات مسودة. agent_link_twin (ترحيل 025) تلحقه في UPDATE واحد ما لم تذكر المسودة مسودته، فتشغيلان
// متزامنان لا يمحو أحدهما سطر الآخر. وظيفةٌ نُشرت قبل الترحيل لا تجد الدالة، فتقرأ ثم تكتب كما كانت حتى يُطبَّق
function linkTwin(db: SupabaseClient, id: string, draftId: string, entry: TwinEntry): Promise<boolean> {
  return twinWrite(db, id, draftId, "agent_link_twin", { p_draft: draftId, p_entry: entry }, (list) => withTwin(list, entry));
}

// سطور التوأم twinDraftId تُحذف من مكرّرات مسودة، وما سواها يبقى بترتيبه: agent_unlink_twin (ترحيل 025)، أو قبله قراءة ثم كتابة
function unlinkTwin(db: SupabaseClient, id: string, draftId: string, twinDraftId: string): Promise<boolean> {
  return twinWrite(db, id, draftId, "agent_unlink_twin", { p_draft: draftId, p_twin_draft: twinDraftId }, (list) => withoutTwin(list, twinDraftId));
}

// كتابة سطر توأم واحد بدالة القاعدة، أو بالطريق القديم (change تعيد المكرّرات الجديدة، أو null فلا كتابة) إن لم تجدها.
// false: فشلت الكتابة (مسجَّلة)
async function twinWrite(
  db: SupabaseClient, id: string, draftId: string, fn: string, args: Record<string, unknown>,
  change: (list: unknown) => unknown[] | null,
): Promise<boolean> {
  const { error } = await db.rpc(fn, args);
  if (!error) return true;
  if (!rpcMissing(error)) {
    console.error("agent-run twins", fn, id, error.message);
    return false;
  }
  console.error("agent-run twins:", fn, "missing (migration 025 not applied), read-modify-write", id);
  const { data: other, error: readErr } = await db.from("agent_drafts").select("duplicates").eq("id", draftId).maybeSingle();
  if (readErr) {
    console.error("agent-run twins", fn, id, readErr.message);
    return false;
  }
  const list = other ? change(other.duplicates) : null;
  if (!list) return true;
  const { error: writeErr } = await db.from("agent_drafts").update({ duplicates: list }).eq("id", draftId);
  if (writeErr) console.error("agent-run twins", fn, id, writeErr.message);
  return !writeErr;
}

// خطة twinPlan على مكرّرات مسودة: ما في remove يُفكّ أولاً (فسطرٌ تغيّر يُستبدل ولا يمنع إلحاقَ الجديد)، ثم يُلحق ما في add.
// عدد الكتابات التي فشلت
async function applyTwinPlan(db: SupabaseClient, id: string, draftId: string, plan: TwinPlan): Promise<number> {
  let failed = 0;
  for (const twinDraftId of plan.remove) if (!await unlinkTwin(db, id, draftId, twinDraftId)) failed++;
  for (const entry of plan.add) if (!await linkTwin(db, id, draftId, entry)) failed++;
  return failed;
}

// إعادة مطابقة مسودة مشروع جديد معلّقة بمقترحها الحالي بعد تعديله (التوائم حُسبت عند إنشائها، والتعديل قد يُسقط
// مطابقةً أو يُنشئ أخرى). سطور التوائم في مكرّراتها تُعاد كتابتها، وتُفكّ من مكرّرات المسودات التي لم تعد تطابقها
// وتُربط بالتي صارت تطابقها (twinRecheck). مرشّحو المشاريع في المكرّرات يبقون كما هم. توأمٌ اعتُمد وصار مشروعاً يُفحص
// ليبقى سطره ما دام يطابق أو يسقط، ولا يُكتب في مكرّراته. كل سطر يُكتب وحده، فلا تُمحى سطور يلحقها تشغيل متزامن.
// null: تعذّرت قراءة المسودات، فلا كتابة (فشل القراءة لا يعني أن التوائم كلها سقطت)
// deno-lint-ignore no-explicit-any
async function recheckTwins(db: SupabaseClient, draft: any) {
  const rows = await pendingDrafts(db, draft.request_id);
  if (!rows) return null;
  // سطور المسودة تُقرأ بعد قائمة المعلّقة: سطرٌ أضافه استخراجٌ متزامن بين القراءتين يدخل المطابقة فيُزال إن لم يعد يطابق
  const { data: fresh, error: freshErr } = await db.from("agent_drafts").select("duplicates").eq("id", draft.id).maybeSingle();
  if (freshErr || !fresh) return null;
  draft.duplicates = fresh.duplicates;
  // سطور المسودة لمسودات ليست بين المعلّقة: المطبَّقة منها تُفحص، وما سواها (مرفوضة أو محذوفة) يبقى
  const known = new Set(rows.map((r) => r.id));
  const elsewhere = twinLines(draft.duplicates).map((t) => t.draft_id).filter((x) => !known.has(x) && UUID.test(x));
  // deno-lint-ignore no-explicit-any
  let applied: any[] = [];
  if (elsewhere.length) {
    const { data, error } = await db.from("agent_drafts").select("id, request_id, proposed, evidence")
      .in("id", elsewhere).eq("status", "applied");
    if (error) {
      console.error("agent-run twins recheck", draft.id, error.message);
      return null;
    }
    applied = data ?? [];
  }
  const checked: TwinCheck[] = [];
  // deno-lint-ignore no-explicit-any
  const check = (row: any, pending: boolean) => {
    const reason = checkTwin(draft, row);
    if (reason !== undefined) {
      checked.push({ id: row.id, request_id: row.request_id, proposed: row.proposed, duplicates: row.duplicates, reason, pending });
    }
  };
  rows.forEach((row) => check(row, true));
  applied.forEach((row) => check(row, false));
  const { own, others, ...summary } = twinRecheck(draft, checked);
  let failed = await applyTwinPlan(db, draft.request_id, draft.id, own);
  for (const other of others) failed += await applyTwinPlan(db, draft.request_id, other.draft_id, other.plan);
  return { ...summary, failed };
}

/* ===================== الحي من اسم المشروع ===================== */

// أحياء المشاريع القائمة كما تعرضها قائمة الأحياء في الـ CRM (crm_districts: المعتمدة غير المحذوفة)، قيمةً لكل مشروع
// فيُعرض الحي بإملائه الأكثر وروداً. صفحةً صفحة بسقف صفوف PostgREST (1000). null: تعذّرت القراءة، فلا ملاحظة
interface KnownDistrict {
  district: string;
  city: string | null;
}

async function knownDistricts(db: SupabaseClient, id: string): Promise<KnownDistrict[] | null> {
  const PAGE = 1000;
  const out: KnownDistrict[] = [];
  for (let from = 0; from < 20 * PAGE; from += PAGE) {
    const { data, error } = await db.from("projects").select("district, city")
      .not("district", "is", null).eq("status", "approved").is("deleted_at", null)
      .order("id").range(from, from + PAGE - 1);
    if (error) {
      console.error("agent-run districts", id, error.message);
      return null;
    }
    const rows = (data ?? []) as { district: unknown; city: unknown }[];
    for (const r of rows) {
      if (typeof r.district === "string") out.push({ district: r.district, city: typeof r.city === "string" ? r.city : null });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

// المدينة للمقارنة: «جدة» = «مدينة جدة» = «جده»
const cityKey = (raw: unknown) =>
  typeof raw === "string" ? normText(raw).split(" ").filter((w) => w && w !== "مدينه" && w !== "بمدينه").join(" ") : "";

// مسودة مشروع جديد بلا حيّ واسمها الحقيقي يذكر حيّاً واحداً من أحياء المشاريع القائمة («جوهرة الصفا»): ملاحظة للمدير
// (district_from_name، validate.ts) لا قيمة — الحي لا يدخل المقترح. الأحياء لا تُقرأ إلا لمسودة كهذه. الملاحظة إضافة لا
// يتوقف عليها شيء: تعذّر القراءة أو خطأٌ في الفحص يُسجَّل ولا يوقف الاستخراج
// ضجيج أقل: لا ملاحظة إن كان في المسودة عنوان (موضعها مذكور فيه على الأرجح) أو تعارضٌ على الحي (ذكره المصدر ورُفض أو
// استُنتج، فالمدير يراه). أحياء مدينة المسودة وحدها إن عُرفت مدينتها، وحيٌّ في مشروعين قائمين على الأقل
// (اسمٌ ورد مرة قد يكون اسم مبنى كُتب حيّاً)
async function noteDistrictFromName(id: string, draft: DraftSpec, districts: () => Promise<KnownDistrict[] | null>) {
  try {
    if (!districtHintName(draft)) return;
    const address = draft.proposed.address;
    if (typeof address === "string" && address.trim()) return;
    if (draft.conflicts.some((c) => c.field === "district")) return;
    const all = await districts();
    if (!all) return;
    const city = cityKey(draft.proposed.city);
    const known = all.filter((k) => !city || !k.city || cityKey(k.city) === city).map((k) => k.district);
    const district = districtFromName(draft, known, 2);
    if (district) draft.conflicts.push(districtNote(district));
  } catch (e) {
    console.error("agent-run districts", id, String((e as Error)?.message ?? e).slice(0, 200));
  }
}

/* ===================== التحديث: تحديد السجل الهدف ===================== */

type UpdatePick = DraftSpec[] | "asked" | { fail: string; note: string };

interface ProjectFacts {
  name: string;
  price: unknown;
  area: unknown;
  // deno-lint-ignore no-explicit-any
  details: any;
}

// اسم المشروع ومساحته وسعره وتفاصيله لمرشّحي التحديث (هل اسمه مقترح؟ وما يميّزه في القائمة). null: تعذّرت القراءة
async function projectFacts(db: SupabaseClient, ids: string[]): Promise<Map<string, ProjectFacts & { suggested: boolean }> | null> {
  const nums = ids.map(Number).filter(Number.isInteger);
  if (!nums.length) return new Map();
  const { data, error } = await db.from("projects").select("id, name, price, area, details").in("id", nums);
  if (error) return null;
  const rows = (data ?? []) as (ProjectFacts & { id: number })[];
  const marked = await suggestedNames(db, rows);
  if (!marked) return null;
  return new Map(rows.map((r) => [String(r.id), { ...r, suggested: marked.has(String(r.id)) }]));
}

// اسم المشروع مقترح (وصفي) ما دام هو الاسم الذي بناه المساعد: details.name_suggested، أو دليل مسودة الاعتماد
// التي أنشأته (evidence.name.suggested) إن ضاعت العلامة من details (مسودات ما قبل العلامة، أو تعديل من اللوحة).
// اسمٌ عدّله المدير بعدها لم يعد مقترحاً.
async function suggestedNames(db: SupabaseClient, rows: (ProjectFacts & { id: number })[]): Promise<Set<string> | null> {
  const out = new Set<string>();
  const rest: (ProjectFacts & { id: number })[] = [];
  for (const r of rows) {
    if (typeof r.details?.name_suggested === "string" && r.details.name_suggested === r.name) out.add(String(r.id));
    else rest.push(r);
  }
  if (!rest.length) return out;
  const { data, error } = await db.from("agent_drafts").select("applied_record, evidence")
    .eq("target_kind", "project").is("target_id", null).eq("status", "applied")
    .in("applied_record", rest.map((r) => String(r.id)));
  if (error) return null;
  for (const d of data ?? []) {
    const ev = d.evidence?.name;
    const r = rest.find((x) => String(x.id) === String(d.applied_record));
    if (r && ev && typeof ev.suggested === "string" && ev.stated !== true && ev.suggested === r.name) out.add(String(r.id));
  }
  return out;
}

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
    // المشروع الذي اسمه مقترح («فيلا – حي السامر – 650م») وصفٌ لا هوية: لا يُربط به تحديث تلقائياً، ويختار المدير.
    // المساحة والسعر ورقم المشروع في كل خيار تميّز المتشابهة.
    const facts = await projectFacts(db, list.map((c) => String(c.id)));
    // تعذّرت القراءة: لا ربط تلقائي، يختار مقدّم الطلب
    const generic = (pid: string) => facts === null || Boolean(facts.get(pid)?.suggested);
    if (exact.length === 1 && !generic(String(exact[0].id))) {
      projectId = Number(exact[0].id);
    } else {
      return askUser(db, id, list.map((c) => {
        const f = facts?.get(String(c.id));
        const extra = [
          f && Number(f.area) > 0 ? fmtArea(Number(f.area)) : "",
          f && Number(f.price) > 0 ? fmtPrice(Number(f.price)) : "",
        ].filter(Boolean);
        return {
          id: String(c.id), kind: "project", label: [c.name, c.district, ...extra, "#" + c.id].filter(Boolean).join(" — "),
          reason: facts?.get(String(c.id))?.suggested ? "اسمه مقترح (وصفي) — تحقق أنه المقصود" : c.reason,
        };
      }), exact.length === 1 && facts !== null
        ? "المشروع المطابق اسمه مقترح (وصفي) لا اسمٌ ذكره مصدر — اختر المشروع المقصود"
        : "تعذّر تحديد المشروع المقصود بثقة — اختر المشروع",
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
  // هدفٌ اسمه مقترح اختاره مقدّم الطلب من الخيارات: يُنبَّه المدير عند الاعتماد أن الربط اختيارٌ لا تطابقُ اسم
  const row = projectSnap.row;
  if (drafts.length && (await projectFacts(db, [String(projectId)]))?.get(String(projectId))?.suggested) {
    for (const d of drafts) {
      d.conflicts.push({
        note: "المشروع الهدف «" + row.name + "» اسمه مقترح (وصفي)، واختير من الخيارات لا بتطابق الاسم — تحقق أنه المقصود قبل الاعتماد",
        code: "target_suggested_name",
      });
    }
  }
  return drafts;
}
