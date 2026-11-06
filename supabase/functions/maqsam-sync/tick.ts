// نظام ملائم العقاري — نقل ملخصات مقسم إلى ملاحظات في Zoho: دورة واحدة يناديها pg_cron كل خمس دقائق ما دام النقل مفعّلاً.
//
// لا يناديها إلا من يحمل السر من Vault، والمقارنة في القاعدة (maqsam_sync_cron_secret_ok). ترد 202 فوراً وتعمل في الخلفية، فمهلة pg_net خمس ثوان.
//
// ما يهم في الدورة:
//   * لا ملاحظتان لمكالمة: تُحجز المكالمة قبل الكتابة، وحجز مات صاحبه يُبحث عن عنوانه في Zoho قبل أي إعادة.
//   * لا كتابة بعد الإيقاف: الحجز نفسه يقرأ «مفعّل» في معاملته.
//   * لا نداء لـ Zoho ولا تجديد مفتاح إن لم يكن هناك ما يُفعل.
//   * السجل أعداد ورموز فقط، وما يُحفظ رقم المكالمة وحالتها ومعرّفات Zoho. نص الملخص ورقم العميل لا يبقيان بعد الدورة.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { type ApiFail, Budget, type Net, RECONNECT_CODES, ZohoSession } from "../zoho-link/core.ts";
import {
  hasSummary,
  isCandidate,
  lookupCustomer,
  type Match,
  PAGE_CALLS,
  parseCall,
  parseCallId,
  type ParsedCall,
  readCall,
  readCallsPage,
  STALE_MINUTES,
  writeWithClaim,
} from "../zoho-link/notes.ts";
import { type CallRow, safeTag, type Store, StoreError, supabaseStore } from "../zoho-link/store.ts";

export const MAX_WRITES = 25;
export const MAX_PAGES = 20;
export const TICK_BUDGET_MS = 100_000;
export const LEASE_SECONDS = 240;
// لا يبدأ نداء جديد إن بقي أقل من هذا: أسوأ سلسلة لمكالمة واحدة (بحثان وكتابة) بمهلها
const WORK_MARGIN_MS = 15_000;
const MAX_OPEN_READS = 25;
const OPEN_ROWS = 500;
const HOUR_MS = 3_600_000;
const WAIT_LIMIT_MS = 48 * HOUR_MS;
const FINAL = ["written", "no_match", "no_summary", "failed"];
const CRON_HEADER = "x-maqsam-sync-cron";
const MAX_SECRET_CHARS = 256;

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

export interface TickDeps extends Store {
  secretOk: (secret: string) => Promise<boolean>;
  background: (work: Promise<unknown>) => void;
  fetch: Net["fetch"];
  now: () => number;
  callTimeoutMs?: number;
  budgetMs?: number;
}

export interface TickCounts {
  pages: number;
  calls: number;
  candidates: number;
  written: number;
  already_written: number;
  waiting: number;
  no_match: number;
  no_summary: number;
  ambiguous: number;
  refused: number;
  skipped_malformed: number;
}

export interface TickResult {
  code: string;
  cursor: string | null;
  counts: TickCounts;
}

const stopCode = (code: ApiFail): string => code === "refused" || code === "not_found" ? "bad_response" : code;

function netOf(deps: TickDeps): Net {
  return {
    fetch: deps.fetch,
    callTimeoutMs: deps.callTimeoutMs,
    // الرمز والحالة فقط، بلا جسم ولا مرحلة تحمل قيمة
    onShape: (shape) => {
      if (shape.status !== null && (shape.status >= 400 || shape.code !== null)) console.info("maqsam-sync", "http", shape.stage, shape.status, shape.code);
    },
  };
}

async function work(deps: TickDeps, startFrom: string | null, scanCursor: string | null, counts: TickCounts): Promise<{ code: string; cursor: string | null }> {
  const zoho = await deps.credentials();
  if (!zoho) return { code: "zoho_not_connected", cursor: null };
  const maqsam = await deps.maqsamCredentials();
  if (!maqsam) return { code: "maqsam_not_connected", cursor: null };

  const nowMs = deps.now();
  const budget = new Budget(deps.now, deps.budgetMs ?? TICK_BUDGET_MS);
  const net = netOf(deps);
  const startMs = Math.max(startFrom ? Date.parse(startFrom) : nowMs, scanCursor ? Date.parse(scanCursor) : 0);
  const startSec = Math.floor(startMs / 1000);
  const endSec = Math.floor(nowMs / 1000);

  // المكالمات في النافذة. الصفحات تقف عند صفحة ناقصة، أو عند صفحة لا جديد فيها فلا تدور دورة لا تنتهي
  const seen = new Map<number, ParsedCall>();
  let capped = false;
  for (let page = 1;; page++) {
    if (page > MAX_PAGES) {
      capped = true;
      break;
    }
    const reply = await readCallsPage(maqsam, startSec, endSec, page, net, budget.left());
    if (!reply.ok) return { code: `maqsam_${reply.code}`, cursor: null };
    counts.pages = page;
    let fresh = 0;
    for (const raw of reply.calls) {
      const call = parseCall(raw);
      if (call === null) {
        counts.skipped_malformed++;
        continue;
      }
      if (!seen.has(call.id)) fresh++;
      seen.set(call.id, call);
    }
    if (reply.calls.length < PAGE_CALLS || fresh === 0) break;
  }
  counts.calls = seen.size;

  const candidates = [...seen.values()].filter(isCandidate);
  counts.candidates = candidates.length;
  const known = await deps.knownCalls(candidates.map((call) => call.id));

  const isStale = (row: CallRow) => row.status === "claimed" && (row.updated_at === null || nowMs - Date.parse(row.updated_at) >= STALE_MINUTES * 60_000);
  const isDue = (row: CallRow) => row.status === "waiting" && (row.next_try_at === null || Date.parse(row.next_try_at) <= nowMs);

  // مكالمات مفتوحة خرجت من النافذة: تنتظر منذ قرابة 48 ساعة، أو حجز مات صاحبه. تُقرأ بأرقامها ليفصل فيها الدور التالي، وإلا بقيت معلقة إلى الأبد
  const open = (await deps.openCalls(OPEN_ROWS)).filter((row) => !seen.has(row.call_id) && (isStale(row) || isDue(row)));
  for (const row of open.slice(0, MAX_OPEN_READS)) {
    const callId = parseCallId(row.call_id);
    if (callId === null) continue;
    const read = await readCall(maqsam, callId, net, budget.left());
    if (!read.ok) {
      // مكالمة لا تُقرأ لا توقف ما بعدها
      if (read.code === "bad_response") continue;
      if (read.code !== "not_found") return { code: `maqsam_${read.code}`, cursor: null };
      // لم تعد عند مقسم، فلا ملخص يأتي منها أبداً
      if (row.status === "claimed") await deps.release({ call_id: callId, count: true });
      else await deps.mark({ call_id: callId, status: "no_summary", next_try_at: null });
      continue;
    }
    const call = parseCall(read.call);
    if (call === null || call.id !== callId || !isCandidate(call)) {
      if (row.status === "claimed") await deps.release({ call_id: callId, count: true });
      else await deps.mark({ call_id: callId, status: "no_summary", next_try_at: null });
      continue;
    }
    candidates.push(call);
    known.set(callId, row);
  }
  if (open.length > MAX_OPEN_READS) capped = true;

  // ما لا يحتاج Zoho يُنهى هنا، وما يحتاجه ينتظر دوره بترتيب وقوعه، فتتتابع الملاحظات كما وقعت
  const queue: (ParsedCall & { summary: string })[] = [];
  for (const call of candidates) {
    const row = known.get(call.id);
    if (row && FINAL.includes(row.status)) {
      if (row.status === "written") counts.already_written++;
      continue;
    }
    if (row?.status === "claimed" && !isStale(row)) continue;
    const old = nowMs - call.atMs > WAIT_LIMIT_MS;
    if (!hasSummary(call)) {
      if (row?.status === "claimed") {
        await deps.release({ call_id: call.id, count: true });
      } else if (old) {
        await deps.mark({ call_id: call.id, status: "no_summary", next_try_at: null });
        counts.no_summary++;
      } else if (!row) {
        await deps.mark({ call_id: call.id, status: "waiting", next_try_at: null });
        counts.waiting++;
      }
      continue;
    }
    if (row?.status === "waiting" && row.next_try_at !== null && Date.parse(row.next_try_at) > nowMs) continue;
    queue.push(call);
  }
  queue.sort((a, b) => a.atMs - b.atMs);

  if (queue.length === 0) return { code: capped ? "capped" : "ok", cursor: capped ? null : new Date(nowMs - WAIT_LIMIT_MS).toISOString() };

  // المفتاح يُطلب عند أول حاجة حقيقية
  const session = new ZohoSession(zoho, zoho.refresh_token, { net, refreshBegin: deps.refreshBegin, tokenDenied: deps.tokenDenied }, budget);
  const found = new Map<string, Match | null>();
  // يقف ولا يكمل: 429 أو 5xx حتى الدورة التالية، وما لا يصلحه إلا مدير يرفع علامته أيضاً. الموضع يبقى، فلا يضيع شيء
  const stopped = async (code: ApiFail): Promise<{ code: string; cursor: null }> => {
    const final = stopCode(code);
    if (RECONNECT_CODES.includes(final)) await deps.setReconnect(zoho.connected_at, true);
    return { code: final, cursor: null };
  };

  for (const call of queue) {
    if (counts.written >= MAX_WRITES || budget.left() < WORK_MARGIN_MS) {
      capped = true;
      break;
    }
    const row = known.get(call.id);
    let match: Match | null = null;
    if (row?.status === "claimed" && (row.zoho_module === "Leads" || row.zoho_module === "Contacts") && row.zoho_record_id) {
      // حجز مات صاحبه: يبقى على السجل الذي حُجز له، ويبحث writeWithClaim بالعنوان أولاً، فلا يُكتب مرتين ولو تغيّر العميل
      match = { module: row.zoho_module, id: row.zoho_record_id, ambiguous: false };
    } else if (call.number !== null) {
      if (found.has(call.number)) {
        match = found.get(call.number) ?? null;
      } else {
        const lookup = await lookupCustomer(session, call.number);
        if (!lookup.ok) return await stopped(lookup.code);
        match = lookup.match;
        found.set(call.number, match);
      }
    }
    if (!match) {
      if (nowMs - call.atMs > WAIT_LIMIT_MS) {
        await deps.mark({ call_id: call.id, status: "no_match", next_try_at: null });
        counts.no_match++;
      } else {
        await deps.mark({ call_id: call.id, status: "waiting", next_try_at: new Date(nowMs + HOUR_MS).toISOString() });
        counts.waiting++;
      }
      continue;
    }
    if (match.ambiguous) counts.ambiguous++;
    const outcome = await writeWithClaim(session, deps, call, match, true);
    switch (outcome.kind) {
      case "written":
        if (outcome.fresh) counts.written++;
        else counts.already_written++;
        break;
      case "refused":
        counts.refused++;
        break;
      case "busy":
        break;
      case "disabled":
        // أُوقف النقل أثناء الدورة: لا كتابة بعد الآن، والموضع يبقى
        return { code: "ok", cursor: null };
      case "stop":
        return await stopped(outcome.code);
    }
  }
  return { code: capped ? "capped" : "ok", cursor: capped ? null : new Date(nowMs - WAIT_LIMIT_MS).toISOString() };
}

// دورة كاملة. لا ترمي أبداً: تعمل في الخلفية بلا من يسمع، فكل فشل له سطر سجل ورمز في صف الحالة.
export async function runTick(deps: TickDeps): Promise<TickResult | null> {
  const counts: TickCounts = {
    pages: 0,
    calls: 0,
    candidates: 0,
    written: 0,
    already_written: 0,
    waiting: 0,
    no_match: 0,
    no_summary: 0,
    ambiguous: 0,
    refused: 0,
    skipped_malformed: 0,
  };
  let began;
  try {
    began = await deps.runBegin(LEASE_SECONDS);
  } catch (error) {
    console.error("maqsam-sync", "run-begin", safeTag(error));
    return null;
  }
  if (!began.started) {
    console.info("maqsam-sync", "skipped", began.reason === "off" || began.reason === "busy" || began.reason === "needs_reconnect" ? began.reason : "unknown");
    return null;
  }

  let result: { code: string; cursor: string | null };
  try {
    result = await work(deps, began.start_from ?? null, began.scan_cursor ?? null, counts);
  } catch (error) {
    console.error("maqsam-sync", "work", safeTag(error));
    result = { code: "server_error", cursor: null };
  }
  try {
    await deps.runEnd(result.code, result.cursor);
  } catch (error) {
    console.error("maqsam-sync", "run-end", safeTag(error));
  }
  console.info("maqsam-sync", "done", result.code, JSON.stringify(counts));
  return { ...result, counts };
}

// السر قبل كل شيء، ولا يُقرأ الجسم أصلاً: الدورة لا تأخذ مدخلات
export async function handle(req: Request, deps: TickDeps): Promise<Response> {
  if (req.method !== "POST") return json({ status: "error" }, 405);
  const secret = req.headers.get(CRON_HEADER) ?? "";
  try {
    if (secret.length < 32 || secret.length > MAX_SECRET_CHARS || !(await deps.secretOk(secret))) return json({ status: "error" }, 401);
  } catch (error) {
    console.error("maqsam-sync", "secret", safeTag(error));
    return json({ status: "error" }, 500);
  }
  deps.background(runTick(deps));
  return json({ status: "accepted" }, 202);
}

export function supabaseDeps(db: SupabaseClient, background: (work: Promise<unknown>) => void): TickDeps {
  return {
    ...supabaseStore(db),
    secretOk: async (secret) => {
      const { data, error } = await db.rpc("maqsam_sync_cron_secret_ok", { p_secret: secret });
      if (error) throw new StoreError("secret", error);
      return data === true;
    },
    background,
    fetch: (url, init) => fetch(url, init),
    now: () => Date.now(),
  };
}
