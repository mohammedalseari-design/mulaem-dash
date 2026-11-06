// اختبارات دورة النقل بلا شبكة ولا قاعدة: مقسم وZoho مزيّفان، وقاعدة في الذاكرة تطابق دوال 042 (يثبتها test042.mjs على Postgres).
// كل الأسماء والأرقام مصطنعة (المستودع عام). التشغيل: deno test --allow-read --allow-env supabase/functions/maqsam-sync/
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  assertClean,
  assertNoCustomer,
  capture,
  CONTACT_ID,
  CUSTOMER_NUMBER,
  declaredParameters,
  fakeClient,
  HOUR,
  jsonReply,
  LEAD_ID,
  MAQSAM_KEYS,
  maqsamCall,
  NEW_ACCESS,
  NOW,
  NOW_ISO,
  OLD_CLIENT,
  OTHER_NUMBER,
  RENEWED_ACCESS,
  SENTINEL,
  SUMMARY_MARK,
  World,
  type WorldStart,
} from "../zoho-link/testkit.ts";
import { noteTitle } from "../zoho-link/notes.ts";
import { handle, LEASE_SECONDS, MAX_PAGES, MAX_WRITES, runTick, supabaseDeps, TICK_BUDGET_MS, type TickDeps } from "./tick.ts";

const CRON_SECRET = "SENTINEL-CRON-SECRET-0123456789-0123456789-0123456789";
const DAY = 24 * HOUR;
const WAIT_LIMIT = 48 * HOUR;

interface TickWorld extends World {
  tick: TickDeps;
  background: Promise<unknown>[];
  secretChecks: string[];
}

function world(start: WorldStart = {}): TickWorld {
  const w = new World({ connected: true, enabled: true, startFrom: new Date(NOW - 7 * DAY).toISOString(), ...start }) as TickWorld;
  w.background = [];
  w.secretChecks = [];
  w.net.token = () => jsonReply({ access_token: NEW_ACCESS, api_domain: "https://www.zohoapis.sa", expires_in: 3600 });
  w.tick = {
    ...w.deps,
    secretOk: (secret) => {
      w.secretChecks.push(secret);
      return Promise.resolve(secret === CRON_SECRET);
    },
    background: (work) => w.background.push(work),
  };
  return w;
}

const pages = (w: TickWorld, ...calls: unknown[][]) => {
  w.net.maqsamPages = calls;
};
const leadFor = (w: TickWorld, number = CUSTOMER_NUMBER, id = LEAD_ID) => w.net.leads.set(number, [{ id, Modified_Time: "2026-11-05T10:00:00+03:00" }]);
const statusOf = (w: TickWorld, id: number) => w.calls.get(id)?.status;

/* ===================== Z1: المُجدوِل وحده ===================== */

function cronRequest(secret: string | null, method = "POST", body: BodyInit | null = "{}"): Request {
  return new Request("https://functions.test/maqsam-sync", {
    method,
    headers: secret === null ? {} : { "x-maqsam-sync-cron": secret },
    body: method === "POST" ? body : undefined,
  });
}

Deno.test("Z1 handle: no secret, a wrong one, or a user's token gets 401, and no tick runs", async () => {
  for (const secret of [null, "", "short", "x".repeat(64), "x".repeat(300), `${CRON_SECRET}x`]) {
    const w = world();
    const res = await handle(cronRequest(secret), w.tick);
    assertEquals(res.status, 401, String(secret));
    assertEquals(await res.json(), { status: "error" });
    assertEquals(w.background.length, 0);
    assertEquals(w.net.seen.length, 0);
  }
  const w = world();
  const bearer = new Request("https://functions.test/maqsam-sync", { method: "POST", headers: { Authorization: "Bearer admin-token" } });
  assertEquals((await handle(bearer, w.tick)).status, 401);
  assertEquals(w.background.length, 0);
});

Deno.test("Z1 handle: too short or too long a secret does not even reach the database", async () => {
  for (const secret of ["short", "x".repeat(300)]) {
    const w = world();
    await (await handle(cronRequest(secret), w.tick)).text();
    assertEquals(w.secretChecks, []);
  }
});

Deno.test("Z1 handle: the right secret answers 202 at once, with no-store, and works in the background", async () => {
  const w = world();
  const res = await handle(cronRequest(CRON_SECRET), w.tick);
  assertEquals(res.status, 202);
  assertEquals(res.headers.get("Cache-Control"), "no-store");
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
  assertEquals(await res.json(), { status: "accepted" });
  assertEquals(w.background.length, 1);
  await w.background[0];
  assertEquals(w.runEnds.length, 1);
  assertEquals(w.secretChecks, [CRON_SECRET]);
});

Deno.test("Z1 handle: anything but POST is 405; the body is never read", async () => {
  for (const method of ["GET", "PUT", "DELETE", "OPTIONS"]) {
    const w = world();
    const res = await handle(new Request("https://functions.test/maqsam-sync", { method, headers: { "x-maqsam-sync-cron": CRON_SECRET } }), w.tick);
    assertEquals(res.status, 405, method);
    await res.text();
    assertEquals(w.background.length, 0, method);
  }
  const w = world();
  let read = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      read = true;
      controller.close();
    },
  }, { highWaterMark: 0 });
  const res = await handle(cronRequest(CRON_SECRET, "POST", body), w.tick);
  assertEquals(res.status, 202);
  assertFalse(read);
  await res.text();
  await w.background[0];
});

Deno.test("Z1 handle: a database that cannot check the secret fails closed, silently", async () => {
  const w = world();
  w.tick.secretOk = () => Promise.reject(new Error(`db ${CRON_SECRET} ${SENTINEL}`));
  const { result: res, lines } = await capture(() => handle(cronRequest(CRON_SECRET), w.tick));
  assertEquals(res.status, 500);
  assertClean(await res.text(), "reply");
  assertClean(lines, "log");
  assertEquals(w.background.length, 0);
});

/* ===================== الخروج فوراً ===================== */

Deno.test("tick: not enabled, needs reconnect or another run: exits at once with no reads and no calls", async () => {
  const cases: [WorldStart, (w: TickWorld) => void, string][] = [
    [{ enabled: false }, () => {}, "off"],
    [{ needsReconnect: true }, () => {}, "needs_reconnect"],
    [{}, (w) => w.state.lease = true, "busy"],
  ];
  for (const [start, prepare, reason] of cases) {
    const w = world(start);
    prepare(w);
    const { result, lines } = await capture(() => runTick(w.tick));
    assertEquals(result, null, reason);
    assertEquals(w.net.seen.length, 0, reason);
    assertEquals(w.credentialReads, 0, reason);
    assertEquals(w.maqsamReads, 0, reason);
    assertEquals(w.runEnds, [], reason);
    assert(lines.includes(reason), reason);
  }
});

Deno.test("tick: a link that is gone records the reason and calls nothing", async () => {
  const noZoho = world();
  noZoho.vault = null;
  assertEquals((await capture(() => runTick(noZoho.tick))).result?.code, "zoho_not_connected");
  assertEquals(noZoho.net.seen.length, 0);
  assertEquals(noZoho.runEnds, [{ code: "zoho_not_connected", cursor: null }]);
  assertEquals(noZoho.state.lease, false);

  const noMaqsam = world();
  noMaqsam.maqsamCreds = null;
  assertEquals((await capture(() => runTick(noMaqsam.tick))).result?.code, "maqsam_not_connected");
  assertEquals(noMaqsam.net.seen.length, 0);
});

Deno.test("tick: a lease that lasts longer than a tick's budget and shorter than the next tick", () => {
  assert(LEASE_SECONDS * 1000 > TICK_BUDGET_MS);
  assert(LEASE_SECONDS < 300);
  assertEquals(MAX_WRITES, 25);
  assert(TICK_BUDGET_MS <= 100_000);
  assert(MAX_PAGES >= 10);
});

/* ===================== قراءة مقسم ===================== */

Deno.test("tick: reads from the later of start_from and scan_cursor, to now, page by page, stopping at a short page", async () => {
  const startFrom = new Date(NOW - 5 * DAY).toISOString();
  const later = new Date(NOW - 2 * DAY).toISOString();
  const earlier = new Date(NOW - 6 * DAY).toISOString();
  const table: [string, string | null, string][] = [
    ["no cursor", null, startFrom],
    ["cursor after the start", later, later],
    ["cursor before the start", earlier, startFrom],
  ];
  for (const [label, cursor, from] of table) {
    const w = world({ startFrom, scanCursor: cursor });
    pages(w, Array.from({ length: 100 }, (_, i) => maqsamCall({ id: 1000 + i, state: "busy" })), [maqsamCall({ id: 2000, state: "busy" })]);
    await capture(() => runTick(w.tick));
    const urls = w.net.maqsamRequests().map((seen) => new URL(seen.url));
    assertEquals(urls.map((url) => url.searchParams.get("page")), ["1", "2"], label);
    for (const url of urls) {
      assertEquals(url.hostname, "api.av.maqsam.com", label);
      assertEquals(url.searchParams.get("start_time"), String(Math.floor(Date.parse(from) / 1000)), label);
      assertEquals(url.searchParams.get("end_time"), String(Math.floor(NOW / 1000)), label);
    }
  }
});

Deno.test("tick: pages stop when one brings nothing new, and at the cap, which leaves the cursor where it was", async () => {
  const repeat = world();
  const full = Array.from({ length: 100 }, (_, i) => maqsamCall({ id: 1000 + i, state: "busy" }));
  repeat.net.maqsam = () => jsonReply({ result: "success", message: full });
  const { result } = await capture(() => runTick(repeat.tick));
  assertEquals(repeat.net.maqsamRequests().length, 2);
  assertEquals(result?.code, "ok");

  const capped = world({ scanCursor: new Date(NOW - 3 * DAY).toISOString() });
  let page = 0;
  capped.net.maqsam = () => {
    const offset = 100 * page++;
    return jsonReply({ result: "success", message: Array.from({ length: 100 }, (_, i) => maqsamCall({ id: 100000 + offset + i, state: "busy" })) });
  };
  const second = await capture(() => runTick(capped.tick));
  assertEquals(capped.net.maqsamRequests().length, MAX_PAGES);
  assertEquals(second.result?.code, "capped");
  assertEquals(second.result?.cursor, null);
  assertEquals(capped.state.scan_cursor, new Date(NOW - 3 * DAY).toISOString());
});

Deno.test("tick: any failure reading Maqsam stops the tick with a recorded code, no Zoho call and no cursor move", async () => {
  const table: [() => Response | Promise<Response>, string][] = [
    [() => new Response(`no ${SENTINEL}`, { status: 401 }), "maqsam_unauthorized"],
    [() => new Response(`no ${SENTINEL}`, { status: 404 }), "maqsam_not_found"],
    [() => new Response(`no ${SENTINEL}`, { status: 429 }), "maqsam_rate_limited"],
    [() => new Response(`no ${SENTINEL}`, { status: 500 }), "maqsam_server_error"],
    [() => new Response(`<html>${SENTINEL}</html>`, { status: 200 }), "maqsam_bad_response"],
    [() => jsonReply({ result: "failure", message: SENTINEL }), "maqsam_bad_response"],
    [() => Promise.reject(new TypeError(`dns ${SENTINEL}`)), "maqsam_network"],
    [() => new Promise<Response>(() => {}), "maqsam_timeout"],
  ];
  for (const [respond, code] of table) {
    const w = world();
    w.net.maqsam = respond;
    const { result, lines } = await capture(() => runTick(w.tick));
    assertEquals(result?.code, code);
    assertEquals(w.runEnds, [{ code, cursor: null }]);
    assertEquals(w.net.zohoRequests().length, 0, code);
    assertEquals(w.refreshes, 0, code);
    assertEquals(w.state.scan_cursor, null, code);
    assertEquals(w.state.needs_reconnect, false, code);
    assertClean(lines, code);
  }
});

Deno.test("tick: a failure on a later page stops too: nothing after it, and the cursor stays", async () => {
  const w = world();
  let page = 0;
  w.net.maqsam = () => ++page === 1 ? jsonReply({ result: "success", message: Array.from({ length: 100 }, (_, i) => maqsamCall({ id: 1000 + i })) }) : new Response("", { status: 500 });
  leadFor(w);
  const { result } = await capture(() => runTick(w.tick));
  assertEquals(result?.code, "maqsam_server_error");
  assertEquals(w.net.noteRequests().length, 0);
  assertEquals(w.calls.size, 0);
});

Deno.test("Z3 tick: a stored Maqsam host outside the allowlist gets no request and no key", async () => {
  for (const host of ["evil.com", "maqsam.com.evil.com", "127.0.0.1"]) {
    const w = world();
    w.maqsamCreds = { ...MAQSAM_KEYS, host, connected_at: NOW_ISO };
    const { result } = await capture(() => runTick(w.tick));
    assertEquals(result?.code, "maqsam_network", host);
    assertEquals(w.net.seen.length, 0, host);
  }
});

/* ===================== من يدخل ===================== */

Deno.test("tick: other states and zero durations are skipped without a row; a malformed entry is only counted", async () => {
  const w = world();
  pages(w, [
    ...["no_answer", "busy", "dropped", "failed", "abandoned", "in_progress"].map((state, i) => maqsamCall({ id: 10 + i, state })),
    maqsamCall({ id: 20, state: "completed", duration: 0 }),
    { id: "bad" },
    5,
  ]);
  const { result } = await capture(() => runTick(w.tick));
  assertEquals(result?.code, "ok");
  assertEquals(w.calls.size, 0);
  assertEquals(result?.counts.candidates, 0);
  assertEquals(result?.counts.skipped_malformed, 2);
  assertEquals(w.net.zohoRequests().length, 0);
  assertEquals(w.refreshes, 0);
});

Deno.test("tick: nothing to do means no Zoho call and no token refresh at all, and the cursor advances", async () => {
  const empty = world();
  const { result } = await capture(() => runTick(empty.tick));
  assertEquals(result?.code, "ok");
  assertEquals(result?.cursor, new Date(NOW - WAIT_LIMIT).toISOString());
  assertEquals(empty.state.scan_cursor, new Date(NOW - WAIT_LIMIT).toISOString());
  assertEquals(empty.net.zohoRequests().length, 0);
  assertEquals(empty.refreshes, 0);

  // مكتوبة، وبلا ملخص، وتنتظر موعدها: لا شيء منها يحتاج Zoho
  const quiet = world();
  pages(quiet, [maqsamCall({ id: 1 }), maqsamCall({ id: 2, summary: null }), maqsamCall({ id: 3 }), maqsamCall({ id: 4 }), maqsamCall({ id: 5 })]);
  quiet.addCall(1, "written", { zoho_note_id: "1500000000000000999" });
  quiet.addCall(3, "waiting", { next_try_at: new Date(NOW + HOUR).toISOString() });
  quiet.addCall(4, "no_match");
  quiet.addCall(5, "failed");
  const second = await capture(() => runTick(quiet.tick));
  assertEquals(second.result?.code, "ok");
  assertEquals(quiet.net.zohoRequests().length, 0);
  assertEquals(quiet.refreshes, 0);
  assertEquals(second.result?.counts.already_written, 1);
});

Deno.test("tick: a call with no summary stays open, and becomes no_summary only past 48 hours", async () => {
  const w = world();
  pages(w, [maqsamCall({ id: 1, summary: null, ageMs: HOUR }), maqsamCall({ id: 2, summary: { ar: "", en: null }, ageMs: WAIT_LIMIT - 1000 }), maqsamCall({ id: 3, summary: null, ageMs: WAIT_LIMIT + 1000 })]);
  const { result } = await capture(() => runTick(w.tick));
  assertEquals(statusOf(w, 1), "waiting");
  assertEquals(w.calls.get(1)?.next_try_at, null);
  assertEquals(statusOf(w, 2), "waiting");
  assertEquals(statusOf(w, 3), "no_summary");
  assertEquals(result?.counts.no_summary, 1);
  assertEquals(result?.counts.waiting, 2);
  assertEquals(w.net.zohoRequests().length, 0);

  // ولا يُكتب الانتظار نفسه كل دورة
  w.marks.length = 0;
  await capture(() => runTick(w.tick));
  assertEquals(w.marks.map((mark) => mark.call_id), []);

  // وصل الملخص بعد ساعات: تُكتب ملاحظته
  pages(w, [maqsamCall({ id: 1, ageMs: 2 * HOUR })]);
  leadFor(w);
  await capture(() => runTick(w.tick));
  assertEquals(statusOf(w, 1), "written");
  assertEquals(w.net.notes.length, 1);
});

/* ===================== البحث والكتابة ===================== */

Deno.test("tick: a call with a summary and a lead gets one note, claimed first, and its ids are stored", async () => {
  const w = world();
  pages(w, [maqsamCall({ id: 1234567 })]);
  leadFor(w);
  const { result } = await capture(() => runTick(w.tick));
  assertEquals(result?.code, "ok");
  assertEquals(result?.counts.written, 1);
  assertEquals(w.net.notes.length, 1);
  const note = w.net.notes[0];
  assertEquals(note.title, "مكالمة مقسم #1234567");
  assertEquals(note.parent, { id: LEAD_ID, module: { api_name: "Leads" } });
  assertEquals(note.text.split("\n").length, 3);
  assert(note.text.includes(SUMMARY_MARK));
  const row = w.calls.get(1234567)!;
  assertEquals([row.status, row.zoho_module, row.zoho_record_id, row.zoho_note_id], ["written", "Leads", LEAD_ID, note.id]);
  assertEquals(w.refreshes, 1);
  assertEquals(w.net.tokenRequests("refresh_token").length, 1);
  assertEquals(new URLSearchParams(w.net.tokenRequests()[0].body).get("refresh_token"), OLD_CLIENT.refresh_token);
  assertEquals(w.net.noteRequests()[0].headers.Authorization, `Zoho-oauthtoken ${NEW_ACCESS}`);
});

Deno.test("tick: the customer is the callee when outbound and the caller when inbound", async () => {
  const w = world();
  pages(w, [maqsamCall({ id: 1, direction: "inbound", number: OTHER_NUMBER })]);
  leadFor(w, OTHER_NUMBER);
  await capture(() => runTick(w.tick));
  assertEquals(w.net.notes.length, 1);
  assert(w.net.notes[0].text.includes("واردة"));
});

Deno.test("tick: Leads first, then Contacts; never two records; several rows take the most recent and count as ambiguous", async () => {
  const w = world();
  pages(w, [maqsamCall({ id: 1, number: CUSTOMER_NUMBER }), maqsamCall({ id: 2, number: OTHER_NUMBER })]);
  w.net.leads.set(CUSTOMER_NUMBER, [{ id: "1500000000000000001", Modified_Time: "2026-10-01T10:00:00+03:00" }, { id: "1500000000000000002", Modified_Time: "2026-11-01T10:00:00+03:00" }]);
  w.net.contacts.set(CUSTOMER_NUMBER, [{ id: CONTACT_ID, Modified_Time: "2026-11-05T10:00:00+03:00" }]);
  w.net.contacts.set(OTHER_NUMBER, [{ id: CONTACT_ID, Modified_Time: "2026-11-05T10:00:00+03:00" }]);
  const { result } = await capture(() => runTick(w.tick));
  assertEquals(w.net.notes.length, 2);
  assertEquals(w.calls.get(1)?.zoho_record_id, "1500000000000000002");
  assertEquals(w.calls.get(1)?.zoho_module, "Leads");
  assertEquals(w.calls.get(2)?.zoho_record_id, CONTACT_ID);
  assertEquals(w.calls.get(2)?.zoho_module, "Contacts");
  assertEquals(result?.counts.ambiguous, 1);
  assertEquals(w.net.noteRequests().length, 2);
});

Deno.test("tick: one lookup per number within a tick; a no-match is remembered too", async () => {
  const w = world();
  pages(w, [maqsamCall({ id: 1 }), maqsamCall({ id: 2 }), maqsamCall({ id: 3 }), maqsamCall({ id: 4, number: OTHER_NUMBER }), maqsamCall({ id: 5, number: OTHER_NUMBER })]);
  leadFor(w);
  await capture(() => runTick(w.tick));
  const queries = w.net.apiRequests().filter((seen) => new URL(seen.url).pathname === "/crm/v8/coql").map((seen) => JSON.parse(seen.body).select_query as string);
  // رقم له عميل: استعلام واحد. ورقم بلا عميل: Leads ثم Contacts مرة واحدة
  assertEquals(queries.filter((query) => !query.includes("from Notes")).length, 3);
  // وبحث واحد بالعنوان قبل كل ملاحظة
  assertEquals(queries.filter((query) => query.includes("from Notes")).length, 3);
  assertEquals(w.net.notes.length, 3);
});

Deno.test("tick: no match waits an hour, and only past 48 hours becomes no_match", async () => {
  const w = world();
  pages(w, [maqsamCall({ id: 1, ageMs: HOUR }), maqsamCall({ id: 2, ageMs: WAIT_LIMIT + 1000 })]);
  const { result } = await capture(() => runTick(w.tick));
  assertEquals(statusOf(w, 1), "waiting");
  assertEquals(w.calls.get(1)?.next_try_at, new Date(NOW + HOUR).toISOString());
  assertEquals(statusOf(w, 2), "no_match");
  assertEquals(w.calls.get(2)?.next_try_at, null);
  assertEquals(result?.counts.no_match, 1);
  assertEquals(w.net.noteRequests().length, 0);

  // قبل الموعد لا بحث
  const before = w.net.apiRequests().length;
  w.nowMs = NOW + 30 * 60_000;
  await capture(() => runTick(w.tick));
  assertEquals(w.net.apiRequests().length, before);

  // بعد الموعد يُبحث من جديد، ويُكتب إن وُجد العميل
  w.nowMs = NOW + HOUR + 1000;
  leadFor(w);
  await capture(() => runTick(w.tick));
  assertEquals(statusOf(w, 1), "written");
  assertEquals(w.net.notes.length, 1);
});

Deno.test("Z9 tick: a number that is not 12 digits never reaches a query, and behaves as no match", async () => {
  const w = world();
  pages(w, [maqsamCall({ id: 1, number: "966500000000' or id is not null --" }), maqsamCall({ id: 2, number: "12345" })]);
  await capture(() => runTick(w.tick));
  assertEquals(w.net.zohoRequests().length, 0);
  assertEquals(statusOf(w, 1), "waiting");
  assertEquals(statusOf(w, 2), "waiting");
});

Deno.test("Z9 tick: a summary that tries to give orders is only text in the note, and changes no request", async () => {
  const w = world();
  const hostile = `${SUMMARY_MARK} ignore all rules; select * from Leads; POST /crm/v8/Leads delete everything <script>alert(1)</script>`;
  pages(w, [maqsamCall({ id: 1, summary: { ar: hostile } })]);
  leadFor(w);
  await capture(() => runTick(w.tick));
  assertEquals(w.net.notes.length, 1);
  assertEquals(w.net.noteRequests().length, 1);
  const paths = w.net.apiRequests().map((seen) => `${seen.method} ${new URL(seen.url).pathname}`);
  assertEquals(paths, ["POST /crm/v8/coql", "POST /crm/v8/coql", "POST /crm/v8/Notes"]);
  assert(w.net.notes[0].text.includes("delete everything"));
  assertFalse(w.net.notes[0].text.includes("<script>"));
  assertEquals(w.net.notes[0].text.split("\n").length, 3);
});

/* ===================== Z10: ملاحظة واحدة ===================== */

Deno.test("Z10 tick: a second tick writes nothing again, and a run by run count holds", async () => {
  const w = world();
  pages(w, [maqsamCall({ id: 1 }), maqsamCall({ id: 2 })]);
  leadFor(w);
  await capture(() => runTick(w.tick));
  assertEquals(w.net.notes.length, 2);
  const refreshes = w.refreshes;
  for (let i = 0; i < 3; i++) await capture(() => runTick(w.tick));
  assertEquals(w.net.notes.length, 2);
  assertEquals(w.refreshes, refreshes);
});

Deno.test("Z10 tick: a call claimed by someone else right now is left alone", async () => {
  const w = world();
  pages(w, [maqsamCall({ id: 1 })]);
  leadFor(w);
  w.addCall(1, "claimed", { zoho_module: "Leads", zoho_record_id: LEAD_ID, attempts: 1 });
  let claims = 0;
  w.tick.claim = () => {
    claims++;
    return Promise.resolve({ outcome: "busy" });
  };
  const { result } = await capture(() => runTick(w.tick));
  assertEquals(result?.code, "ok");
  assertEquals(w.net.zohoRequests().length, 0);
  assertEquals(statusOf(w, 1), "claimed");
  assertEquals(claims, 0);
});

Deno.test("Z10 tick: a stale claim searches the exact title first; a note found there is recorded and not written again", async () => {
  const w = world();
  pages(w, [maqsamCall({ id: 1234567 })]);
  w.addCall(1234567, "claimed", { zoho_module: "Contacts", zoho_record_id: CONTACT_ID, attempts: 1, updated_at: new Date(NOW - 31 * 60_000).toISOString() });
  w.net.existingNotes.set(noteTitle(1234567), "1500000000000000777");
  const { result } = await capture(() => runTick(w.tick));
  assertEquals(result?.counts.written, 0);
  assertEquals(result?.counts.already_written, 1);
  assertEquals(w.net.noteRequests().length, 0);
  const row = w.calls.get(1234567)!;
  assertEquals([row.status, row.zoho_note_id, row.zoho_module, row.zoho_record_id], ["written", "1500000000000000777", "Contacts", CONTACT_ID]);
  const queries = w.net.apiRequests().map((seen) => JSON.parse(seen.body).select_query as string);
  assertEquals(queries, ["select id from Notes where Note_Title = 'مكالمة مقسم #1234567' limit 5"]);
});

Deno.test("Z10 tick: a stale claim with no note found retries once, on the record it held, with no lookup", async () => {
  const w = world();
  pages(w, [maqsamCall({ id: 1234567 })]);
  // العميل تغيّر بعد الحجز: الكتابة تبقى على السجل المحجوز
  leadFor(w, CUSTOMER_NUMBER, "1500000000000000999");
  w.addCall(1234567, "claimed", { zoho_module: "Contacts", zoho_record_id: CONTACT_ID, attempts: 1, updated_at: new Date(NOW - 31 * 60_000).toISOString() });
  await capture(() => runTick(w.tick));
  assertEquals(w.net.notes.length, 1);
  assertEquals(w.net.notes[0].parent, { id: CONTACT_ID, module: { api_name: "Contacts" } });
  assertEquals(w.calls.get(1234567)?.attempts, 2);
  assertEquals(statusOf(w, 1234567), "written");
});

Deno.test("Z10 tick: a stale claim whose search fails stays claimed, and the tick stops", async () => {
  const w = world();
  pages(w, [maqsamCall({ id: 1 })]);
  w.addCall(1, "claimed", { zoho_module: "Leads", zoho_record_id: LEAD_ID, attempts: 1, updated_at: new Date(NOW - 31 * 60_000).toISOString() });
  w.net.coql = () => jsonReply({}, 500);
  const { result } = await capture(() => runTick(w.tick));
  assertEquals(result?.code, "server_error");
  assertEquals(statusOf(w, 1), "claimed");
  assertEquals(w.net.noteRequests().length, 0);
});

Deno.test("Z10 tick: a lost reply to the POST keeps the claim and stops; after 30 minutes the search finds the note, so it is one note", async () => {
  const w = world();
  pages(w, [maqsamCall({ id: 1234567 }), maqsamCall({ id: 2, number: OTHER_NUMBER })]);
  leadFor(w);
  leadFor(w, OTHER_NUMBER, "1500000000000000444");
  // Zoho كتبها فعلاً، والرد لم يصل
  w.net.note = (seen) => {
    const real = w.net.defaultNote(seen);
    w.net.note = (next) => w.net.defaultNote(next);
    return real.body?.cancel().then(() => Promise.reject(new TypeError(`lost ${SENTINEL}`))) as Promise<Response>;
  };
  const { result, lines } = await capture(() => runTick(w.tick));
  assertEquals(result?.code, "network");
  assertEquals(result?.cursor, null);
  const claimedFirst = [...w.calls.values()].find((row) => row.status === "claimed");
  assert(claimedFirst);
  assertEquals(w.net.notes.length, 1);
  assertNoCustomer(lines, "log");

  // دورة بعد 5 دقائق: الحجز ما زال حياً، فلا كتابة له
  w.nowMs = NOW + 5 * 60_000;
  w.net.maqsamPages = [[maqsamCall({ id: claimedFirst.call_id, number: CUSTOMER_NUMBER, ageMs: HOUR })]];
  await capture(() => runTick(w.tick));
  assertEquals(w.net.notes.length, 1);
  assertEquals(w.calls.get(claimedFirst.call_id)?.status, "claimed");

  // بعد 31 دقيقة: البحث بالعنوان يجدها
  w.nowMs = NOW + 31 * 60_000;
  await capture(() => runTick(w.tick));
  assertEquals(w.net.notes.length, 1);
  assertEquals(w.calls.get(claimedFirst.call_id)?.status, "written");
  assertEquals(w.calls.get(claimedFirst.call_id)?.zoho_note_id, w.net.notes[0].id);
});

Deno.test("Z10 tick: Zoho refusing one note releases it and goes on to the next; three refusals are final", async () => {
  const w = world();
  pages(w, [maqsamCall({ id: 1, ageMs: 2 * HOUR }), maqsamCall({ id: 2, ageMs: HOUR })]);
  leadFor(w);
  let count = 0;
  w.net.note = (seen) => ++count === 1 ? jsonReply({ data: [{ code: "INVALID_DATA", status: "error" }] }, 400) : w.net.defaultNote(seen);
  const { result } = await capture(() => runTick(w.tick));
  assertEquals(result?.code, "ok");
  assertEquals(result?.counts.refused, 1);
  assertEquals(statusOf(w, 1), "waiting");
  assertEquals(statusOf(w, 2), "written");

  w.net.note = () => jsonReply({ data: [{ code: "INVALID_DATA", status: "error" }] }, 400);
  for (let i = 1; i <= 2; i++) {
    w.nowMs = NOW + i * HOUR + 1000;
    await capture(() => runTick(w.tick));
  }
  assertEquals(statusOf(w, 1), "failed");
  assertEquals(w.calls.get(1)?.attempts, 3);
  const posted = w.net.noteRequests().length;
  w.nowMs = NOW + 10 * HOUR;
  await capture(() => runTick(w.tick));
  assertEquals(w.net.noteRequests().length, posted);
});

Deno.test("Z8 tick: stopped while running: the next claim is refused, so no further note is written", async () => {
  const w = world();
  pages(w, [maqsamCall({ id: 1, ageMs: 3 * HOUR }), maqsamCall({ id: 2, ageMs: 2 * HOUR }), maqsamCall({ id: 3, ageMs: HOUR })]);
  leadFor(w);
  w.net.note = (seen) => {
    const reply = w.net.defaultNote(seen);
    w.state.enabled = false;
    return reply;
  };
  const { result } = await capture(() => runTick(w.tick));
  assertEquals(result?.code, "ok");
  assertEquals(result?.cursor, null);
  assertEquals(w.net.notes.length, 1);
  assertEquals(statusOf(w, 1), "written");
  assertEquals(w.calls.has(2), false);
  assertEquals(w.calls.has(3), false);
  assertEquals(w.state.scan_cursor, null);
});

/* ===================== المكالمات التي خرجت من النافذة ===================== */

Deno.test("tick: a call still waiting when the cursor passed it is read by its id, and ends properly", async () => {
  const w = world({ scanCursor: new Date(NOW - WAIT_LIMIT).toISOString() });
  pages(w, []);
  w.addCall(1, "waiting", { next_try_at: new Date(NOW - 1000).toISOString() });
  w.addCall(2, "waiting", { next_try_at: null });
  w.addCall(3, "waiting", { next_try_at: new Date(NOW + HOUR).toISOString() });
  w.addCall(4, "waiting", { next_try_at: null });
  w.net.maqsamOne.set(1, maqsamCall({ id: 1, ageMs: WAIT_LIMIT + HOUR }));
  w.net.maqsamOne.set(2, maqsamCall({ id: 2, summary: null, ageMs: WAIT_LIMIT + HOUR }));
  const { result } = await capture(() => runTick(w.tick));
  assertEquals(statusOf(w, 1), "no_match");
  assertEquals(statusOf(w, 2), "no_summary");
  assertEquals(statusOf(w, 3), "waiting");
  assertEquals(statusOf(w, 4), "no_summary");
  assertEquals(result?.code, "ok");
  assertEquals(w.net.maqsamRequests().filter((seen) => /\/v2\/calls\/\d+$/.test(new URL(seen.url).pathname)).length, 3);
});

Deno.test("tick: an open call that cannot be read stays open, and the new calls behind it still get their notes", async () => {
  const w = world({ scanCursor: new Date(NOW - WAIT_LIMIT).toISOString() });
  pages(w, [maqsamCall({ id: 2 })]);
  leadFor(w);
  w.addCall(1, "waiting", { next_try_at: new Date(NOW - 1000).toISOString() });
  w.net.maqsam = (seen) => /\/v2\/calls\/1$/.test(new URL(seen.url).pathname) ? jsonReply({ result: "failure" }, 200) : w.net.defaultMaqsam(seen);
  const { result } = await capture(() => runTick(w.tick));
  assertEquals(statusOf(w, 1), "waiting");
  assertEquals(statusOf(w, 2), "written");
  assertEquals(w.net.notes.length, 1);
  assertEquals(result?.code, "ok");
});

Deno.test("tick: a number on more than one record marks the note, so the page can count it", async () => {
  const w = world();
  pages(w, [maqsamCall({ id: 3 })]);
  w.net.coql = (seen) => {
    const query = JSON.parse(seen.body).select_query as string;
    if (query.includes("from Notes")) return new Response(null, { status: 204 });
    if (query.includes("from Leads")) {
      return jsonReply({ data: [{ id: "2424000000000011", Modified_Time: "2026-11-02T10:00:00+03:00" }, { id: "2424000000000012", Modified_Time: "2026-11-01T10:00:00+03:00" }] });
    }
    return new Response(null, { status: 204 });
  };
  await capture(() => runTick(w.tick));
  assertEquals(statusOf(w, 3), "written");
  assertEquals(w.net.notes.length, 1);
  assertEquals(w.calls.get(3)?.ambiguous, true);
});

Deno.test("Z10 tick: a stale claim out of the window is read by its id and goes through the title search", async () => {
  const w = world({ scanCursor: new Date(NOW - WAIT_LIMIT).toISOString() });
  pages(w, []);
  w.addCall(1234567, "claimed", { zoho_module: "Leads", zoho_record_id: LEAD_ID, attempts: 1, updated_at: new Date(NOW - 3 * DAY).toISOString() });
  w.net.maqsamOne.set(1234567, maqsamCall({ id: 1234567, ageMs: 3 * DAY }));
  w.net.existingNotes.set(noteTitle(1234567), "1500000000000000777");
  await capture(() => runTick(w.tick));
  assertEquals(statusOf(w, 1234567), "written");
  assertEquals(w.net.noteRequests().length, 0);
  assertEquals(w.calls.get(1234567)?.zoho_note_id, "1500000000000000777");
});

Deno.test("tick: an open call Maqsam no longer has ends instead of hanging forever; a claim is released first", async () => {
  const w = world();
  pages(w, []);
  w.addCall(1, "waiting");
  w.addCall(2, "claimed", { zoho_module: "Leads", zoho_record_id: LEAD_ID, attempts: 1, updated_at: new Date(NOW - 3 * DAY).toISOString() });
  await capture(() => runTick(w.tick));
  assertEquals(statusOf(w, 1), "no_summary");
  assertEquals(statusOf(w, 2), "waiting");
  assertEquals(w.net.noteRequests().length, 0);
});

Deno.test("tick: an open call whose read fails stops the tick with Maqsam's code", async () => {
  const w = world();
  pages(w, []);
  w.addCall(1, "waiting");
  const real = w.net.maqsam;
  w.net.maqsam = (seen) => /\/v2\/calls\/\d+$/.test(new URL(seen.url).pathname) ? new Response("", { status: 500 }) : real(seen);
  const { result } = await capture(() => runTick(w.tick));
  assertEquals(result?.code, "maqsam_server_error");
  assertEquals(statusOf(w, 1), "waiting");
});

/* ===================== الميزانية ===================== */

Deno.test("tick: at most 25 writes, the oldest first; the cursor stays; the next tick continues", async () => {
  const w = world({ scanCursor: new Date(NOW - 3 * DAY).toISOString() });
  pages(w, Array.from({ length: 30 }, (_, i) => maqsamCall({ id: 100 + i, ageMs: (40 - i) * 60_000 })));
  leadFor(w);
  const first = await capture(() => runTick(w.tick));
  assertEquals(first.result?.code, "capped");
  assertEquals(first.result?.cursor, null);
  assertEquals(first.result?.counts.written, 25);
  assertEquals(w.net.notes.length, 25);
  assertEquals(w.net.notes[0].title, "مكالمة مقسم #100");
  assertEquals(w.net.notes[24].title, "مكالمة مقسم #124");
  assertEquals(w.state.scan_cursor, new Date(NOW - 3 * DAY).toISOString());
  assertEquals(w.state.last_run_code, "capped");

  const second = await capture(() => runTick(w.tick));
  assertEquals(second.result?.code, "ok");
  assertEquals(w.net.notes.length, 30);
  assertEquals(w.state.scan_cursor, new Date(NOW - WAIT_LIMIT).toISOString());
  assertEquals(new Set(w.net.notes.map((note) => note.title)).size, 30);
});

Deno.test("tick: out of time, it stops before the next note and continues next tick", async () => {
  const w = world();
  pages(w, [maqsamCall({ id: 1, ageMs: 3 * HOUR }), maqsamCall({ id: 2, ageMs: 2 * HOUR }), maqsamCall({ id: 3, ageMs: HOUR })]);
  leadFor(w);
  w.net.note = (seen) => {
    w.nowMs += 90_000;
    return w.net.defaultNote(seen);
  };
  const { result } = await capture(() => runTick(w.tick));
  assertEquals(result?.code, "capped");
  assertEquals(result?.cursor, null);
  assertEquals(w.net.notes.length, 1);
  assertEquals(w.calls.has(2), false);
});

Deno.test("tick: the budget also bounds a page read that came too late", async () => {
  const w = world();
  w.tick.budgetMs = 0;
  const { result } = await capture(() => runTick(w.tick));
  assertEquals(result?.code, "maqsam_timeout");
  assertEquals(w.net.seen.length, 0);
});

/* ===================== أخطاء Zoho ===================== */

Deno.test("tick: refreshes once on INVALID_TOKEN, INVALID_OAUTHTOKEN or AUTHENTICATION_FAILURE, and goes on", async () => {
  for (const code of ["INVALID_TOKEN", "INVALID_OAUTHTOKEN", "AUTHENTICATION_FAILURE"]) {
    const w = world();
    pages(w, [maqsamCall({ id: 1 })]);
    leadFor(w);
    let first = true;
    const realCoql = w.net.coql;
    w.net.coql = (seen) => {
      if (first) {
        first = false;
        return jsonReply({ code, details: {}, message: "x", status: "error" }, 401);
      }
      return realCoql(seen);
    };
    let tokens = 0;
    w.net.token = () => jsonReply({ access_token: tokens++ === 0 ? NEW_ACCESS : RENEWED_ACCESS, expires_in: 3600 });
    const { result } = await capture(() => runTick(w.tick));
    assertEquals(result?.code, "ok", code);
    assertEquals(w.refreshes, 2, code);
    assertEquals(w.net.notes.length, 1, code);
    assertEquals(w.net.noteRequests()[0].headers.Authorization, `Zoho-oauthtoken ${RENEWED_ACCESS}`, code);
  }
});

const STOPPING: [string, string, boolean, (w: TickWorld) => void][] = [
  ["scope on lookup", "scope_mismatch", true, (w) => w.net.coql = () => jsonReply({ code: "OAUTH_SCOPE_MISMATCH" }, 401)],
  ["no permission on lookup", "no_permission", true, (w) => w.net.coql = () => jsonReply({ code: "NO_PERMISSION" }, 403)],
  ["inactive on lookup", "inactive_user", true, (w) => w.net.coql = () => jsonReply({ code: "INACTIVE_USER" }, 403)],
  ["scope on note", "scope_mismatch", true, (w) => w.net.note = () => jsonReply({ code: "OAUTH_SCOPE_MISMATCH" }, 401)],
  ["no permission on note", "no_permission", true, (w) => w.net.note = () => jsonReply({ code: "NO_PERMISSION" }, 403)],
  ["inactive on note", "inactive_user", true, (w) => w.net.note = () => jsonReply({ code: "INACTIVE_USER" }, 403)],
  ["refresh invalid_code", "token_revoked", true, (w) => w.net.token = () => jsonReply({ error: "invalid_code" })],
  ["refresh invalid_client", "invalid_client", true, (w) => w.net.token = () => jsonReply({ error: "invalid_client" })],
  ["token stays refused", "token_revoked", true, (w) => w.net.coql = () => jsonReply({ code: "INVALID_TOKEN" }, 401)],
  ["429 on lookup", "rate_limited", false, (w) => w.net.coql = () => jsonReply({ code: "TOO_MANY_REQUESTS" }, 429)],
  ["429 on note", "rate_limited", false, (w) => w.net.note = () => jsonReply({ code: "RATE_LIMIT_EXCEEDED" }, 429)],
  ["500 on lookup", "server_error", false, (w) => w.net.coql = () => jsonReply({ code: "INTERNAL_ERROR" }, 500)],
  ["502 html on lookup", "server_error", false, (w) => w.net.coql = () => new Response(`<html>${SENTINEL}</html>`, { status: 502 })],
  ["500 on note", "server_error", false, (w) => w.net.note = () => jsonReply({ code: "INTERNAL_ERROR" }, 500)],
  ["refresh html 500", "server_error", false, (w) => w.net.token = () => new Response(`<html>${SENTINEL}</html>`, { status: 500 })],
  ["bad query", "bad_response", false, (w) => w.net.coql = () => jsonReply({ code: "INVALID_QUERY", details: { column_name: SENTINEL } }, 400)],
  ["lookup lost", "network", false, (w) => w.net.coql = () => Promise.reject(new TypeError(SENTINEL))],
  ["lookup hang", "timeout", false, (w) => w.net.coql = () => new Promise<Response>(() => {})],
];

Deno.test("tick: Zoho's errors stop the tick; only what an admin must fix raises needs_reconnect; the cursor stays", async () => {
  for (const [label, code, reconnect, breakIt] of STOPPING) {
    const w = world();
    pages(w, [maqsamCall({ id: 1, ageMs: 2 * HOUR }), maqsamCall({ id: 2, ageMs: HOUR, number: OTHER_NUMBER })]);
    leadFor(w);
    leadFor(w, OTHER_NUMBER, "1500000000000000444");
    breakIt(w);
    const { result, lines } = await capture(() => runTick(w.tick));
    assertEquals(result?.code, code, label);
    assertEquals(result?.cursor, null, label);
    assertEquals(w.state.needs_reconnect, reconnect, label);
    assertEquals(w.state.scan_cursor, null, label);
    assertEquals(w.state.last_run_code, code, label);
    assertEquals(w.state.lease, false, label);
    assertEquals(w.state.enabled, true, label);
    // وقف عند الأولى: لم يحاول الثانية
    assertEquals(w.net.noteRequests().filter((seen) => JSON.parse(seen.body).data[0].Note_Title.includes("#2")).length, 0, label);
    assertNoCustomer(lines, label);
    // والدورة التالية بعد علامة إعادة الربط لا تعمل
    if (reconnect) {
      const seen = w.net.seen.length;
      assertEquals((await capture(() => runTick(w.tick))).result, null, label);
      assertEquals(w.net.seen.length, seen, label);
    }
  }
});

Deno.test("tick: a note refused for a general reason is not counted against it", async () => {
  const w = world();
  pages(w, [maqsamCall({ id: 1 })]);
  leadFor(w);
  w.net.note = () => jsonReply({}, 429);
  await capture(() => runTick(w.tick));
  assertEquals(statusOf(w, 1), "waiting");
  assertEquals(w.calls.get(1)?.attempts, 0);
});

Deno.test("Z7 tick: our refresh ceiling stops the tick before any request to Zoho", async () => {
  const w = world();
  pages(w, [maqsamCall({ id: 1 })]);
  leadFor(w);
  w.refreshGate = { allowed: false, wait_seconds: 300 };
  const { result } = await capture(() => runTick(w.tick));
  assertEquals(result?.code, "throttled");
  assertEquals(w.net.zohoRequests().length, 0);
  assertEquals(w.state.needs_reconnect, false);
});

Deno.test("Z7 tick: Access Denied is recorded so nothing asks again in Zoho's window", async () => {
  const w = world();
  pages(w, [maqsamCall({ id: 1 })]);
  leadFor(w);
  w.net.token = () => jsonReply({ error: "Access Denied", status: "failure" });
  const { result } = await capture(() => runTick(w.tick));
  assertEquals(result?.code, "throttled");
  assertEquals(w.denied, 1);
});

Deno.test("tick: a dying old key cannot raise the mark on a link saved meanwhile", async () => {
  const w = world();
  pages(w, [maqsamCall({ id: 1 })]);
  leadFor(w);
  w.net.coql = () => {
    w.row = { ...w.row!, connected_at: "2026-11-06T11:59:00+00:00" };
    return jsonReply({ code: "OAUTH_SCOPE_MISMATCH" }, 401);
  };
  const { result } = await capture(() => runTick(w.tick));
  assertEquals(result?.code, "scope_mismatch");
  assertEquals(w.state.needs_reconnect, false);
});

Deno.test("tick: a database failure ends the run with a code, and the lease is freed", async () => {
  const breakers: (keyof TickDeps)[] = ["credentials", "maqsamCredentials", "knownCalls", "openCalls", "mark", "claim", "refreshBegin"];
  for (const name of breakers) {
    const w = world();
    pages(w, [maqsamCall({ id: 1 }), maqsamCall({ id: 2, summary: null }), maqsamCall({ id: 3, number: OTHER_NUMBER })]);
    leadFor(w);
    (w.tick as unknown as Record<string, unknown>)[name] = () => Promise.reject(new Error(`db ${SENTINEL} ${OLD_CLIENT.refresh_token}`));
    const { result, lines } = await capture(() => runTick(w.tick));
    assertEquals(result?.code, "server_error", name);
    assertEquals(w.state.lease, false, name);
    assertEquals(w.state.last_run_code, "server_error", name);
    assertEquals(result?.cursor, null, name);
    assertClean(lines, name);
  }
});

Deno.test("Z10 tick: a store failing right after the note leaves the claim, and the title search closes it next time", async () => {
  const w = world();
  pages(w, [maqsamCall({ id: 1 })]);
  leadFor(w);
  const realWritten = w.tick.written;
  w.tick.written = () => Promise.reject(new Error(`db ${SENTINEL}`));
  const { result } = await capture(() => runTick(w.tick));
  assertEquals(result?.code, "server_error");
  assertEquals(w.net.notes.length, 1);
  assertEquals(statusOf(w, 1), "claimed");
  w.tick.written = realWritten;
  w.nowMs = NOW + 31 * 60_000;
  await capture(() => runTick(w.tick));
  assertEquals(w.net.notes.length, 1);
  assertEquals(statusOf(w, 1), "written");
  assertEquals(w.calls.get(1)?.zoho_note_id, w.net.notes[0].id);
});

Deno.test("tick: run_begin or run_end failing never throws out of the background work", async () => {
  const begin = world();
  begin.tick.runBegin = () => Promise.reject(new Error(`db ${SENTINEL}`));
  const first = await capture(() => runTick(begin.tick));
  assertEquals(first.result, null);
  assertClean(first.lines, "log");

  const end = world();
  end.tick.runEnd = () => Promise.reject(new Error(`db ${SENTINEL}`));
  const second = await capture(() => runTick(end.tick));
  assertEquals(second.result?.code, "ok");
  assertClean(second.lines, "log");
});

/* ===================== Z2 وZ5 وZ8: ما يخرج ويُخزَّن ===================== */

Deno.test("Z2 Z5 Z8 a day of ticks: logs and stored values carry no secret, no number and no summary; only Notes is written; the transcript goes nowhere", async () => {
  const w = world();
  const { lines } = await capture(async () => {
    pages(w, [
      maqsamCall({ id: 1, ageMs: 3 * HOUR }),
      maqsamCall({ id: 2, ageMs: 2 * HOUR, number: OTHER_NUMBER }),
      maqsamCall({ id: 3, ageMs: HOUR, summary: null }),
      maqsamCall({ id: 4, ageMs: HOUR, state: "busy" }),
      maqsamCall({ id: 5, ageMs: WAIT_LIMIT + 1000, number: "966500000005" }),
      maqsamCall({ id: 6, ageMs: WAIT_LIMIT + 1000, summary: null }),
    ]);
    leadFor(w);
    await runTick(w.tick);
    w.net.note = () => jsonReply({ data: [{ code: "INVALID_DATA", status: "error", message: SENTINEL, details: { x: SENTINEL } }] }, 400);
    leadFor(w, OTHER_NUMBER, "1500000000000000444");
    w.nowMs = NOW + HOUR + 1000;
    await runTick(w.tick);
    w.net.note = () => Promise.reject(new TypeError(`lost ${SENTINEL}`));
    w.nowMs = NOW + 2 * HOUR + 2000;
    await runTick(w.tick);
  });
  assertNoCustomer(lines, "log");
  assertNoCustomer(JSON.stringify([...w.calls.values()]), "call rows");
  assertNoCustomer(JSON.stringify(w.marks), "marks");
  assertNoCustomer(JSON.stringify(w.runEnds), "run ends");
  assertNoCustomer(JSON.stringify(w.syncRow()), "sync row");
  for (const row of w.calls.values()) {
    for (const value of [row.zoho_record_id, row.zoho_note_id]) assert(value === null || /^\d{13,40}$/.test(value), String(value));
  }
  for (const seen of w.net.seen) {
    const url = new URL(seen.url);
    assertEquals(url.protocol, "https:");
    assertEquals(seen.redirect, "error");
    assertClean(url.pathname + url.search, "url");
    if (url.hostname === "www.zohoapis.sa") assert(["/crm/v8/coql", "/crm/v8/Notes"].includes(url.pathname), url.pathname);
    else if (url.hostname === "accounts.zoho.sa") assertEquals(url.pathname, "/oauth/v2/token");
    else assertEquals(url.hostname, "api.av.maqsam.com");
    if (url.hostname !== "api.av.maqsam.com" && url.hostname !== "accounts.zoho.sa") {
      assertFalse(seen.body.includes("SENTINEL-transcript"), "the transcript left the server");
      assertFalse(seen.body.includes("SENTINEL-caller"), "a customer name left the server");
    }
    // الأسرار في أماكنها
    assertFalse(seen.body.includes(MAQSAM_KEYS.secret), "Maqsam's key left for Zoho");
  }
  assert(w.net.notes.length >= 1);
  assertClean(JSON.stringify(w.net.notes), "the notes");
});

Deno.test("Z5 tick: the log is counts and codes: no id, no name, no time", async () => {
  const w = world();
  pages(w, [maqsamCall({ id: 7654321 })]);
  leadFor(w);
  const { lines } = await capture(() => runTick(w.tick));
  assertFalse(lines.includes("7654321"));
  assertFalse(lines.includes(LEAD_ID));
  assertFalse(lines.includes(w.net.notes[0].id));
  assert(lines.includes('"written":1'));
});

/* ===================== وصل القاعدة الحقيقية ===================== */

Deno.test("wiring: the secret goes to its database function, and an error or a false reply is not a pass", async () => {
  assertEquals(declaredParameters("maqsam_sync_cron_secret_ok"), ["p_secret"]);
  const yes = fakeClient(() => ({ data: true }));
  const deps = supabaseDeps(yes.client as unknown as SupabaseClient, () => {});
  assertEquals(await deps.secretOk("x".repeat(64)), true);
  assertEquals(yes.calls[0].rpc, "maqsam_sync_cron_secret_ok");
  assertEquals(yes.calls[0].args, { p_secret: "x".repeat(64) });

  const no = fakeClient(() => ({ data: false }));
  assertEquals(await supabaseDeps(no.client as unknown as SupabaseClient, () => {}).secretOk("x"), false);
  const odd = fakeClient(() => ({ data: "true" }));
  assertEquals(await supabaseDeps(odd.client as unknown as SupabaseClient, () => {}).secretOk("x"), false);

  const message = `value ${SENTINEL}`;
  const failing = fakeClient(() => ({ error: { code: "23514", message } }));
  const error = await supabaseDeps(failing.client as unknown as SupabaseClient, () => {}).secretOk("x").then(() => null, (e) => e) as Error | null;
  assert(error);
  assertClean(`${error.message} ${error.stack}`, "error");
});

Deno.test("wiring: the background hook is the one given, and the deps read the real store", async () => {
  const works: Promise<unknown>[] = [];
  const fake = fakeClient(() => ({ data: { started: false, reason: "off" } }));
  const deps = supabaseDeps(fake.client as unknown as SupabaseClient, (work) => works.push(work));
  assertEquals(await deps.runBegin(LEASE_SECONDS), { started: false, reason: "off", start_from: null, scan_cursor: null });
  deps.background(Promise.resolve());
  assertEquals(works.length, 1);
  assertEquals(fake.calls[0].args, { p_lease_seconds: LEASE_SECONDS });
});

Deno.test("the job's header in 042 is the one this function reads", () => {
  const sql = Deno.readTextFileSync(new URL("../../migrations/042_zoho_link.sql", import.meta.url));
  assert(sql.includes("'x-maqsam-sync-cron', v_secret"));
  assert(sql.includes("functions/v1/maqsam-sync"));
  const source = Deno.readTextFileSync(new URL("./tick.ts", import.meta.url));
  assert(source.includes('"x-maqsam-sync-cron"'));
});
