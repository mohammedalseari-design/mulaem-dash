// نظام ملائم العقاري — وظيفة الاستخراج agent-run (الجولة B من docs/TASK_AGENT.md)
//
// ثلاثة أفعال:
//   status — للمستخدم المسجَّل: هل الاستخراج مفعَّل (هل ضُبط ANTHROPIC_API_KEY)؟
//   run    — للمستخدم الذي يرى الطلب: يبدأ التنفيذ ويعود فوراً؛ العمل يكمل في الخلفية.
//   sweep  — لمهمة pg_cron فقط (سر في Vault): يعيد استدعاء الطلبات العالقة.
//
// ما لا تفعله هذه الوظيفة أبداً: الكتابة في projects / clients / client_requirements.
// تكتب مسودات في agent_drafts وحالة الطلب فقط؛ الاعتماد في Postgres (agent_apply_draft).
// المفتاح يُقرأ من أسرار Supabase ولا يغادر هذه الوظيفة.
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.110.0";
import { kindPrompt, schemaFor, SYSTEM_PROMPT } from "./schema.ts";
import { loadSources, SourceError, type SourceRow } from "./sources.ts";
import {
  buildClientDraft, buildProjectDraft, buildUpdateDraft, type DraftSpec, hasProjectChanges, hasUnitChanges,
  matchUnit, type PhoneNormalizer, updateTarget,
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

const MODEL = Deno.env.get("AGENT_MODEL") ?? "claude-opus-5";
const MAX_ATTEMPTS = 3; // محاولات الطلب الواحد (تشمل ما يعيده المُجدوِل)
const LEASE_SECONDS = 300; // أطول من حد تشغيل الوظيفة، فلا يعمل نداءان على طلب واحد
const MAX_INPUT_TOKENS = Number(Deno.env.get("AGENT_MAX_INPUT_TOKENS") ?? 150_000); // سقف مدخلات الطلب الواحد
const MAX_OUTPUT_TOKENS = 16_000; // سقف الناتج
const SWEEP_BATCH = 3;

const DISABLED_AR = "الاستخراج التلقائي غير مفعّل — لم يُضبط مفتاح الخدمة بعد. الطلب محفوظ ومرفقاته مخزّنة.";

const apiKey = () => (Deno.env.get("ANTHROPIC_API_KEY") ?? "").trim();

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
      EdgeRuntime.waitUntil((async () => {
        for (const id of list) await processRequest(db, id);
      })());
      return json({ status: "accepted", count: list.length }, 202);
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
      EdgeRuntime.waitUntil(processRequest(db, id));
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

async function processRequest(db: SupabaseClient, id: string) {
  // الحجز ذرّي في القاعدة: إن كان طلب آخر يعمل عليه أو انتهى، لا شيء يحدث هنا
  const { data: claimed, error: claimErr } = await db.rpc("agent_claim_request", {
    p_request: id, p_lease_seconds: LEASE_SECONDS, p_max_attempts: MAX_ATTEMPTS,
  });
  const request = Array.isArray(claimed) ? claimed[0] : claimed;
  if (claimErr || !request) return;

  let tokens = request.tokens_used ?? 0;
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

    // 2) الاستخراج
    await stage(db, id, "extracting");
    const client = new Anthropic({ apiKey: key, maxRetries: 2, timeout: 110_000 });
    const content = [
      ...loaded.blocks,
      {
        type: "text",
        text: `${kindPrompt(request.kind)}\n\n<employee_request>\n${String(request.instruction).slice(0, 4000)}\n</employee_request>`,
      },
    ];
    const params = {
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: { type: "json_schema", schema } },
      messages: [{ role: "user", content }],
    };

    // سقف المدخلات قبل الإنفاق: عدّ الرموز أولاً (نداء مجاني) ورفض ما يتجاوز الحد
    const counted = await client.messages.countTokens({
      model: MODEL, system: SYSTEM_PROMPT, messages: params.messages,
      // deno-lint-ignore no-explicit-any
    } as any);
    if (counted.input_tokens > MAX_INPUT_TOKENS) {
      throw new Stop(`المصادر أطول من سقف الطلب الواحد (${counted.input_tokens.toLocaleString("en")} رمزاً من ${MAX_INPUT_TOKENS.toLocaleString("en")}) — قسّمها على أكثر من طلب`);
    }

    // fallbacks: "default" — إن رفض النموذج لسبب أمان يُعاد الطلب على نموذج بديل داخل النداء نفسه
    // deno-lint-ignore no-explicit-any
    const message: any = await client.beta.messages.create({
      ...params,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // deno-lint-ignore no-explicit-any
    } as any);
    const usage = message.usage ?? {};
    tokens += (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)
      + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);

    if (message.stop_reason === "refusal") throw new Stop("رفض النموذج معالجة هذا المصدر");
    if (message.stop_reason === "max_tokens") throw new Stop("الناتج أطول من السقف — قسّم المصادر على أكثر من طلب");
    const text = (message.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
    let out: unknown;
    try {
      out = JSON.parse(text);
    } catch {
      throw new Stop("ناتج غير صالح من النموذج", true);
    }

    // 3) التحقق المستقل وبناء المسودات
    await stage(db, id, "validating");
    const normalizePhone: PhoneNormalizer = async (raw) => {
      const { data } = await db.rpc("normalize_phone", { p: raw });
      return typeof data === "string" ? data : null;
    };

    const drafts: DraftSpec[] = [];
    if (request.kind === "client") {
      const draft = await buildClientDraft(out, loaded.srcs, normalizePhone);
      await attachClientDuplicates(db, draft);
      drafts.push(draft);
    } else if (request.kind === "project") {
      const draft = await buildProjectDraft(out, loaded.srcs, normalizePhone);
      const { data: dups } = await db.rpc("agent_find_duplicates", { p_kind: "project", p: draft.proposed });
      draft.duplicates = Array.isArray(dups) ? dups : [];
      drafts.push(draft);
    } else {
      const picked = await buildUpdateDrafts(db, id, request.target_id, out, loaded.srcs, normalizePhone);
      if (picked === "asked") {
        await finish(db, id, { status: "ready", tokens_used: tokens, error_ar: null });
        return;
      }
      drafts.push(...picked);
    }

    if (!drafts.some((d) => Object.keys(d.proposed).length)) {
      throw new Stop("لم يُستخرج من المصادر أي حقل مدعوم بدليل — راجع المصدر أو التعليمات");
    }

    for (const d of drafts) {
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
        status: "draft",
        created_by: request.requested_by,
      }).select("id").single();
      if (error || !row) throw new Stop("تعذّر حفظ المسودة", true);
      inserted.push(row.id);
    }

    const done = await finish(db, id, { status: "ready", tokens_used: tokens, error_ar: null });
    // أُلغي الطلب أثناء التنفيذ: لا تبقى مسودات لطلب ملغى
    if (!done && inserted.length) await db.from("agent_drafts").delete().in("id", inserted);
  } catch (e) {
    if (inserted.length) await db.from("agent_drafts").delete().in("id", inserted);
    const { message, retry } = describe(e);
    if (!(e instanceof Stop) || retry) console.error("agent-run", id, e);
    const again = retry && (request.attempts ?? 1) < MAX_ATTEMPTS;
    await finish(db, id, {
      status: again ? "queued" : "failed",
      tokens_used: tokens || null,
      error_ar: again ? message + " — ستُعاد المحاولة تلقائياً" : message,
    });
  }
}

function describe(e: unknown): { message: string; retry: boolean } {
  if (e instanceof Stop) return { message: e.message, retry: e.retry };
  if (e instanceof SourceError) return { message: e.message, retry: false };
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return { message: "مفتاح خدمة الاستخراج غير صالح أو بلا صلاحية", retry: false };
  }
  if (e instanceof Anthropic.RateLimitError) return { message: "خدمة الاستخراج مشغولة الآن", retry: true };
  if (e instanceof Anthropic.BadRequestError) return { message: "رفضت خدمة الاستخراج الطلب — قد يكون الملف تالفاً أو كبيراً", retry: false };
  if (e instanceof Anthropic.APIConnectionError || e instanceof Anthropic.InternalServerError) {
    return { message: "تعذّر الوصول إلى خدمة الاستخراج", retry: true };
  }
  if (e instanceof Anthropic.APIError) return { message: "خطأ من خدمة الاستخراج", retry: (e.status ?? 0) >= 500 };
  return { message: "خطأ داخلي أثناء التنفيذ", retry: true };
}

async function stage(db: SupabaseClient, id: string, value: string) {
  await db.from("agent_requests").update({ stage: value }).eq("id", id).eq("status", "running");
}

// الإنهاء بشرط أن الطلب ما زال قيد التنفيذ: الإلغاء من المستخدم لا يُداس عليه.
async function finish(db: SupabaseClient, id: string, patch: Record<string, unknown>): Promise<boolean> {
  const { data } = await db.from("agent_requests")
    .update({ ...patch, stage: null, lease_until: null })
    .eq("id", id).eq("status", "running").select("id");
  return Boolean(data && data.length);
}

/* ===================== المكرّرات والعميل القائم ===================== */

// الجوال المطبَّع أولاً، والاسم وحده لا يُعدّ تطابقاً. إن طابق الجوال عميلاً واحداً قائماً،
// تصير المسودة تعديلاً عليه (والطلب العقاري يُضاف لملفه) بدل عميل ثانٍ برقم مكرر.
async function attachClientDuplicates(db: SupabaseClient, draft: DraftSpec) {
  const { data: dups } = await db.rpc("agent_find_duplicates", { p_kind: "client", p: draft.proposed });
  draft.duplicates = Array.isArray(dups) ? dups : [];
  if (draft.duplicates.length !== 1) {
    if (draft.duplicates.length > 1) {
      draft.conflicts.push({ note: "الجوال يطابق أكثر من عميل قائم — راجع المكرّرات قبل الاعتماد" });
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
  draft.conflicts.push({ note: "الجوال مسجّل للعميل «" + (existing.name ?? "") + "» — المسودة تعديل على ملفه لا عميل جديد" });
}

/* ===================== التحديث: تحديد السجل الهدف ===================== */

async function askUser(db: SupabaseClient, id: string, candidates: unknown[], message: string): Promise<"asked"> {
  if (!candidates.length) throw new Stop(message.replace("اختر", "لم يُعثر على") + " — راجع الاسم في المصدر");
  await db.from("agent_requests").update({ candidates, error_ar: message }).eq("id", id).eq("status", "running");
  return "asked";
}

async function buildUpdateDrafts(
  db: SupabaseClient, id: string, pickedTarget: string | null, out: unknown,
  srcs: Parameters<typeof buildUpdateDraft>[1], normalizePhone: PhoneNormalizer,
): Promise<DraftSpec[] | "asked"> {
  const target = updateTarget(out);
  const wantsUnit = hasUnitChanges(out);
  const wantsProject = hasProjectChanges(out);
  if (!wantsUnit && !wantsProject) throw new Stop("لم يذكر المصدر أي تغيير قابل للتطبيق");

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
      })), "تعذّر تحديد المشروع المقصود بثقة — اختر المشروع");
    }
  }

  const { data: projectSnap } = await db.rpc("agent_target_snapshot", { p_kind: "project", p_id: String(projectId) });
  if (!projectSnap?.hash) throw new Stop("المشروع المختار لم يعد موجوداً");

  const drafts: DraftSpec[] = [];
  if (wantsProject) {
    const d = await buildUpdateDraft(out, srcs, normalizePhone, "project", String(projectId), projectSnap.row, projectSnap.hash);
    if (d) drafts.push(d);
  }

  // 2) الوحدة داخل المشروع: الاسم المطبَّع، وإلا يُسأل الموظف من وحدات هذا المشروع
  if (wantsUnit) {
    if (unitOrd === null) {
      const m = matchUnit(projectSnap.row?.details?.models, target.unit_name);
      if (m.ord === null) {
        return askUser(db, id, m.candidates.map((c) => ({
          id: projectId + "/" + c.ord, kind: "unit", label: projectSnap.row?.name + " — " + c.name, reason: "وحدة في المشروع",
        })), "تعذّر تحديد الوحدة المقصودة بثقة — اختر الوحدة");
      }
      unitOrd = m.ord;
    }
    const { data: unitSnap } = await db.rpc("agent_target_snapshot", { p_kind: "unit", p_id: projectId + "/" + unitOrd });
    if (!unitSnap?.hash) throw new Stop("الوحدة المختارة لم تعد موجودة");
    const d = await buildUpdateDraft(out, srcs, normalizePhone, "unit", projectId + "/" + unitOrd, unitSnap.row, unitSnap.hash);
    if (d) drafts.push(d);
  }
  return drafts;
}
