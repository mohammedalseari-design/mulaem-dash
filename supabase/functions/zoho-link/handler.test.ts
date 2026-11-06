// اختبارات معالج zoho-link بلا شبكة ولا قاعدة: المعتمِدات مزيّفة في الذاكرة، وZoho ومقسم مزيّفان بردود مكتوبة.
// كل الأسماء والأرقام مصطنعة (المستودع عام). التشغيل: deno test --allow-read --allow-env supabase/functions/zoho-link/
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { CheckCode } from "./core.ts";
import { type Deps, handle, supabaseDeps } from "./handler.ts";
import { noteTitle } from "./notes.ts";
import {
  ARABIC,
  assertClean,
  assertNoCustomer,
  capture,
  CLIENT_ID,
  CLIENT_SECRET,
  CODE,
  CONTACT_ID,
  CUSTOMER_NUMBER,
  declaredParameters,
  fakeClient,
  HOUR,
  jsonReply,
  LEAD_ID,
  maqsamCall,
  migrationSql,
  NEW_ACCESS,
  NEW_REFRESH,
  NOW,
  NOW_ISO,
  OLD_CLIENT,
  ORG_OK,
  OTHER_NUMBER,
  PROFILES,
  SENTINEL,
  SITE,
  STATS_DEFAULT,
  SUMMARY_MARK,
  tokenOk,
  World,
  type WorldStart,
} from "./testkit.ts";

const SAVE = { action: "save", client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code: CODE };
const ACTIONS: Record<string, unknown>[] = [
  { action: "status" },
  SAVE,
  { action: "test" },
  { action: "disconnect" },
  { action: "preview" },
  { action: "write_one", call_id: 1234567 },
  { action: "sync_start", from: "now" },
  { action: "sync_stop" },
];

const EMPTY_LINK = { connected: false, org_name: null, user_name: null, user_profile: null, client_hint: null, connected_at: null, connected_by_name: null, check: null };
const EMPTY_SYNC = {
  enabled: false,
  started_at: null,
  start_from: null,
  started_by_name: null,
  last_run_at: null,
  last_run_code: null,
  written_total: 0,
  written_7d: 0,
  no_match_total: 0,
  waiting: 0,
  failed_total: 0,
  ambiguous_total: 0,
  needs_reconnect: false,
};
const OK_CHECK = { ok: true, code: "ok", at: NOW_ISO, stats: STATS_DEFAULT };

function post(body: unknown, options: { token?: string | null; headers?: Record<string, string> } = {}): Request {
  const token = options.token === undefined ? "admin-token" : options.token;
  return new Request("https://functions.test/zoho-link", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
      ...options.headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// deno-lint-ignore no-explicit-any
type Json = any;

async function call(w: World, body: unknown, options?: { token?: string | null; headers?: Record<string, string> }) {
  const res = await handle(post(body, options), w.deps);
  const text = await res.text();
  return { res, text, json: JSON.parse(text) as Json };
}

function assertError(reply: { res: Response; json: Json }, status: number, code: string) {
  assertEquals(reply.res.status, status, JSON.stringify(reply.json));
  assertEquals(reply.json.status, "error");
  assertEquals(reply.json.code, code);
  assert(ARABIC.test(reply.json.message), `message is not Arabic: ${reply.json.message}`);
  assertEquals(Object.keys(reply.json).sort(), ["code", "message", "status"]);
}

function assertNoEffects(w: World, label: string) {
  assertEquals(w.net.seen.length, 0, `${label}: called out`);
  assertEquals(w.connects.length, 0, `${label}: stored`);
  assertEquals(w.records.length, 0, `${label}: recorded`);
  assertEquals(w.audits.length, 0, `${label}: audited`);
  assertEquals(w.disconnects, 0, `${label}: disconnected`);
  assertEquals(w.credentialReads, 0, `${label}: read the credentials`);
  assertEquals(w.maqsamReads, 0, `${label}: read the Maqsam credentials`);
  assertEquals(w.attempts, 0, `${label}: used an attempt`);
}

/* ===================== Z1: المدير غير الموقوف وحده ===================== */

Deno.test("Z1 no token or a bad one is 401 for every action, and nothing happens", async () => {
  for (const action of ACTIONS) {
    for (const token of [null, "", "wrong-token"]) {
      const w = new World({ connected: true });
      assertError(await call(w, action, { token }), 401, "unauthenticated");
      assertNoEffects(w, `${action.action} ${token}`);
    }
    for (const header of ["Basic abc", "Bearer", "Bearer a b", "admin-token"]) {
      const w = new World({ connected: true });
      assertError(await call(w, action, { token: null, headers: { Authorization: header } }), 401, "unauthenticated");
      assertNoEffects(w, `${action.action} ${header}`);
    }
  }
});

Deno.test("Z1 with no bearer token the auth service is not even asked", async () => {
  for (const header of [null, "", "Basic abc", "Bearer", "Bearer a b"]) {
    const w = new World({ connected: true });
    let asked = 0;
    w.deps.getUser = () => {
      asked++;
      return Promise.resolve({ id: "u-admin" });
    };
    const headers: Record<string, string> = header === null ? {} : { Authorization: header };
    assertError(await call(w, { action: "status" }, { token: null, headers }), 401, "unauthenticated");
    assertEquals(asked, 0, String(header));
  }
});

Deno.test("Z1 anyone who is not an active admin is 403 for every action, and nothing happens", async () => {
  for (const action of ACTIONS) {
    for (const token of ["staff-token", "field-token", "blocked-token", "ghost-token"]) {
      const w = new World({ connected: true });
      assertError(await call(w, action, { token }), 403, "forbidden");
      assertNoEffects(w, `${action.action} ${token}`);
      assertEquals(w.vault, { ...OLD_CLIENT });
    }
  }
});

Deno.test("Z1 the caller is checked before the body is read", async () => {
  const w = new World();
  let read = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      read = true;
      controller.close();
    },
  }, { highWaterMark: 0 });
  const req = new Request("https://functions.test/zoho-link", { method: "POST", body, headers: { Authorization: "Bearer staff-token" } });
  const res = await handle(req, w.deps);
  assertEquals(res.status, 403);
  assertFalse(read);
  await res.body?.cancel();
});

Deno.test("Z1 an auth lookup that throws fails closed with a plain 500", async () => {
  for (const broken of ["getUser", "getProfile"] as const) {
    const w = new World({ connected: true });
    w.deps[broken] = () => Promise.reject(new Error(`boom ${SENTINEL}`));
    const { result, lines } = await capture(() => call(w, { action: "disconnect" }));
    assertError(result, 500, "server_error");
    assertNoEffects(w, broken);
    assertClean(result.text, broken);
    assertClean(lines, broken);
  }
});

/* ===================== Z11: الجسم وCORS ===================== */

Deno.test("Z11 CORS: the allowed origin is fixed, on OPTIONS and every reply, whatever the Origin; replies are no-store", async () => {
  const preflight = await handle(new Request("https://functions.test/zoho-link", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }), new World().deps);
  await preflight.text();
  assertEquals(preflight.status, 200);
  assertEquals(preflight.headers.get("Access-Control-Allow-Origin"), SITE);
  assert(preflight.headers.get("Access-Control-Allow-Methods")?.includes("POST"));

  const origin = { Origin: "https://evil.example" };
  const replies = [
    await call(new World(), { action: "status" }, { headers: origin }),
    await call(new World(), { action: "status" }, { token: null, headers: origin }),
    await call(new World(), { action: "status" }, { token: "staff-token", headers: origin }),
    await call(new World(), "{bad", { headers: origin }),
    await call(new World(), { action: "test" }, { headers: origin }),
    await call(new World({ connected: true }), { action: "preview" }, { headers: origin }),
  ];
  for (const { res } of replies) {
    assertEquals(res.headers.get("Access-Control-Allow-Origin"), SITE);
    assertEquals(res.headers.get("Cache-Control"), "no-store");
  }
});

Deno.test("Z11 anything but POST is 405 bad_request", async () => {
  for (const method of ["GET", "PUT", "DELETE", "PATCH"]) {
    const w = new World();
    const res = await handle(new Request("https://functions.test/zoho-link", { method, headers: { Authorization: "Bearer admin-token" } }), w.deps);
    assertError({ res, json: await res.json() }, 405, "bad_request");
    assertNoEffects(w, method);
  }
});

Deno.test("Z11 a body above 8 KB is 413, by its header or by what actually arrives", async () => {
  const padded = (size: number) => {
    const base = JSON.stringify({ action: "status", pad: "" });
    return base.slice(0, -2) + "x".repeat(size - base.length) + '"}';
  };
  const declared = new World({ connected: true });
  assertError(await call(declared, { action: "disconnect" }, { headers: { "Content-Length": "8193" } }), 413, "bad_request");
  assertNoEffects(declared, "declared");

  const actual = new World({ connected: true });
  const big = padded(8193);
  assertEquals(new TextEncoder().encode(big).byteLength, 8193);
  assertError(await call(actual, big), 413, "bad_request");

  const arabic = new World({ connected: true });
  assertError(await call(arabic, { action: "disconnect", pad: "س".repeat(4100) }), 413, "bad_request");
  assertEquals(arabic.disconnects, 0);

  const exact = new World({ connected: true });
  const fits = padded(8192);
  assertEquals(new TextEncoder().encode(fits).byteLength, 8192);
  assertEquals((await call(exact, fits)).res.status, 200);
});

Deno.test("a body that is not a JSON object, or an unknown action, is 400 bad_request", async () => {
  const bodies = ["", "not json", "{bad", "null", "5", '"status"', "[]", "{}", '{"action":null}', '{"action":5}', '{"action":"other"}', '{"action":"STATUS"}', '{"action":["status"]}'];
  for (const body of bodies) {
    const w = new World({ connected: true });
    const res = await handle(new Request("https://functions.test/zoho-link", { method: "POST", headers: { Authorization: "Bearer admin-token" }, body }), w.deps);
    assertError({ res, json: await res.json() }, 400, "bad_request");
    assertNoEffects(w, body);
  }
});

/* ===================== status ===================== */

Deno.test("status: not connected is the contract's empty link and sync", async () => {
  const w = new World();
  const reply = await call(w, { action: "status" });
  assertEquals(reply.res.status, 200);
  assertEquals(reply.json, { status: "ok", link: EMPTY_LINK, sync: EMPTY_SYNC });
  assertNoEffects(w, "status");
});

Deno.test("status: connected shows the row with the name, without calling Zoho or reading the secrets", async () => {
  const w = new World({ connected: true, enabled: true });
  w.addCall(1, "written", { zoho_note_id: "1500000000000000999" });
  w.addCall(2, "no_match");
  w.addCall(3, "waiting");
  w.addCall(4, "failed");
  const reply = await call(w, { action: "status" });
  assertEquals(Object.keys(reply.json).sort(), ["link", "status", "sync"]);
  assertEquals(reply.json.link, {
    connected: true,
    org_name: "Mulaem",
    user_name: "مدير زوهو",
    user_profile: "Administrator",
    client_hint: "1234",
    connected_at: "2026-10-01T09:00:00.000Z",
    connected_by_name: "مدير تجريبي",
    check: { ok: true, code: "ok", at: "2026-10-01T09:00:00.000Z", stats: { ...STATS_DEFAULT, calls: 3 } },
  });
  assertEquals(reply.json.sync, {
    enabled: true,
    started_at: "2026-11-01T00:00:00.000Z",
    start_from: new Date(NOW - 7 * 24 * HOUR).toISOString(),
    started_by_name: "مدير تجريبي",
    last_run_at: null,
    last_run_code: null,
    written_total: 1,
    written_7d: 1,
    no_match_total: 1,
    waiting: 1,
    failed_total: 1,
    ambiguous_total: 0,
    needs_reconnect: false,
  });
  assertNoEffects(w, "status");
});

Deno.test("Z5 status: a stored check with extra fields returns only the Stats fields", async () => {
  const w = new World({ connected: true, row: { last_check_stats: { ...STATS_DEFAULT, summary: "SENTINEL-summary", caller: "SENTINEL-caller", by_owner: [{ name: "a", calls: 1, number: "SENTINEL-number" }] } } });
  const reply = await call(w, { action: "status" });
  assertClean(reply.text, "status");
  assertEquals(Object.keys(reply.json.link.check.stats).sort(), Object.keys(STATS_DEFAULT).sort());
  assertEquals(reply.json.link.check.stats.by_owner, [{ name: "a", calls: 1 }]);
});

/* ===================== save: النجاح ===================== */

Deno.test("save: success exchanges once, verifies, stores the cleaned values once, and reports the contract's shape", async () => {
  const w = new World();
  const reply = await call(w, { action: "save", client_id: `  ${CLIENT_ID}\r\n`, client_secret: `\t${CLIENT_SECRET}  `, code: ` ${CODE}\n` });
  assertEquals(reply.res.status, 200);
  assertEquals(Object.keys(reply.json).sort(), ["check", "link", "saved", "status", "sync"]);
  assertEquals(reply.json.saved, true);
  assertEquals(reply.json.check, OK_CHECK);
  assertEquals(reply.json.link, {
    connected: true,
    org_name: "Mulaem",
    user_name: "مدير زوهو",
    user_profile: "Administrator",
    client_hint: "7f3a",
    connected_at: NOW_ISO,
    connected_by_name: "مدير تجريبي",
    check: OK_CHECK,
  });
  assertEquals(reply.json.sync, EMPTY_SYNC);
  assertEquals(w.net.tokenRequests().length, 1);
  assertEquals(new URLSearchParams(w.net.tokenRequests()[0].body).get("code"), CODE);
  assertEquals(w.connects, [{
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: NEW_REFRESH,
    client_hint: "7f3a",
    org_name: "Mulaem",
    user_name: "مدير زوهو",
    user_profile: "Administrator",
    by: "u-admin",
    stats: STATS_DEFAULT,
  }]);
  assertEquals(w.records, []);
  assertEquals(w.net.revokeRequests().length, 0);
  assertEquals(w.minted, 1);
  assertEquals(w.attemptEnds, 1);
  assertEquals(w.net.noteRequests().length, 0);
});

Deno.test("Z3 save: the new access token is used against the hardcoded host, and no second token is asked for", async () => {
  const w = new World();
  w.net.token = () => tokenOk({ api_domain: "https://api.zoho.sa" });
  assertEquals((await call(w, SAVE)).json.saved, true);
  const api = w.net.apiRequests();
  assert(api.length > 0);
  for (const seen of api) assertEquals(seen.headers.Authorization, `Zoho-oauthtoken ${NEW_ACCESS}`);
  assertEquals(w.net.tokenRequests().length, 1);
  assertEquals(w.refreshes, 0);
});

Deno.test("Z3 save: a host in api_domain never receives anything, even when it is a .sa host we accept", async () => {
  const w = new World();
  w.net.token = () => tokenOk({ api_domain: "https://other-host.zoho.sa" });
  await call(w, SAVE);
  const hosts = new Set(w.net.seen.map((seen) => new URL(seen.url).hostname));
  assertEquals([...hosts].sort(), ["accounts.zoho.sa", "www.zohoapis.sa"]);
});

Deno.test("Z2 save: a client id shorter than 8 characters gets no hint", async () => {
  const w = new World();
  const reply = await call(w, { ...SAVE, client_id: "1000.AB" });
  assertEquals(reply.json.saved, true);
  assertEquals(w.connects[0].client_hint, null);
  assertEquals(reply.json.link.client_hint, null);
  assertFalse(reply.text.includes("1000.AB"));
});

Deno.test("Z2 Z7 save: bad values are refused with their own code before anything goes out or counts", async () => {
  const table: [Record<string, unknown>, string][] = [
    [{ client_id: "" }, "invalid_client_id"],
    [{ client_id: "   " }, "invalid_client_id"],
    [{ client_id: "a b" }, "invalid_client_id"],
    [{ client_id: "a:b" }, "invalid_client_id"],
    [{ client_id: "مفتاح" }, "invalid_client_id"],
    [{ client_id: "x".repeat(257) }, "invalid_client_id"],
    [{ client_id: null }, "invalid_client_id"],
    [{ client_id: 5 }, "invalid_client_id"],
    [{ client_id: undefined }, "invalid_client_id"],
    [{ client_secret: "" }, "invalid_client_secret"],
    [{ client_secret: "a b" }, "invalid_client_secret"],
    [{ client_secret: "سر" }, "invalid_client_secret"],
    [{ client_secret: "x".repeat(513) }, "invalid_client_secret"],
    [{ client_secret: null }, "invalid_client_secret"],
    [{ client_secret: {} }, "invalid_client_secret"],
    [{ client_secret: undefined }, "invalid_client_secret"],
    [{ code: "" }, "invalid_code"],
    [{ code: "a b" }, "invalid_code"],
    [{ code: "كود" }, "invalid_code"],
    [{ code: "x".repeat(1025) }, "invalid_code"],
    [{ code: null }, "invalid_code"],
    [{ code: 5 }, "invalid_code"],
    [{ code: undefined }, "invalid_code"],
  ];
  for (const [change, code] of table) {
    const w = new World({ connected: true });
    const before = structuredClone(w.row);
    const reply = await call(w, { ...SAVE, ...change });
    assertError(reply, 400, code);
    assertNoEffects(w, JSON.stringify(change));
    assertEquals(w.row, before);
    for (const value of Object.values(change)) {
      if (typeof value === "string" && value.trim() !== "") assertFalse(reply.text.includes(value), `echoed ${value}`);
    }
  }
});

/* ===================== Z7: الرمز لمرة واحدة ===================== */

const FAILING_EXCHANGE: [string, string, () => Response | Promise<Response>][] = [
  ["invalid_client 200", "invalid_client", () => jsonReply({ error: "invalid_client" })],
  ["invalid_client_secret 200", "invalid_client", () => jsonReply({ error: "invalid_client_secret" })],
  ["invalid_code 200", "invalid_code", () => jsonReply({ error: "invalid_code" })],
  ["Access Denied", "throttled", () => jsonReply({ error_description: `too many ${SENTINEL}`, error: "Access Denied", status: "failure" })],
  ["access_denied", "throttled", () => jsonReply({ error: "access_denied" })],
  ["roadblock", "throttled", () => new Response(`Access Denied: Maximum request limit reached ${SENTINEL}`, { status: 200 })],
  ["html 400", "bad_response", () => new Response(`<html>${SENTINEL}</html>`, { status: 400 })],
  ["html 500", "server_error", () => new Response(`<html>${SENTINEL}</html>`, { status: 500 })],
  ["empty", "bad_response", () => new Response("", { status: 200 })],
  ["dns", "network", () => Promise.reject(new TypeError(`dns ${SENTINEL}`))],
  ["abort", "timeout", () => Promise.reject(new DOMException(SENTINEL, "AbortError"))],
  ["hang", "timeout", () => new Promise<Response>(() => {})],
];

Deno.test("Z7 save: a failed exchange is never retried, stores nothing, revokes nothing, and frees the attempt", async () => {
  for (const [label, code, respond] of FAILING_EXCHANGE) {
    for (const connected of [false, true]) {
      const w = new World({ connected });
      const rowBefore = structuredClone(w.row);
      w.net.token = respond;
      const { result: reply, lines } = await capture(() => call(w, SAVE));
      assertEquals(reply.res.status, 200, label);
      assertEquals(reply.json.saved, false, label);
      assertEquals(reply.json.check, { ok: false, code, at: NOW_ISO, stats: null }, label);
      assertEquals(w.net.tokenRequests().length, 1, `${label}: retried`);
      assertEquals(w.net.seen.length, 1, label);
      assertEquals(w.connects.length, 0, label);
      assertEquals(w.audits.length, 0, label);
      assertEquals(w.attemptEnds, 1, label);
      assertEquals(w.row, rowBefore, label);
      assertEquals(reply.json.link.connected, connected, label);
      assertClean(reply.text, label);
      assertClean(lines, label);
    }
  }
});

Deno.test("Z7 save: Access Denied at the exchange stops asking for Zoho's window, and says how long", async () => {
  const w = new World();
  w.net.token = () => jsonReply({ error: "Access Denied" });
  const reply = await call(w, SAVE);
  assertEquals(reply.json.check.code, "throttled");
  assertEquals(reply.json.wait_seconds, 600);
  assertEquals(w.denied, 1);
});

Deno.test("Z7 save: our own ceiling refuses before the code is spent, and says how long", async () => {
  for (const reason of ["limit", "busy", "blocked"]) {
    const w = new World({ connected: true });
    w.gate = { allowed: false, reason, wait_seconds: 240 };
    const reply = await call(w, SAVE);
    assertEquals(reply.res.status, 200, reason);
    assertEquals(reply.json.saved, false, reason);
    assertEquals(reply.json.check, { ok: false, code: "throttled", at: NOW_ISO, stats: null }, reason);
    assertEquals(reply.json.wait_seconds, 240, reason);
    assertEquals(reply.json.link.connected, true, reason);
    assertEquals(w.net.seen.length, 0, reason);
    assertEquals(w.attemptEnds, 0, `${reason}: released an attempt it did not hold`);
    assertEquals(w.connects.length, 0, reason);
  }
});

// كل طريق يفشل بعد الاستبدال، بالرمز المتوقع
const FAILING_AFTER: [string, string, (w: World) => void][] = [
  ["sandbox api_domain", "wrong_environment", (w) => w.net.token = () => tokenOk({ api_domain: "https://sandbox.zohoapis.sa" })],
  ["developer api_domain", "wrong_environment", (w) => w.net.token = () => tokenOk({ api_domain: "https://developer.zohoapis.sa" })],
  ["other data center", "wrong_environment", (w) => w.net.token = () => tokenOk({ api_domain: "https://www.zohoapis.com" })],
  ["org sandbox", "wrong_environment", (w) => w.net.org = () => jsonReply({ org: [{ ...ORG_OK.org[0], type: "sandbox" }] })],
  ["org other", "wrong_org", (w) => w.net.org = () => jsonReply({ org: [{ ...ORG_OK.org[0], zgid: "1", domain_name: "org1" }] })],
  ["user M1", "not_admin", (w) => w.net.user = () => jsonReply({ users: [{ full_name: "x", profile: { name: "M1" } }] })],
  ["scope on org", "scope_mismatch", (w) => w.net.org = () => jsonReply({ code: "OAUTH_SCOPE_MISMATCH" }, 401)],
  ["no permission on org", "no_permission", (w) => w.net.org = () => jsonReply({ code: "NO_PERMISSION" }, 403)],
  ["authorization on org", "no_permission", (w) => w.net.org = () => jsonReply({ code: "AUTHORIZATION_FAILED" }, 400)],
  ["inactive", "inactive_user", (w) => w.net.org = () => jsonReply({ code: "INACTIVE_USER" }, 403)],
  ["org 500 html", "server_error", (w) => w.net.org = () => new Response(`<html>${SENTINEL}</html>`, { status: 500 })],
  ["org html 200", "bad_response", (w) => w.net.org = () => new Response(`<html>${SENTINEL}</html>`, { status: 200 })],
  ["org lost", "network", (w) => w.net.org = () => Promise.reject(new TypeError(SENTINEL))],
  ["org hang", "timeout", (w) => w.net.org = () => new Promise<Response>(() => {})],
  ["user 429", "rate_limited", (w) => w.net.user = () => jsonReply({}, 429)],
  ["scope on a count", "scope_mismatch", (w) => w.net.coql = () => jsonReply({ code: "OAUTH_SCOPE_MISMATCH" }, 401)],
  ["permission on a count", "no_permission", (w) => w.net.coql = () => jsonReply({ code: "NO_PERMISSION" }, 403)],
];

Deno.test("Z7 save: any check failing after the exchange revokes the new token once, stores nothing, and keeps an earlier link", async () => {
  for (const [label, code, breakIt] of FAILING_AFTER) {
    for (const connected of [false, true]) {
      const w = new World({ connected });
      const rowBefore = structuredClone(w.row);
      const vaultBefore = structuredClone(w.vault);
      breakIt(w);
      const { result: reply, lines } = await capture(() => call(w, SAVE));
      assertEquals(reply.json.saved, false, label);
      assertEquals(reply.json.check, { ok: false, code, at: NOW_ISO, stats: null }, label);
      assertEquals(w.connects.length, 0, label);
      assertEquals(w.row, rowBefore, label);
      assertEquals(w.vault, vaultBefore, label);
      assertEquals(w.net.tokenRequests("authorization_code").length, 1, label);
      const revokes = w.net.revokeRequests();
      assertEquals(revokes.length, 1, `${label}: revoked ${revokes.length} times`);
      assertEquals(new URLSearchParams(revokes[0].body).get("token"), NEW_REFRESH, label);
      assertEquals(new URLSearchParams(revokes[0].body).get("token_type"), "refresh_token", label);
      assertEquals(revokes[0].headers.Authorization, `Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`, label);
      assertEquals(w.audits.length, 0, label);
      assertEquals(w.attemptEnds, 1, label);
      assertEquals(reply.json.link.connected, connected, label);
      assertClean(reply.text, label);
      assertClean(lines, label);
    }
  }
});

Deno.test("Z7 save: a read failing after a refused check still revokes only once, and still asks for a new code", async () => {
  const w = new World({ connected: true });
  w.net.org = () => jsonReply({ org: [{ ...ORG_OK.org[0], zgid: "1", domain_name: "x" }] });
  w.deps.readRow = () => Promise.reject(new Error(`read failed ${SENTINEL}`));
  const { result: reply, lines } = await capture(() => call(w, SAVE));
  assertError(reply, 500, "server_error");
  assert(reply.json.message.includes("رمزاً جديداً"));
  assertEquals(w.net.revokeRequests().length, 1);
  assertClean(lines, "log");
});

Deno.test("Z7 save: no refresh token is a failure of its own, and the access token that came alone is revoked", async () => {
  const w = new World();
  w.net.token = () => jsonReply({ access_token: NEW_ACCESS, api_domain: "https://www.zohoapis.sa", expires_in: 3600 });
  const reply = await call(w, SAVE);
  assertEquals(reply.json.saved, false);
  assertEquals(reply.json.check.code, "no_refresh_token");
  assertEquals(w.connects.length, 0);
  assertEquals(w.net.apiRequests().length, 0);
  const revokes = w.net.revokeRequests();
  assertEquals(revokes.length, 1);
  assertEquals(new URLSearchParams(revokes[0].body).get("token"), NEW_ACCESS);
  assertEquals(new URLSearchParams(revokes[0].body).get("token_type"), "access_token");
});

Deno.test("Z7 save: a database failure after a good exchange revokes the new token once, says a new code is needed, and leaks nothing", async () => {
  for (const broken of ["connect", "credentials"] as const) {
    for (const connected of [false, true]) {
      const w = new World({ connected });
      const vaultBefore = structuredClone(w.vault);
      Object.assign(w.deps, { [broken]: () => Promise.reject(new Error(`insert failed for ${CLIENT_ID} ${CLIENT_SECRET} ${NEW_REFRESH}`)) });
      const { result: reply, lines } = await capture(() => call(w, SAVE));
      assertError(reply, 500, "server_error");
      assert(reply.json.message.includes("رمزاً جديداً"), reply.json.message);
      assertEquals(w.net.revokeRequests().length, 1, broken);
      assertEquals(new URLSearchParams(w.net.revokeRequests()[0].body).get("token"), NEW_REFRESH, broken);
      assertEquals(w.net.tokenRequests().length, 1, broken);
      assertEquals(w.audits, [], broken);
      assertEquals(w.vault, vaultBefore, broken);
      assertEquals(w.attemptEnds, 1, broken);
      assertClean(reply.text, broken);
      assertClean(lines, broken);
    }
  }
});

Deno.test("Z7 save: a revoke that fails is counted and logged, and does not change the answer", async () => {
  for (const respond of [() => jsonReply({ error: "invalid_request" }, 400), () => Promise.reject(new TypeError(SENTINEL)), () => new Promise<Response>(() => {})]) {
    const w = new World();
    w.net.org = () => jsonReply({ org: [{ ...ORG_OK.org[0], type: "sandbox" }] });
    w.net.revoke = respond;
    const { result: reply, lines } = await capture(() => call(w, SAVE));
    assertEquals(reply.json.check.code, "wrong_environment");
    assertEquals(w.net.revokeRequests().length, 1);
    assertEquals(w.revokeFailed, 1);
    assert(lines.includes("revoke"));
    assertClean(lines, "log");
  }
});

Deno.test("Z7 save: a passing new link replaces the old one, and only then the old token is revoked with the old client's values", async () => {
  const w = new World({ connected: true });
  const order: string[] = [];
  const realConnect = w.deps.connect;
  w.deps.connect = (input) => {
    order.push("connect");
    return realConnect(input);
  };
  const realRevoke = w.net.revoke;
  w.net.revoke = (seen) => {
    order.push("revoke");
    return realRevoke(seen);
  };
  const reply = await call(w, SAVE);
  assertEquals(reply.json.saved, true);
  assertEquals(order, ["connect", "revoke"]);
  assertEquals(w.vault, { client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: NEW_REFRESH });
  const revoke = w.net.revokeRequests()[0];
  assertEquals(w.net.revokeRequests().length, 1);
  assertEquals(new URLSearchParams(revoke.body).get("token"), OLD_CLIENT.refresh_token);
  assertEquals(revoke.headers.Authorization, `Basic ${btoa(`${OLD_CLIENT.client_id}:${OLD_CLIENT.client_secret}`)}`);
  assertEquals(reply.json.old_revoked, true);
  assertEquals(reply.json.link.client_hint, "7f3a");
});

Deno.test("Z7 save: an old token that will not revoke is reported and does not undo the new link", async () => {
  const w = new World({ connected: true });
  w.net.revoke = () => jsonReply({ error: "invalid_request" }, 400);
  const { result: reply, lines } = await capture(() => call(w, SAVE));
  assertEquals(reply.res.status, 200);
  assertEquals(reply.json.saved, true);
  assertEquals(reply.json.old_revoked, false);
  assertEquals(w.vault?.refresh_token, NEW_REFRESH);
  assertEquals(w.revokeFailed, 1);
  assertClean(reply.text, "reply");
  assertClean(lines, "log");
});

Deno.test("Z7 save: if Zoho gave the same token back, it is not revoked out from under the new link", async () => {
  const w = new World({ connected: true });
  w.net.token = () => tokenOk({ refresh_token: OLD_CLIENT.refresh_token });
  const reply = await call(w, SAVE);
  assertEquals(reply.json.saved, true);
  assertEquals(w.net.revokeRequests().length, 0);
});

Deno.test("Z7 double submit: the same code again right after a success stays a success", async () => {
  const w = new World();
  const first = await call(w, SAVE);
  assertEquals(first.json.saved, true);
  w.net.token = () => jsonReply({ error: "invalid_code" });
  w.nowMs = NOW + 5_000;
  const second = await call(w, SAVE);
  assertEquals(second.res.status, 200);
  assertEquals(second.json.saved, true);
  assertEquals(second.json.check.ok, true);
  assertEquals(second.json.link.client_hint, "7f3a");
  assertEquals(w.connects.length, 1);
  assertEquals(w.audits.length, 1);
  assertEquals(w.net.revokeRequests().length, 0);
});

Deno.test("Z7 double submit: an old link or another client is not mistaken for it", async () => {
  const late = new World();
  await call(late, SAVE);
  late.net.token = () => jsonReply({ error: "invalid_code" });
  late.nowMs = NOW + 121_000;
  const lateReply = await call(late, SAVE);
  assertEquals(lateReply.json.saved, false);
  assertEquals(lateReply.json.check.code, "invalid_code");

  const other = new World();
  await call(other, SAVE);
  other.net.token = () => jsonReply({ error: "invalid_code" });
  const otherReply = await call(other, { ...SAVE, client_id: "1000.ANOTHER-CLIENT-9999" });
  assertEquals(otherReply.json.saved, false);

  const none = new World();
  none.net.token = () => jsonReply({ error: "invalid_code" });
  assertEquals((await call(none, SAVE)).json.saved, false);

  // رفض آخر غير invalid_code لا يُحسب ضغطة مزدوجة
  const refused = new World();
  await call(refused, SAVE);
  refused.net.token = () => jsonReply({ error: "invalid_client" });
  assertEquals((await call(refused, SAVE)).json.saved, false);
});

Deno.test("save: a read failing after the keys were stored still says saved, with the link just stored", async () => {
  for (const broken of ["readRow", "nameOf", "syncStatus"] as const) {
    const w = new World({ connected: true });
    Object.assign(w.deps, { [broken]: () => Promise.reject(new Error(`read failed ${SENTINEL}`)) });
    const { result: reply, lines } = await capture(() => call(w, SAVE));
    assertEquals(reply.res.status, 200, broken);
    assertEquals(reply.json.saved, true, broken);
    assertEquals(reply.json.check, OK_CHECK, broken);
    assertEquals(reply.json.link, {
      connected: true,
      org_name: "Mulaem",
      user_name: "مدير زوهو",
      user_profile: "Administrator",
      client_hint: "7f3a",
      connected_at: NOW_ISO,
      connected_by_name: "مدير تجريبي",
      check: OK_CHECK,
    }, broken);
    assertEquals(w.vault?.refresh_token, NEW_REFRESH, broken);
    assertEquals(w.audits.length, 1, broken);
    assertClean(reply.text, broken);
    assertClean(lines, broken);
    assert(lines.includes("save-readback"), broken);
  }
});

Deno.test("save: the same read failing after a refused exchange is an error that still says a new code is needed", async () => {
  const w = new World({ connected: true });
  w.net.token = () => jsonReply({ error: "invalid_code" });
  w.deps.readRow = () => Promise.reject(new Error(`read failed ${SENTINEL}`));
  const { result: reply, lines } = await capture(() => call(w, SAVE));
  assertError(reply, 500, "server_error");
  assert(reply.json.message.includes("رمزاً جديداً"));
  assertEquals(w.connects, []);
  assertEquals(w.attemptEnds, 1);
  assertClean(lines, "log");
});

Deno.test("save: when the attempt cannot even begin, the code was not spent, so nothing tells him to make a new one", async () => {
  const w = new World();
  w.deps.attemptBegin = () => Promise.reject(new Error(`db ${SENTINEL}`));
  const { result: reply } = await capture(() => call(w, SAVE));
  assertError(reply, 500, "server_error");
  assertFalse(reply.json.message.includes("رمزاً جديداً"));
  assertEquals(w.net.seen.length, 0);
});

Deno.test("save: a failing attempt end, counter or denial record changes nothing he sees", async () => {
  const w = new World();
  w.deps.attemptEnd = () => Promise.reject(new Error(`db ${SENTINEL}`));
  w.deps.noteTokens = () => Promise.reject(new Error(`db ${SENTINEL}`));
  const { result: reply, lines } = await capture(() => call(w, SAVE));
  assertEquals(reply.json.saved, true);
  assertClean(lines, "log");

  const denied = new World();
  denied.net.token = () => jsonReply({ error: "Access Denied" });
  denied.deps.tokenDenied = () => Promise.reject(new Error(`db ${SENTINEL}`));
  const second = await capture(() => call(denied, SAVE));
  assertEquals(second.result.json.check.code, "throttled");
  assertClean(second.lines, "log");
});

/* ===================== test ===================== */

Deno.test("test: not connected is 409 with no call to Zoho", async () => {
  const w = new World();
  assertError(await call(w, { action: "test" }), 409, "not_connected");
  assertEquals(w.net.seen.length, 0);
  assertEquals(w.records.length, 0);
  const noVault = new World({ connected: true });
  noVault.vault = null;
  assertError(await call(noVault, { action: "test" }), 409, "not_connected");
  assertEquals(noVault.net.seen.length, 0);
});

Deno.test("test: a pass refreshes once, uses the stored client, records the result, and writes no note and no audit row", async () => {
  const w = new World({ connected: true });
  w.net.token = () => jsonReply({ access_token: NEW_ACCESS, api_domain: "https://www.zohoapis.sa", expires_in: 3600 });
  const reply = await call(w, { action: "test" });
  assertEquals(reply.res.status, 200);
  assertEquals(Object.keys(reply.json).sort(), ["check", "link", "status", "sync"]);
  assertEquals(reply.json.check, OK_CHECK);
  assertEquals(reply.json.link.check, OK_CHECK);
  assertEquals(w.records, [OK_CHECK as never]);
  assertEquals(w.refreshes, 1);
  const refresh = new URLSearchParams(w.net.tokenRequests("refresh_token")[0].body);
  assertEquals(refresh.get("client_id"), OLD_CLIENT.client_id);
  assertEquals(refresh.get("client_secret"), OLD_CLIENT.client_secret);
  assertEquals(refresh.get("refresh_token"), OLD_CLIENT.refresh_token);
  assertEquals(w.net.tokenRequests("authorization_code").length, 0);
  assertEquals(w.audits, []);
  assertEquals(w.connects, []);
  assertEquals(w.net.noteRequests().length, 0);
  assertEquals(w.net.revokeRequests().length, 0);
});

const FAILING_TEST: [string, CheckCode, boolean, (w: World) => void][] = [
  ["refresh invalid_code", "token_revoked", true, (w) => w.net.token = () => jsonReply({ error: "invalid_code" })],
  ["refresh invalid_client", "invalid_client", true, (w) => w.net.token = () => jsonReply({ error: "invalid_client" })],
  ["refresh html", "server_error", false, (w) => w.net.token = () => new Response(`<html>${SENTINEL}</html>`, { status: 500 })],
  ["scope", "scope_mismatch", true, (w) => w.net.org = () => jsonReply({ code: "OAUTH_SCOPE_MISMATCH" }, 401)],
  ["permission", "no_permission", true, (w) => w.net.org = () => jsonReply({ code: "NO_PERMISSION" }, 403)],
  ["inactive", "inactive_user", true, (w) => w.net.org = () => jsonReply({ code: "INACTIVE_USER" }, 403)],
  ["sandbox", "wrong_environment", true, (w) => w.net.org = () => jsonReply({ org: [{ ...ORG_OK.org[0], type: "sandbox" }] })],
  ["org", "wrong_org", true, (w) => w.net.org = () => jsonReply({ org: [{ ...ORG_OK.org[0], zgid: "1", domain_name: "x" }] })],
  ["not admin", "not_admin", true, (w) => w.net.user = () => jsonReply({ users: [{ profile: { name: "M1" } }] })],
  ["429", "rate_limited", false, (w) => w.net.org = () => jsonReply({}, 429)],
  ["500", "server_error", false, (w) => w.net.org = () => jsonReply({}, 500)],
  ["lost", "network", false, (w) => w.net.org = () => Promise.reject(new TypeError(SENTINEL))],
  ["hang", "timeout", false, (w) => w.net.org = () => new Promise<Response>(() => {})],
];

Deno.test("test: a failure is recorded, the link stays connected, no token is revoked, and old stats are not shown as current", async () => {
  for (const [label, code, reconnect, breakIt] of FAILING_TEST) {
    const w = new World({ connected: true, enabled: true });
    breakIt(w);
    const { result: reply, lines } = await capture(() => call(w, { action: "test" }));
    assertEquals(reply.res.status, 200, label);
    assertEquals(reply.json.check, { ok: false, code, at: NOW_ISO, stats: null }, label);
    assertEquals(reply.json.link.connected, true, label);
    assertEquals(reply.json.link.check, { ok: false, code, at: NOW_ISO, stats: null }, label);
    assertEquals(w.vault, { ...OLD_CLIENT }, label);
    assertEquals(w.net.revokeRequests().length, 0, label);
    assertEquals(reply.json.sync.needs_reconnect, reconnect, label);
    assertEquals(reply.json.sync.enabled, true, label);
    assertClean(reply.text, label);
    assertClean(lines, label);
  }
});

Deno.test("test: a pass clears the mark, so the sync resumes without a new code", async () => {
  const w = new World({ connected: true, enabled: true, needsReconnect: true });
  const reply = await call(w, { action: "test" });
  assertEquals(reply.json.check.ok, true);
  assertEquals(reply.json.sync.needs_reconnect, false);
});

Deno.test("test: a transient failure leaves the mark alone", async () => {
  const w = new World({ connected: true, needsReconnect: true });
  w.net.org = () => jsonReply({}, 500);
  assertEquals((await call(w, { action: "test" })).json.sync.needs_reconnect, true);
});

Deno.test("test: a limit is not a fault in the link: nothing is written over the last check, and he is told how long", async () => {
  const ours = new World({ connected: true });
  ours.refreshGate = { allowed: false, wait_seconds: 180 };
  const before = structuredClone(ours.row);
  const reply = await call(ours, { action: "test" });
  assertEquals(reply.json.check, { ok: false, code: "throttled", at: NOW_ISO, stats: null });
  assertEquals(reply.json.wait_seconds, 180);
  assertEquals(ours.records, []);
  assertEquals(ours.row, before);
  assertEquals(ours.net.seen.length, 0);

  const theirs = new World({ connected: true });
  theirs.net.token = () => jsonReply({ error: "Access Denied" });
  const denied = await call(theirs, { action: "test" });
  assertEquals(denied.json.check.code, "throttled");
  assertEquals(denied.json.wait_seconds, 600);
  assertEquals(theirs.records, []);
  assertEquals(theirs.denied, 1);
});

Deno.test("test: when recording fails the reply is a plain 500", async () => {
  const w = new World({ connected: true });
  w.deps.recordCheck = () => Promise.reject(new Error(`update failed ${SENTINEL}`));
  const { result: reply, lines } = await capture(() => call(w, { action: "test" }));
  assertError(reply, 500, "server_error");
  assertClean(reply.text, "reply");
  assertClean(lines, "log");
});

async function heldTest(w: World) {
  let release: ((res: Response) => void) | null = null;
  w.deps.callTimeoutMs = 5_000;
  w.net.org = () => new Promise<Response>((resolve) => (release = resolve));
  const reply = call(w, { action: "test" });
  while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
  return { reply, release: release as (res: Response) => void };
}

Deno.test("test: a slow check of the old key does not overwrite a save made meanwhile", async () => {
  const w = new World({ connected: true });
  const held = await heldTest(w);
  w.net.org = () => jsonReply(ORG_OK);
  w.nowMs = NOW + 1000;
  assertEquals((await call(w, SAVE)).json.saved, true);
  const saved = structuredClone(w.row);

  held.release(jsonReply({ code: "OAUTH_SCOPE_MISMATCH" }, 401));
  const reply = await held.reply;
  assertEquals(reply.res.status, 200);
  assertEquals(w.row, saved);
  assertEquals(reply.json.check, reply.json.link.check);
  assertEquals(reply.json.check.ok, true);
  assertEquals(reply.json.link.client_hint, "7f3a");
  assertEquals(w.state.needs_reconnect, false);
});

Deno.test("test: a link removed during the check answers not_connected, not a passed check", async () => {
  const w = new World({ connected: true });
  const held = await heldTest(w);
  assertEquals((await call(w, { action: "disconnect" })).json.link.connected, false);
  held.release(jsonReply(ORG_OK));
  assertError(await held.reply, 409, "not_connected");
  assertEquals(w.row, null);
});

/* ===================== disconnect ===================== */

Deno.test("disconnect: revokes at Zoho first with the stored client, wipes here, stops the sync, and repeating it is harmless", async () => {
  const w = new World({ connected: true, enabled: true, needsReconnect: true });
  const order: string[] = [];
  const realRevoke = w.net.revoke;
  w.net.revoke = (seen) => {
    order.push("revoke");
    return realRevoke(seen);
  };
  const realDisconnect = w.deps.disconnect;
  w.deps.disconnect = () => {
    order.push("wipe");
    return realDisconnect();
  };
  const reply = await call(w, { action: "disconnect" });
  assertEquals(reply.res.status, 200);
  assertEquals(reply.json, { status: "ok", revoked: true, link: EMPTY_LINK, sync: { ...reply.json.sync, enabled: false, needs_reconnect: false } });
  assertEquals(reply.json.sync.enabled, false);
  assertEquals(order, ["revoke", "wipe"]);
  const revoke = w.net.revokeRequests()[0];
  assertEquals(new URLSearchParams(revoke.body).get("token"), OLD_CLIENT.refresh_token);
  assertEquals(revoke.headers.Authorization, `Basic ${btoa(`${OLD_CLIENT.client_id}:${OLD_CLIENT.client_secret}`)}`);
  assertEquals(w.row, null);
  assertEquals(w.vault, null);
  assertEquals(w.state.enabled, false);

  const again = await call(w, { action: "disconnect" });
  assertEquals(again.res.status, 200);
  assertEquals(again.json.revoked, false);
  assertEquals(w.net.revokeRequests().length, 1);
  assertError(await call(w, { action: "test" }), 409, "not_connected");
});

Deno.test("disconnect: anything but HTTP 200 from Zoho is revoked=false, and the local copy goes anyway", async () => {
  for (const respond of [() => jsonReply({ error: "invalid_request" }, 400), () => new Response("<html></html>", { status: 500 }), () => Promise.reject(new TypeError(SENTINEL)), () => new Promise<Response>(() => {})]) {
    const w = new World({ connected: true });
    w.net.revoke = respond;
    const { result: reply, lines } = await capture(() => call(w, { action: "disconnect" }));
    assertEquals(reply.res.status, 200);
    assertEquals(reply.json.revoked, false);
    assertEquals(reply.json.link, EMPTY_LINK);
    assertEquals(w.row, null);
    assertEquals(w.vault, null);
    assertEquals(w.revokeFailed, 1);
    assertClean(reply.text, "reply");
    assertClean(lines, "log");
  }
});

Deno.test("disconnect: when the database refuses, the reply is a plain 500 and no audit row is written", async () => {
  const w = new World({ connected: true });
  w.deps.disconnect = () => Promise.reject(new Error(`delete failed ${SENTINEL}`));
  const { result: reply, lines } = await capture(() => call(w, { action: "disconnect" }));
  assertError(reply, 500, "server_error");
  assertEquals(w.audits, []);
  assertClean(lines, "log");
});

Deno.test("disconnect: a read failing afterwards cannot make it look undone", async () => {
  for (const broken of ["readRow", "nameOf"] as const) {
    const w = new World({ connected: true, enabled: true });
    Object.assign(w.deps, { [broken]: () => Promise.reject(new Error(`read failed ${SENTINEL}`)) });
    const { result: reply } = await capture(() => call(w, { action: "disconnect" }));
    assertEquals(reply.res.status, 200, broken);
    assertEquals(reply.json.link, EMPTY_LINK, broken);
    assertEquals(reply.json.sync.enabled, false, broken);
    assertEquals(w.vault, null, broken);
    assert(w.audits.length >= 1, broken);
  }
});

/* ===================== preview ===================== */

function previewWorld(start: WorldStart = {}) {
  const w = new World({ connected: true, ...start });
  w.net.token = () => jsonReply({ access_token: NEW_ACCESS, api_domain: "https://www.zohoapis.sa", expires_in: 3600 });
  return w;
}

Deno.test("preview: not connected to Zoho is not_connected; to Maqsam is maqsam_not_connected; neither calls out", async () => {
  const noZoho = new World();
  assertError(await call(noZoho, { action: "preview" }), 409, "not_connected");
  assertEquals(noZoho.net.seen.length, 0);
  const noMaqsam = new World({ connected: true, maqsam: false });
  assertError(await call(noMaqsam, { action: "preview" }), 409, "maqsam_not_connected");
  assertEquals(noMaqsam.net.seen.length, 0);
});

Deno.test("preview: the contract's shape, the note exactly as it would be written, and the record's address", async () => {
  const w = previewWorld();
  w.net.maqsamPages = [[maqsamCall({ id: 7654321, summary: { ar: `${SUMMARY_MARK} العميل مهتم` } })]];
  w.net.leads.set(CUSTOMER_NUMBER, [{ id: LEAD_ID, Modified_Time: "2026-11-05T10:00:00+03:00" }]);
  const reply = await call(w, { action: "preview" });
  assertEquals(reply.res.status, 200);
  assertEquals(Object.keys(reply.json).sort(), ["preview", "status", "sync"]);
  assertEquals(reply.json.preview.counts, { calls: 1, with_summary: 1, already_written: 0, matched: 1, no_match: 0, ambiguous: 0 });
  assertEquals(reply.json.preview.samples.length, 1);
  const sample = reply.json.preview.samples[0];
  assertEquals(Object.keys(sample).sort(), ["agent", "ambiguous", "at", "call_id", "direction", "duration", "match", "note_text", "note_title"]);
  assertEquals(sample.call_id, 7654321);
  assertEquals(sample.at, new Date(Math.floor((NOW - HOUR) / 1000) * 1000).toISOString());
  assertEquals(sample.direction, "outbound");
  assertEquals(sample.duration, 192);
  assertEquals(sample.agent, "موظف تجريبي");
  assertEquals(sample.note_title, "مكالمة مقسم #7654321");
  assertEquals(sample.note_text, `مكالمة مقسم: 6 نوفمبر 2:00 م، صادرة، 3 د 12 ث\nالموظف: موظف تجريبي\nالملخص: ${SUMMARY_MARK} العميل مهتم`);
  assertEquals(sample.match, { module: "Leads", id: LEAD_ID, url: `https://crm.zoho.sa/crm/org150000145002/tab/Leads/${LEAD_ID}` });
  assertEquals(sample.ambiguous, false);
  assertEquals(reply.json.sync, EMPTY_SYNC);
});

Deno.test("Z8 preview: reads the first page of 7 days and writes nothing anywhere", async () => {
  const w = previewWorld();
  w.net.maqsamPages = [[maqsamCall()]];
  await call(w, { action: "preview" });
  const url = new URL(w.net.maqsamRequests()[0].url);
  assertEquals(w.net.maqsamRequests().length, 1);
  assertEquals(url.searchParams.get("page"), "1");
  const nowSec = Math.floor(NOW / 1000);
  assertEquals(url.searchParams.get("end_time"), String(nowSec));
  assertEquals(url.searchParams.get("start_time"), String(nowSec - 7 * 86_400));
  assertEquals(w.net.noteRequests().length, 0);
  assertEquals(w.calls.size, 0);
  assertEquals(w.audits, []);
  assertEquals(w.marks, []);
});

Deno.test("preview: at most 5, newest first, with a summary, and not already written; counts tell the rest", async () => {
  const w = previewWorld();
  const calls = [
    ...Array.from({ length: 7 }, (_, i) => maqsamCall({ id: 100 + i, ageMs: (i + 1) * HOUR })),
    maqsamCall({ id: 200, ageMs: 10_000, summary: { ar: null, en: null } }),
    maqsamCall({ id: 201, ageMs: 10_000, state: "no_answer", duration: 0 }),
    { id: "bad" },
  ];
  w.net.maqsamPages = [calls];
  w.addCall(100, "written", { zoho_note_id: "1500000000000000999" });
  w.net.leads.set(CUSTOMER_NUMBER, [{ id: LEAD_ID, Modified_Time: "x" }]);
  const reply = await call(w, { action: "preview" });
  assertEquals(reply.json.preview.samples.map((sample: Json) => sample.call_id), [101, 102, 103, 104, 105]);
  assertEquals(reply.json.preview.counts, { calls: 10, with_summary: 7, already_written: 1, matched: 5, no_match: 0, ambiguous: 0 });
  // البحث مرة واحدة لكل رقم، والرقم نفسه في الخمس
  assertEquals(w.net.apiRequests().length, 1);
});

Deno.test("preview: no match and ambiguous are shown as such, and Contacts are found", async () => {
  const w = previewWorld();
  w.net.maqsamPages = [[
    maqsamCall({ id: 1, ageMs: HOUR, number: CUSTOMER_NUMBER }),
    maqsamCall({ id: 2, ageMs: 2 * HOUR, number: OTHER_NUMBER }),
    maqsamCall({ id: 3, ageMs: 3 * HOUR, number: "966500000003" }),
    maqsamCall({ id: 4, ageMs: 4 * HOUR, number: "not a number" }),
  ]];
  w.net.leads.set(CUSTOMER_NUMBER, [{ id: LEAD_ID, Modified_Time: "2026-11-05T10:00:00+03:00" }, { id: "1500000000000000333", Modified_Time: "2026-11-01T10:00:00+03:00" }]);
  w.net.contacts.set(OTHER_NUMBER, [{ id: CONTACT_ID, Modified_Time: "2026-11-05T10:00:00+03:00" }]);
  const { json } = await call(w, { action: "preview" });
  assertEquals(json.preview.counts, { calls: 4, with_summary: 4, already_written: 0, matched: 2, no_match: 2, ambiguous: 1 });
  const [first, second, third, fourth] = json.preview.samples;
  assertEquals(first.match.id, LEAD_ID);
  assertEquals(first.ambiguous, true);
  assertEquals(second.match, { module: "Contacts", id: CONTACT_ID, url: `https://crm.zoho.sa/crm/org150000145002/tab/Contacts/${CONTACT_ID}` });
  assertEquals(second.ambiguous, false);
  assertEquals(third.match, null);
  assertEquals(fourth.match, null);
});

Deno.test("preview: nothing to look up means no token refresh and no call to Zoho at all", async () => {
  const w = previewWorld();
  w.net.maqsamPages = [[maqsamCall({ id: 1, summary: null }), maqsamCall({ id: 2, state: "busy" })]];
  const reply = await call(w, { action: "preview" });
  assertEquals(reply.json.preview.samples, []);
  assertEquals(reply.json.preview.counts, { calls: 2, with_summary: 0, already_written: 0, matched: 0, no_match: 0, ambiguous: 0 });
  assertEquals(w.net.zohoRequests().length, 0);
  assertEquals(w.refreshes, 0);
});

Deno.test("preview: a Maqsam failure says so in Arabic and asks nothing of Zoho", async () => {
  const table: [() => Response | Promise<Response>, string][] = [
    [() => new Response("", { status: 401 }), "رفض مقسم"],
    [() => new Response("", { status: 429 }), "طلب مقسم"],
    [() => new Response("", { status: 500 }), "عند مقسم"],
    [() => new Response("<html></html>", { status: 200 }), "رد مقسم"],
    [() => Promise.reject(new TypeError(SENTINEL)), "تعذّر الوصول إلى مقسم"],
    [() => new Promise<Response>(() => {}), "لم يرد مقسم"],
  ];
  for (const [respond, words] of table) {
    const w = previewWorld();
    w.net.maqsam = respond;
    const { result: reply, lines } = await capture(() => call(w, { action: "preview" }));
    assertError(reply, 502, "server_error");
    assert(reply.json.message.includes(words), reply.json.message);
    assertEquals(w.net.zohoRequests().length, 0);
    assertClean(reply.text, "reply");
    assertClean(lines, "log");
  }
});

const ZOHO_ERRORS: [string, (w: World) => void, string, boolean][] = [
  ["scope", (w) => w.net.coql = () => jsonReply({ code: "OAUTH_SCOPE_MISMATCH" }, 401), "صلاحيات", true],
  ["permission", (w) => w.net.coql = () => jsonReply({ code: "NO_PERMISSION" }, 403), "الصلاحية", true],
  ["inactive", (w) => w.net.coql = () => jsonReply({ code: "INACTIVE_USER" }, 403), "موقوف", true],
  ["refresh dead", (w) => w.net.token = () => jsonReply({ error: "invalid_code" }), "انقطع الربط", true],
  ["refresh client", (w) => w.net.token = () => jsonReply({ error: "invalid_client" }), "رفض Zoho", true],
  ["429", (w) => w.net.coql = () => jsonReply({}, 429), "التمهّل", false],
  ["500", (w) => w.net.coql = () => jsonReply({}, 500), "خطأ مؤقت", false],
  ["query", (w) => w.net.coql = () => jsonReply({ code: "INVALID_QUERY" }, 400), "غير متوقعة", false],
  ["lost", (w) => w.net.coql = () => Promise.reject(new TypeError(SENTINEL)), "تعذّر الوصول", false],
  ["hang", (w) => w.net.coql = () => new Promise<Response>(() => {}), "لم يرد", false],
];

Deno.test("preview: a Zoho failure says what happened and what to do, and raises the mark when only an admin can fix it", async () => {
  for (const [label, breakIt, words, reconnect] of ZOHO_ERRORS) {
    const w = new World({ connected: true, enabled: true });
    w.net.maqsamPages = [[maqsamCall()]];
    breakIt(w);
    const { result: reply, lines } = await capture(() => call(w, { action: "preview" }));
    assertError(reply, 502, "server_error");
    assert(reply.json.message.includes(words), `${label}: ${reply.json.message}`);
    assertEquals(w.state.needs_reconnect, reconnect, label);
    assertClean(reply.text, label);
    assertNoCustomer(lines, label);
  }
  const limited = new World({ connected: true });
  limited.net.maqsamPages = [[maqsamCall()]];
  limited.refreshGate = { allowed: false, wait_seconds: 300 };
  const reply = await call(limited, { action: "preview" });
  assertError(reply, 502, "server_error");
  assert(reply.json.message.includes("5 دقيقة"), reply.json.message);
});

/* ===================== write_one ===================== */

function writeWorld(start: WorldStart = {}) {
  const w = previewWorld(start);
  w.net.maqsamOne.set(1234567, maqsamCall());
  w.net.leads.set(CUSTOMER_NUMBER, [{ id: LEAD_ID, Modified_Time: "2026-11-05T10:00:00+03:00" }]);
  return w;
}
const WRITE = { action: "write_one", call_id: 1234567 };

Deno.test("Z8 write_one: writes exactly one real note to the matched record, stores the ids, and audits it", async () => {
  const w = writeWorld();
  const reply = await call(w, WRITE);
  assertEquals(reply.res.status, 200);
  assertEquals(Object.keys(reply.json).sort(), ["status", "sync", "written"]);
  const noteId = w.net.notes[0].id;
  assertEquals(reply.json.written, { note_id: noteId, module: "Leads", record_id: LEAD_ID, url: `https://crm.zoho.sa/crm/org150000145002/tab/Leads/${LEAD_ID}` });
  assertEquals(w.net.notes.length, 1);
  assertEquals(w.net.notes[0].title, "مكالمة مقسم #1234567");
  assert(w.net.notes[0].text.startsWith("مكالمة مقسم: "));
  assertEquals(w.net.notes[0].parent, { id: LEAD_ID, module: { api_name: "Leads" } });
  const row = w.calls.get(1234567)!;
  assertEquals([row.status, row.zoho_module, row.zoho_record_id, row.zoho_note_id, row.attempts], ["written", "Leads", LEAD_ID, noteId, 1]);
  assertEquals(w.audits, [{ action: "كتابة ملاحظة واحدة في Zoho", user_id: 7, user_name: "مدير تجريبي" }]);
  assertEquals(reply.json.sync.written_total, 1);
  assertEquals(w.net.maqsamRequests()[0].url, "https://api.av.maqsam.com/v2/calls/1234567");
});

Deno.test("Z10 write_one: written before returns the earlier result without writing or calling anything", async () => {
  const w = writeWorld();
  const first = await call(w, WRITE);
  const seenBefore = w.net.seen.length;
  const second = await call(w, WRITE);
  assertEquals(second.res.status, 200);
  assertEquals(second.json.written, first.json.written);
  assertEquals(w.net.seen.length, seenBefore);
  assertEquals(w.net.notes.length, 1);
  assertEquals(w.audits.length, 1);
});

Deno.test("Z10 write_one: written by a tick while this request ran returns that result and writes nothing", async () => {
  const w = writeWorld();
  const realLookup = w.net.coql;
  w.net.coql = (seen) => {
    w.addCall(1234567, "written", { zoho_module: "Contacts", zoho_record_id: CONTACT_ID, zoho_note_id: "1500000000000000999" });
    return realLookup(seen);
  };
  const reply = await call(w, WRITE);
  assertEquals(reply.json.written, { note_id: "1500000000000000999", module: "Contacts", record_id: CONTACT_ID, url: `https://crm.zoho.sa/crm/org150000145002/tab/Contacts/${CONTACT_ID}` });
  assertEquals(w.net.noteRequests().length, 0);
  assertEquals(w.audits.length, 0);
});

Deno.test("write_one: runs with the sync off, because it follows a press by an admin", async () => {
  const w = writeWorld({ enabled: false });
  assertEquals((await call(w, WRITE)).res.status, 200);
  assertEquals(w.state.enabled, false);
  assertEquals(w.net.notes.length, 1);
});

Deno.test("write_one: not connected, no Maqsam, bad ids", async () => {
  assertError(await call(new World(), WRITE), 409, "not_connected");
  assertError(await call(new World({ connected: true, maqsam: false }), WRITE), 409, "maqsam_not_connected");
  for (const call_id of [null, undefined, "", "x", 0, -1, 1.5, {}, [], "1;2", "1 OR 1=1", "1234567890123456"]) {
    const w = writeWorld();
    assertError(await call(w, { action: "write_one", call_id }), 400, "bad_request");
    assertEquals(w.net.seen.length, 0, JSON.stringify(call_id));
  }
  const text = writeWorld();
  assertEquals((await call(text, { action: "write_one", call_id: "1234567" })).res.status, 200);
});

Deno.test("write_one: no match is no_match, nothing is written, and the call stays free for later", async () => {
  const w = writeWorld();
  w.net.leads.clear();
  assertError(await call(w, WRITE), 409, "no_match");
  assertEquals(w.net.noteRequests().length, 0);
  assertEquals(w.calls.size, 0);
  assertEquals(w.audits, []);

  const noNumber = writeWorld();
  noNumber.net.maqsamOne.set(1234567, maqsamCall({ number: "not a number" }));
  assertError(await call(noNumber, WRITE), 409, "no_match");
  assertEquals(noNumber.net.zohoRequests().length, 0);
});

Deno.test("write_one: a call with no summary or that is not a talk is refused in Arabic, with no Zoho call", async () => {
  for (const options of [{ summary: null }, { summary: { ar: "", en: "" } }, { state: "no_answer" }, { duration: 0 }]) {
    const w = writeWorld();
    w.net.maqsamOne.set(1234567, maqsamCall(options));
    assertError(await call(w, WRITE), 409, "bad_request");
    assertEquals(w.net.zohoRequests().length, 0, JSON.stringify(options));
    assertEquals(w.calls.size, 0);
  }
});

Deno.test("write_one: Maqsam's answers: not found, failures, and a reply about another call", async () => {
  const missing = writeWorld();
  missing.net.maqsamOne.clear();
  assertError(await call(missing, WRITE), 404, "bad_request");
  assertEquals(missing.net.zohoRequests().length, 0);

  const down = writeWorld();
  down.net.maqsam = () => new Response("", { status: 500 });
  assertError(await call(down, WRITE), 502, "server_error");

  const other = writeWorld();
  other.net.maqsamOne.set(1234567, maqsamCall({ id: 999 }));
  assertError(await call(other, WRITE), 502, "server_error");
  assertEquals(other.net.noteRequests().length, 0);
});

Deno.test("Z10 write_one: a live claim by someone else is refused and writes nothing", async () => {
  const w = writeWorld();
  w.addCall(1234567, "claimed", { zoho_module: "Leads", zoho_record_id: LEAD_ID });
  assertError(await call(w, WRITE), 409, "bad_request");
  assertEquals(w.net.noteRequests().length, 0);
});

Deno.test("Z10 write_one: a stale claim searches the title first and finds the note a lost reply left behind", async () => {
  const w = writeWorld();
  w.addCall(1234567, "claimed", { zoho_module: "Contacts", zoho_record_id: CONTACT_ID, updated_at: new Date(NOW - 31 * 60_000).toISOString() });
  w.net.existingNotes.set(noteTitle(1234567), "1500000000000000777");
  const reply = await call(w, WRITE);
  assertEquals(reply.json.written, { note_id: "1500000000000000777", module: "Contacts", record_id: CONTACT_ID, url: `https://crm.zoho.sa/crm/org150000145002/tab/Contacts/${CONTACT_ID}` });
  assertEquals(w.net.noteRequests().length, 0);
  assertEquals(w.calls.get(1234567)?.status, "written");
  assertEquals(w.audits, []);
});

Deno.test("Z10 write_one: a stale claim with no note found retries, and writes once", async () => {
  const w = writeWorld();
  w.addCall(1234567, "claimed", { zoho_module: "Leads", zoho_record_id: LEAD_ID, attempts: 1, updated_at: new Date(NOW - 31 * 60_000).toISOString() });
  assertEquals((await call(w, WRITE)).res.status, 200);
  assertEquals(w.net.notes.length, 1);
  assertEquals(w.calls.get(1234567)?.attempts, 2);
});

Deno.test("Z10 write_one: a lost reply to the POST keeps the claim, so nothing can write a second note for 30 minutes", async () => {
  for (const respond of [() => Promise.reject(new TypeError(SENTINEL)), () => new Promise<Response>(() => {}), () => new Response("<html></html>", { status: 502 })]) {
    const w = writeWorld();
    w.net.note = respond;
    const { result: reply, lines } = await capture(() => call(w, WRITE));
    assertError(reply, 502, "server_error");
    assertEquals(w.calls.get(1234567)?.status, "claimed");
    assertEquals(w.audits, []);
    assertNoCustomer(reply.text, "reply");
    assertNoCustomer(lines, "log");
    w.net.note = (seen) => w.net.defaultNote(seen);
    assertError(await call(w, WRITE), 409, "bad_request");
    assertEquals(w.net.notes.length, 0);
  }
});

Deno.test("write_one: Zoho refusing the note says so, releases it, and counts the attempt", async () => {
  const w = writeWorld();
  w.net.note = () => jsonReply({ data: [{ code: "INVALID_DATA", status: "error", message: `bad ${SENTINEL}` }] }, 400);
  const { result: reply } = await capture(() => call(w, WRITE));
  assertError(reply, 502, "server_error");
  assert(reply.json.message.includes("رفض Zoho"));
  assertEquals(w.calls.get(1234567)?.status, "waiting");
  assertEquals(w.calls.get(1234567)?.attempts, 1);
  assertEquals(w.audits, []);
});

Deno.test("write_one: a scope problem on the write itself raises the mark, because only a new code fixes it", async () => {
  const w = writeWorld({ enabled: true });
  w.net.note = () => jsonReply({ code: "OAUTH_SCOPE_MISMATCH" }, 401);
  const { result: reply } = await capture(() => call(w, WRITE));
  assertError(reply, 502, "server_error");
  assert(reply.json.message.includes("صلاحيات"));
  assertEquals(w.state.needs_reconnect, true);
  assertEquals(w.calls.get(1234567)?.status, "waiting");
  assertEquals(w.calls.get(1234567)?.attempts, 0);
});

Deno.test("write_one: Zoho's errors during the lookup answer as in preview", async () => {
  for (const [label, breakIt, words, reconnect] of ZOHO_ERRORS) {
    const w = writeWorld();
    breakIt(w);
    const { result: reply, lines } = await capture(() => call(w, WRITE));
    assertError(reply, 502, "server_error");
    assert(reply.json.message.includes(words), `${label}: ${reply.json.message}`);
    assertEquals(w.state.needs_reconnect, reconnect, label);
    assertEquals(w.net.noteRequests().length, 0, label);
    assertEquals(w.calls.size, 0, label);
    assertNoCustomer(lines, label);
  }
});

Deno.test("write_one: a failing audit row does not fail the note that was written", async () => {
  const w = writeWorld();
  w.deps.audit = () => Promise.reject(new Error(`audit failed ${SENTINEL}`));
  const { result: reply, lines } = await capture(() => call(w, WRITE));
  assertEquals(reply.res.status, 200);
  assertEquals(w.net.notes.length, 1);
  assertClean(lines, "log");
});

/* ===================== تشغيل النقل وإيقافه ===================== */

Deno.test("sync_start: both links needed; refused with not_connected, in Arabic, and the state stays off", async () => {
  for (const start of [{}, { connected: true, maqsam: false }]) {
    const w = new World(start);
    const reply = await call(w, { action: "sync_start", from: "now" });
    assertError(reply, 409, "not_connected");
    assertEquals(w.state.enabled, false);
    assertEquals(w.audits, []);
  }
});

Deno.test("sync_start: from now or from 30 days, nothing else", async () => {
  const now = new World({ connected: true });
  const reply = await call(now, { action: "sync_start", from: "now" });
  assertEquals(reply.res.status, 200);
  assertEquals(Object.keys(reply.json).sort(), ["status", "sync"]);
  assertEquals(reply.json.sync.enabled, true);
  assertEquals(reply.json.sync.start_from, NOW_ISO);
  assertEquals(reply.json.sync.started_at, NOW_ISO);
  assertEquals(reply.json.sync.started_by_name, "مدير تجريبي");
  assertEquals(now.audits, [{ action: "تشغيل نقل الملخصات", user_id: 7, user_name: "مدير تجريبي" }]);

  const back = new World({ connected: true });
  assertEquals((await call(back, { action: "sync_start", from: "days30" })).json.sync.start_from, new Date(NOW - 30 * 24 * HOUR).toISOString());

  for (const from of [undefined, null, "", "days7", "NOW", 30, {}, "2020-01-01"]) {
    const w = new World({ connected: true });
    assertError(await call(w, { action: "sync_start", from }), 400, "bad_request");
    assertEquals(w.state.enabled, false, JSON.stringify(from));
  }
});

Deno.test("sync_start: starting what runs keeps its place and adds no audit row", async () => {
  const w = new World({ connected: true, enabled: true, startFrom: "2026-11-01T00:00:00.000Z" });
  const reply = await call(w, { action: "sync_start", from: "days30" });
  assertEquals(reply.res.status, 200);
  assertEquals(reply.json.sync.start_from, "2026-11-01T00:00:00.000Z");
  assertEquals(w.audits, []);
});

Deno.test("sync_start: a link that needs reconnecting is refused and says what to do", async () => {
  const w = new World({ connected: true, needsReconnect: true });
  const reply = await call(w, { action: "sync_start", from: "now" });
  assertError(reply, 409, "not_connected");
  assert(reply.json.message.includes("إعادة ربط"));
  assertEquals(w.state.enabled, false);
});

Deno.test("Z8 sync_start and sync_stop send nothing to Zoho or Maqsam", async () => {
  const w = new World({ connected: true });
  await call(w, { action: "sync_start", from: "days30" });
  await call(w, { action: "sync_stop" });
  assertEquals(w.net.seen.length, 0);
  assertEquals(w.credentialReads, 0);
  assertEquals(w.maqsamReads, 0);
});

Deno.test("sync_stop: stops, audits once, and repeating it is harmless", async () => {
  const w = new World({ connected: true, enabled: true });
  const reply = await call(w, { action: "sync_stop" });
  assertEquals(reply.res.status, 200);
  assertEquals(Object.keys(reply.json).sort(), ["status", "sync"]);
  assertEquals(reply.json.sync.enabled, false);
  assertEquals(w.audits, [{ action: "إيقاف نقل الملخصات", user_id: 7, user_name: "مدير تجريبي" }]);
  assertEquals((await call(w, { action: "sync_stop" })).res.status, 200);
  assertEquals(w.audits.length, 1);
});

/* ===================== سجل النشاطات ===================== */

Deno.test("audit: one row per real change, naming the action only", async () => {
  const w = new World();
  await call(w, SAVE);
  assertEquals(w.audits, [{ action: "ربط Zoho", user_id: 7, user_name: "مدير تجريبي" }]);
  await call(w, { action: "sync_start", from: "now" });
  await call(w, { action: "disconnect" });
  assertEquals(w.audits.map((row) => row.action), ["ربط Zoho", "تشغيل نقل الملخصات", "فصل Zoho", "إيقاف نقل الملخصات"]);
  assertClean(JSON.stringify(w.audits), "audit");
});

Deno.test("audit: status, test, preview and a failed save write no row", async () => {
  const w = new World({ connected: true });
  w.net.maqsamPages = [[]];
  await call(w, { action: "status" });
  await call(w, { action: "test" });
  await call(w, { action: "preview" });
  w.net.token = () => jsonReply({ error: "invalid_code" });
  await call(w, SAVE);
  assertEquals(w.audits, []);
});

Deno.test("audit: falls back to the username; no legacy number is still recorded; a failure does not fail what happened", async () => {
  const w = new World();
  await call(w, SAVE, { token: "noname-token" });
  assertEquals(w.audits, [{ action: "ربط Zoho", user_id: null, user_name: "noname.test" }]);

  const saved = new World();
  saved.deps.audit = () => Promise.reject(new Error(`audit failed ${SENTINEL}`));
  const first = await capture(() => call(saved, SAVE));
  assertEquals(first.result.json.saved, true);
  assertClean(first.lines, "log");

  const removed = new World({ connected: true });
  removed.deps.audit = () => Promise.reject(new Error(`audit failed ${SENTINEL}`));
  const second = await capture(() => call(removed, { action: "disconnect" }));
  assertEquals(second.result.res.status, 200);
  assertClean(second.lines, "log");
});

/* ===================== Z2 وZ5 وZ8: ما يخرج وما يُكتب ===================== */

Deno.test("Z2 Z5 Z8 a whole lifecycle: nothing secret in any reply or log, no customer data in a log or a stored value, and only Notes is ever written", async () => {
  const w = new World();
  const replies: string[] = [];
  const say = async (body: unknown) => {
    const reply = await call(w, body);
    replies.push(reply.text);
    return reply;
  };
  const { lines } = await capture(async () => {
    w.net.token = () => jsonReply({ error: "invalid_client", detail: SENTINEL });
    assertEquals((await say(SAVE)).json.saved, false);
    w.net.token = () => tokenOk();
    w.net.user = () => jsonReply({ users: [{ profile: { name: "M1" }, email: SENTINEL }] });
    assertEquals((await say(SAVE)).json.check.code, "not_admin");
    w.net.user = () => jsonReply({ users: [{ full_name: "مدير", profile: { name: "Administrator" }, email: SENTINEL }] });
    assertEquals((await say(SAVE)).json.saved, true);
    w.net.token = () => jsonReply({ access_token: NEW_ACCESS, expires_in: 3600 });
    await say({ action: "status" });
    await say({ action: "test" });
    w.net.maqsamPages = [[maqsamCall(), maqsamCall({ id: 7654321, number: OTHER_NUMBER })]];
    w.net.maqsamOne.set(1234567, maqsamCall());
    w.net.maqsamOne.set(7654321, maqsamCall({ id: 7654321, number: OTHER_NUMBER }));
    w.net.leads.set(CUSTOMER_NUMBER, [{ id: LEAD_ID, Modified_Time: "x" }]);
    const preview = await say({ action: "preview" });
    // المعاينة وحدها تحمل الملخص، ولا تحمل رقماً
    assert(preview.text.includes(SUMMARY_MARK));
    assertClean(preview.text, "preview");
    assertFalse(preview.text.includes(CUSTOMER_NUMBER));
    assertFalse(preview.text.includes(CUSTOMER_NUMBER.slice(3)));
    replies.pop();
    assertEquals((await say({ action: "write_one", call_id: 1234567 })).res.status, 200);
    assertEquals((await say({ action: "write_one", call_id: 1234567 })).res.status, 200);
    await say({ action: "write_one", call_id: 7654321 });
    await say({ action: "sync_start", from: "days30" });
    await say({ action: "sync_stop" });
    await say({ ...SAVE, client_id: `${SENTINEL} space` });
    await say({ ...SAVE, client_secret: `${SENTINEL}\nline` });
    await say({ ...SAVE, code: `${SENTINEL} code` });
    await say({ action: SENTINEL });
    w.net.revoke = () => jsonReply({ error: SENTINEL }, 400);
    await say({ action: "disconnect" });
  });
  for (const text of replies) assertNoCustomer(text, "reply");
  assertNoCustomer(lines, "log");

  // ما حُفظ: صف الربط وصفوف المكالمات والنشاطات. الأسرار لا تذهب إلا إلى connect.
  assertNoCustomer(JSON.stringify(w.connects.map(({ client_id: _i, client_secret: _s, refresh_token: _r, ...rest }) => rest)), "stored stats");
  assertNoCustomer(JSON.stringify(w.records), "recorded checks");
  assertNoCustomer(JSON.stringify(w.audits), "audit rows");
  assertNoCustomer(JSON.stringify([...w.calls.values()]), "call rows");
  assertNoCustomer(JSON.stringify(w.marks), "marks");

  // Z8: كل ما خرج إلى Zoho: قراءة، أو POST على COQL وNotes، أو نقطة الرموز
  for (const seen of w.net.seen) {
    const url = new URL(seen.url);
    assert(url.protocol === "https:", seen.url);
    assertClean(url.search + url.pathname, "url");
    assertEquals(seen.redirect, "error", seen.url);
    if (url.hostname === "www.zohoapis.sa") {
      assert(seen.method === "GET" || ["/crm/v8/coql", "/crm/v8/Notes"].includes(url.pathname), `${seen.method} ${url.pathname}`);
    } else if (url.hostname === "accounts.zoho.sa") {
      assert(["/oauth/v2/token", "/oauth/v2/revoke/token"].includes(url.pathname), url.pathname);
      assertEquals(seen.method, "POST");
    } else {
      assertEquals(url.hostname, "api.av.maqsam.com");
      assertEquals(seen.method, "GET");
    }
  }
  assertEquals(w.net.notes.length, 1);
  // Z5: الرقم يذهب إلى Zoho وحده، ولا يذهب إلى مقسم
  for (const seen of w.net.maqsamRequests()) assertFalse(seen.url.includes(CUSTOMER_NUMBER.slice(3)));
  // الملاحظة: الملخص بلا تفريغ ولا اسم عميل
  assertClean(JSON.stringify(w.net.notes), "the note");
  assert(w.net.notes[0].text.includes(SUMMARY_MARK));
});

Deno.test("Z2 every failure path logs a fixed line: an error's text, stack and fields never reach the log", async () => {
  const boom = () => {
    const error = new Error(`boom ${CLIENT_ID} ${CLIENT_SECRET} ${SENTINEL}`) as Error & { cause?: unknown; details?: unknown };
    error.cause = SENTINEL;
    error.details = { secret: CLIENT_SECRET };
    return Promise.reject(error);
  };
  const broken: (keyof Deps)[] = [
    "readRow", "nameOf", "connect", "credentials", "maqsamCredentials", "recordCheck", "disconnect", "audit", "attemptBegin", "attemptEnd", "noteTokens", "refreshBegin", "tokenDenied",
    "syncStatus", "syncStart", "syncStop", "setReconnect", "knownCalls", "claim", "written", "release",
  ];
  for (const name of broken) {
    const w = new World({ connected: true, enabled: true });
    w.net.maqsamPages = [[maqsamCall()]];
    w.net.maqsamOne.set(1234567, maqsamCall());
    w.net.leads.set(CUSTOMER_NUMBER, [{ id: LEAD_ID, Modified_Time: "x" }]);
    (w.deps as unknown as Record<string, unknown>)[name] = boom;
    const { result, lines } = await capture(async () => {
      const out = [];
      for (const action of ACTIONS) {
        out.push(await call(w, action));
      }
      return out;
    });
    for (const reply of result) {
      assertClean(reply.text, `${name} reply`);
      assert([200, 400, 404, 409, 500, 502].includes(reply.res.status), `${name} ${reply.res.status}`);
    }
    assertNoCustomer(lines, `${name} log`);
  }
});

/* ===================== وصل القاعدة الحقيقية (بعميل مزيّف، مع مقارنة بملف الترحيل) ===================== */

const realDeps = (reply: Parameters<typeof fakeClient>[0] = () => ({})) => {
  const fake = fakeClient(reply);
  return { calls: fake.calls, deps: supabaseDeps(fake.client as unknown as SupabaseClient) };
};

function tableColumns(name: string): string[] {
  const sql = migrationSql();
  const body = sql.slice(sql.indexOf(`create table if not exists public.${name} (`));
  const block = body.slice(0, body.indexOf("\n);"));
  return [...block.matchAll(/^ {4}([a-z_]+) +[a-z]/gm)].map((match) => match[1]).filter((column) => column !== "check");
}

Deno.test("wiring: getUser reads the token, and a refusal is no user", async () => {
  const { deps } = realDeps();
  assertEquals(await deps.getUser("good"), { id: "u-1" });
  assertEquals(await deps.getUser("bad"), null);
});

Deno.test("wiring: the row and the name come from the expected places, and the row selects every column of 042 but id", async () => {
  const { calls, deps } = realDeps(({ table, select }) => {
    if (table === "zoho_link") return { data: { org_name: "Mulaem" } };
    if (select === "fullname, username") return { data: { fullname: "", username: "user.name" } };
    return { data: PROFILES["u-admin"] };
  });
  assertEquals((await deps.readRow())?.org_name, "Mulaem");
  assertEquals((await deps.getProfile("u-admin"))?.role, "admin");
  assertEquals(await deps.nameOf("u-admin"), "user.name");
  const read = calls.find((entry) => entry.table === "zoho_link")!;
  assertEquals(read.eqs, [["id", true]]);
  assert(read.maybeSingle);
  const columns = tableColumns("zoho_link");
  assertEquals(columns.length, 11);
  assertEquals(read.select!.split(",").map((part) => part.trim()).sort(), columns.filter((column) => column !== "id").sort());
  const profile = calls.find((entry) => entry.table === "profiles")!;
  assertEquals(profile.eqs, [["id", "u-admin"]]);
  assert(profile.select?.includes("is_blocked"));
  assert(profile.select?.includes("role"));
});

Deno.test("wiring: connect passes exactly the parameters declared in 042, and it is the only place the secrets go", async () => {
  const { calls, deps } = realDeps();
  const stats = { ...STATS_DEFAULT } as never;
  await deps.connect({ client_id: "i", client_secret: "s", refresh_token: "r", client_hint: null, org_name: "o", user_name: "u", user_profile: "p", by: "u-1", stats });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].rpc, "zoho_link_connect");
  assertEquals(Object.keys(calls[0].args ?? {}), declaredParameters("zoho_link_connect"));
  assertEquals(calls[0].args, { p_client_id: "i", p_client_secret: "s", p_refresh_token: "r", p_client_hint: null, p_org_name: "o", p_user_name: "u", p_user_profile: "p", p_by: "u-1", p_stats: stats });
});

Deno.test("wiring: credentials read the columns 042 returns; no row is null; Maqsam's come only through its own function", async () => {
  const sql = migrationSql();
  assert(sql.includes("returns table (client_id text, client_secret text, refresh_token text, connected_at timestamptz)"));
  const some = realDeps(() => ({ data: [{ client_id: "i", client_secret: "s", refresh_token: "r", connected_at: NOW_ISO, extra: "x" }] }));
  assertEquals(await some.deps.credentials(), { client_id: "i", client_secret: "s", refresh_token: "r", connected_at: NOW_ISO });
  assertEquals(some.calls[0].rpc, "zoho_link_credentials");
  assertEquals(await realDeps(() => ({ data: [] })).deps.credentials(), null);
  assertEquals(await realDeps(() => ({ data: null })).deps.credentials(), null);

  const maqsam = realDeps(() => ({ data: [{ host: "av.maqsam.com", key_id: "k", secret: "s", connected_at: NOW_ISO, extra: "x" }] }));
  assertEquals(await maqsam.deps.maqsamCredentials(), { host: "av.maqsam.com", key_id: "k", secret: "s", connected_at: NOW_ISO });
  assertEquals(maqsam.calls[0].rpc, "maqsam_link_credentials");
  assertEquals(await realDeps(() => ({ data: [] })).deps.maqsamCredentials(), null);
  const source = Deno.readTextFileSync(new URL("./store.ts", import.meta.url));
  assertFalse(/maqsam_access|vault/.test(source));
});

Deno.test("wiring: recordCheck updates exactly the columns 042 grants to the service role, on the link that was checked only", async () => {
  const { calls, deps } = realDeps(() => ({ data: [{ id: true }] }));
  const check = { ok: false, code: "timeout", at: NOW_ISO, stats: null } as const;
  assertEquals(await deps.recordCheck(check, "2026-10-01T09:00:00.123456+00:00"), true);
  assertEquals(calls[0].table, "zoho_link");
  assertEquals(calls[0].eqs, [["id", true], ["connected_at", "2026-10-01T09:00:00.123456+00:00"]]);
  assertEquals(calls[0].select, "id");
  assertEquals(await realDeps(() => ({ data: [] })).deps.recordCheck(check, NOW_ISO), false);
  assertEquals(calls[0].update, { last_check_at: NOW_ISO, last_check_ok: false, last_check_code: "timeout", last_check_stats: null });
  const granted = migrationSql().match(/grant update \(([^)]*)\) on table public\.zoho_link to service_role;/)?.[1] ?? "";
  assertEquals(Object.keys(calls[0].update ?? {}).sort(), granted.split(",").map((part) => part.trim()).sort());
});

Deno.test("wiring: every other call passes exactly what 042 declares", async () => {
  const table: [string, (deps: Deps) => Promise<unknown>, Record<string, unknown>][] = [
    ["zoho_link_disconnect", (d) => d.disconnect(), {}],
    ["zoho_link_attempt_begin", (d) => d.attemptBegin(), {}],
    ["zoho_link_attempt_end", (d) => d.attemptEnd(), {}],
    ["zoho_link_note_tokens", (d) => d.noteTokens({ minted: 1, revoke_failed: 2 }), { p_minted: 1, p_revoke_failed: 2 }],
    ["zoho_token_refresh_begin", (d) => d.refreshBegin(), {}],
    ["zoho_token_denied", (d) => d.tokenDenied(), {}],
    ["maqsam_sync_status", (d) => d.syncStatus(), {}],
    ["maqsam_sync_start", (d) => d.syncStart(NOW_ISO, "u-1"), { p_start_from: NOW_ISO, p_by: "u-1" }],
    ["maqsam_sync_stop", (d) => d.syncStop(), {}],
    ["maqsam_sync_set_reconnect", (d) => d.setReconnect(NOW_ISO, true), { p_connected_at: NOW_ISO, p_needs: true }],
    ["maqsam_sync_written", (d) => d.written({ call_id: 1, note_id: "n", module: "Leads", record_id: "r" }), { p_call_id: 1, p_note_id: "n", p_module: "Leads", p_record_id: "r", p_ambiguous: false }],
    ["maqsam_sync_release", (d) => d.release({ call_id: 1, count: false }), { p_call_id: 1, p_count: false }],
    ["maqsam_sync_mark", (d) => d.mark({ call_id: 1, status: "waiting", next_try_at: null }), { p_call_id: 1, p_status: "waiting", p_next_try_at: null }],
    ["maqsam_sync_run_begin", (d) => d.runBegin(240), { p_lease_seconds: 240 }],
    ["maqsam_sync_run_end", (d) => d.runEnd("ok", null), { p_code: "ok", p_cursor: null }],
  ];
  for (const [name, run, args] of table) {
    const { calls, deps } = realDeps();
    await run(deps);
    assertEquals(calls[0].rpc, name);
    assertEquals(calls[0].args ?? {}, args, name);
    const declared = declaredParameters(name);
    for (const key of Object.keys(args)) assert(declared.includes(key), `${name} does not declare ${key}`);
  }
  // الدوال التي لها كل ما يُرسل بترتيبه
  assertEquals(declaredParameters("maqsam_sync_written"), ["p_call_id", "p_note_id", "p_module", "p_record_id", "p_ambiguous"]);
  assertEquals(declaredParameters("maqsam_sync_claim").slice(0, 5), ["p_call_id", "p_module", "p_record_id", "p_require_enabled", "p_takeover"]);
  const claim = realDeps(() => ({ data: { outcome: "claimed" } }));
  assertEquals(await claim.deps.claim({ call_id: 1, module: "Leads", record_id: "r", require_enabled: true, takeover: false }), { outcome: "claimed" });
  assertEquals(claim.calls[0].rpc, "maqsam_sync_claim");
  assertEquals(claim.calls[0].args, { p_call_id: 1, p_module: "Leads", p_record_id: "r", p_require_enabled: true, p_takeover: false });
});

Deno.test("wiring: replies are read as 042 gives them", async () => {
  assertEquals(await realDeps(() => ({ data: { allowed: false, reason: "busy", wait_seconds: 9 } })).deps.attemptBegin(), { allowed: false, reason: "busy", wait_seconds: 9 });
  assertEquals(await realDeps(() => ({ data: null })).deps.attemptBegin(), { allowed: false, reason: "unknown", wait_seconds: 0 });
  assertEquals(await realDeps(() => ({ data: { allowed: true, wait_seconds: 0 } })).deps.refreshBegin(), { allowed: true, wait_seconds: 0 });
  assertEquals(await realDeps(() => ({ data: null })).deps.refreshBegin(), { allowed: false, wait_seconds: 0 });
  assertEquals(await realDeps(() => ({ data: "started" })).deps.syncStart(NOW_ISO, "u"), "started");
  assertEquals(await realDeps(() => ({ data: true })).deps.syncStop(), true);
  assertEquals(await realDeps(() => ({ data: true })).deps.setReconnect(NOW_ISO, true), true);
  assertEquals(await realDeps(() => ({ data: false })).deps.setReconnect(NOW_ISO, true), false);
  assertEquals(await realDeps(() => ({ data: "failed" })).deps.release({ call_id: 1, count: true }), "failed");
  assertEquals(await realDeps(() => ({ data: null })).deps.release({ call_id: 1, count: true }), null);
  assertEquals(await realDeps(() => ({ data: [] })).deps.syncStatus(), null);
  assertEquals((await realDeps(() => ({ data: [{ enabled: true }] })).deps.syncStatus())?.enabled, true);
  assertEquals((await realDeps(() => ({ data: { started: true, reason: "ok", start_from: NOW_ISO, scan_cursor: null } })).deps.runBegin(1)), { started: true, reason: "ok", start_from: NOW_ISO, scan_cursor: null });
  assertEquals((await realDeps(() => ({ data: null })).deps.runBegin(1)).started, false);
});

Deno.test("wiring: the sync rows are read by id in small batches, and open calls by their status", async () => {
  const ids = Array.from({ length: 450 }, (_, i) => i + 1);
  const { calls, deps } = realDeps(({ ins }) => ({ data: (ins?.[0][1] as number[]).slice(0, 1).map((id) => ({ call_id: String(id), status: "written" })) }));
  const known = await deps.knownCalls(ids);
  assertEquals(calls.length, 3);
  assertEquals(calls.map((entry) => entry.table), ["maqsam_sync_calls", "maqsam_sync_calls", "maqsam_sync_calls"]);
  assertEquals(calls.map((entry) => (entry.ins?.[0][1] as number[]).length), [200, 200, 50]);
  assertEquals([...known.keys()], [1, 201, 401]);
  assertEquals(known.get(1)?.call_id, 1);

  const open = realDeps(() => ({ data: [{ call_id: "5", status: "waiting" }] }));
  assertEquals((await open.deps.openCalls(500))[0].call_id, 5);
  assertEquals(open.calls[0].ins, [["status", ["waiting", "claimed"]]]);
  assertEquals(open.calls[0].limit, 500);

  const columns = tableColumns("maqsam_sync_calls");
  for (const column of calls[0].select!.split(",").map((part) => part.trim())) assert(columns.includes(column), column);
});

Deno.test("wiring: audit fits public.activities as it is", async () => {
  const { calls, deps } = realDeps();
  await deps.audit({ action: "ربط Zoho", user_id: 7, user_name: "اسم" });
  assertEquals(calls[0].table, "activities");
  assertEquals(calls[0].insert, { action: "ربط Zoho", user_id: 7, user_name: "اسم" });
});

Deno.test("Z2 wiring: a database error loses its text on the way out, and the handler stays silent about it", async () => {
  const message = `value ${SENTINEL} ${CLIENT_ID} ${CLIENT_SECRET} violates something`;
  const { deps } = realDeps(() => ({ error: { code: "23514", message, details: SENTINEL, hint: SENTINEL } }));
  const operations: [string, () => Promise<unknown>][] = [
    ["profile", () => deps.getProfile("u")],
    ["read", () => deps.readRow()],
    ["name", () => deps.nameOf("u")],
    ["connect", () => deps.connect({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: "r", client_hint: null, org_name: null, user_name: null, user_profile: null, by: "u", stats: STATS_DEFAULT as never })],
    ["credentials", () => deps.credentials()],
    ["maqsam", () => deps.maqsamCredentials()],
    ["record", () => deps.recordCheck({ ok: true, code: "ok", at: NOW_ISO, stats: null }, NOW_ISO)],
    ["disconnect", () => deps.disconnect()],
    ["audit", () => deps.audit({ action: "x", user_id: null, user_name: null })],
    ["attempt", () => deps.attemptBegin()],
    ["attempt end", () => deps.attemptEnd()],
    ["note tokens", () => deps.noteTokens({ minted: 1, revoke_failed: 0 })],
    ["refresh", () => deps.refreshBegin()],
    ["denied", () => deps.tokenDenied()],
    ["status", () => deps.syncStatus()],
    ["start", () => deps.syncStart(NOW_ISO, "u")],
    ["stop", () => deps.syncStop()],
    ["reconnect", () => deps.setReconnect(NOW_ISO, true)],
    ["known", () => deps.knownCalls([1])],
    ["open", () => deps.openCalls(1)],
    ["claim", () => deps.claim({ call_id: 1, module: "Leads", record_id: "r", require_enabled: false, takeover: false })],
    ["written", () => deps.written({ call_id: 1, note_id: "n", module: "Leads", record_id: "r" })],
    ["release", () => deps.release({ call_id: 1, count: true })],
    ["mark", () => deps.mark({ call_id: 1, status: "waiting", next_try_at: null })],
    ["run begin", () => deps.runBegin(1)],
    ["run end", () => deps.runEnd("ok", null)],
  ];
  for (const [label, run] of operations) {
    const error = await run().then(() => null, (e) => e) as Error & { code?: string } | null;
    assert(error, label);
    assertEquals(error.code, "23514", label);
    assertClean(`${error.message} ${error.stack} ${Deno.inspect(error, { depth: 10, showHidden: true })}`, label);
  }

  const w = new World();
  w.deps.connect = realDeps(({ rpc }) => rpc === "zoho_link_connect" ? { error: { code: "P0001", message } } : {}).deps.connect;
  const { result: reply, lines } = await capture(() => call(w, SAVE));
  assertError(reply, 500, "server_error");
  assertClean(reply.text, "reply");
  assertClean(lines, "log");
  assert(lines.includes("P0001"), "the log keeps the database code");
  assertEquals(w.net.revokeRequests().length, 1);
});

Deno.test("every action before 042 is applied names the missing update instead of the general error", async () => {
  const told = "الربط لم يُفعَّل بعد في قاعدة البيانات (التحديث 042). وافق على تشغيل migrate في GitHub.";
  for (const code of ["PGRST205", "PGRST202", "42P01", "42883"]) {
    for (const action of ACTIONS) {
      const w = new World({ connected: true });
      const real = realDeps(() => ({ error: { code, message: SENTINEL } })).deps;
      Object.assign(w.deps, { readRow: real.readRow, syncStatus: real.syncStatus, attemptBegin: real.attemptBegin, connect: real.connect, credentials: real.credentials, disconnect: real.disconnect, syncStop: real.syncStop, syncStart: real.syncStart, knownCalls: real.knownCalls });
      const { result: reply, lines } = await capture(() => call(w, action));
      assertEquals(reply.res.status, 500, `${code} ${action.action}`);
      assertEquals(reply.json, { status: "error", code: "server_error", message: told }, `${code} ${action.action}`);
      assertClean(lines, "log");
      assert(lines.includes(code), "the log keeps the database code");
    }
  }
  const w = new World({ connected: true });
  w.deps.readRow = realDeps(() => ({ error: { code: "23514", message: SENTINEL } })).deps.readRow;
  const { result: other } = await capture(() => call(w, { action: "status" }));
  assertError(other, 500, "server_error");
  assertFalse(other.json.message.includes("042"));
});

Deno.test("wiring: an odd error code is not copied into the log", async () => {
  const w = new World();
  w.deps.connect = realDeps(() => ({ error: { code: SENTINEL, message: SENTINEL } })).deps.connect;
  const { result: reply, lines } = await capture(() => call(w, SAVE));
  assertError(reply, 500, "server_error");
  assertClean(lines, "log");
});
