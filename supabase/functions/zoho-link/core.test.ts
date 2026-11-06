// اختبارات منطق zoho-link بلا شبكة: القيم الملصوقة، وأشكال ردود Zoho كلها، والجلسة، والفحص، بـ fetch وساعة مزيّفين.
// كل الأسماء والأرقام مصطنعة (المستودع عام). التشغيل: deno test --allow-read --allow-env supabase/functions/zoho-link/
import { assert, assertEquals, assertFalse, assertRejects } from "jsr:@std/assert@1";
import {
  apiDomainSignal,
  Budget,
  CALL_TIMEOUT_MS,
  CHECK_CODES,
  classifyApi,
  classifyToken,
  cleanClientId,
  cleanClientSecret,
  cleanCode,
  cleanName,
  coql,
  emptyLink,
  emptySync,
  exchangeCode,
  keyHint,
  linkFromRow,
  type LinkRow,
  type Net,
  ownerCounts,
  pickStats,
  refreshAccess,
  revokeToken,
  riyadhIso,
  syncFromRow,
  TOKEN_MAX_BYTES,
  verifyConnection,
  ZohoSession,
} from "./core.ts";
import { assertClean, CLIENT_ID, CLIENT_SECRET, CODE, FakeNet, jsonReply, NEW_ACCESS, NOW, ORG_OK, RENEWED_ACCESS, type Seen, SENTINEL, tokenOk, USER_OK } from "./testkit.ts";

const CLIENT = { client_id: CLIENT_ID, client_secret: CLIENT_SECRET };
const REFRESH = "1000.SENTINEL-STORED-REFRESH.abcdef";
const RLM = String.fromCharCode(0x200f);
const LRM = String.fromCharCode(0x200e);
const ZWSP = String.fromCharCode(0x200b);
const BOM = String.fromCharCode(0xfeff);

const netOf = (fake: FakeNet, extra: Partial<Net> = {}): Net => ({ fetch: fake.fetch, callTimeoutMs: 50, revokeTimeoutMs: 50, ...extra });
const budget = (ms = 60_000, now: () => number = () => NOW) => new Budget(now, ms);

/* ===================== القيم الملصوقة (Z2) ===================== */

Deno.test("paste: client id, client secret and code are trimmed of what a paste brings, inside they stay refused", () => {
  const cases: [(raw: unknown) => string | null, string, string | null][] = [
    [cleanClientId, "1000.ABC", "1000.ABC"],
    [cleanClientId, `  1000.ABC\r\n`, "1000.ABC"],
    [cleanClientId, `${RLM}1000.ABC${LRM}`, "1000.ABC"],
    [cleanClientId, `${BOM}1000.ABC`, "1000.ABC"],
    [cleanClientId, "1000 ABC", null],
    [cleanClientId, "1000:ABC", null],
    [cleanClientId, `1000${ZWSP}ABC`, null],
    [cleanClientId, "مفتاح", null],
    [cleanClientId, "x".repeat(257), null],
    [cleanClientId, "", null],
    [cleanClientId, "   ", null],
    [cleanClientSecret, "abc:def/+=", "abc:def/+="],
    [cleanClientSecret, `\tabc  `, "abc"],
    [cleanClientSecret, "a b", null],
    [cleanClientSecret, "a\nb", null],
    [cleanClientSecret, "سر", null],
    [cleanClientSecret, "x".repeat(513), null],
    [cleanCode, "1000.aaa.bbb", "1000.aaa.bbb"],
    [cleanCode, ` 1000.aaa.bbb\n`, "1000.aaa.bbb"],
    [cleanCode, "1000 aaa", null],
    [cleanCode, "x".repeat(1025), null],
    [cleanCode, "", null],
  ];
  for (const [clean, input, expected] of cases) assertEquals(clean(input), expected, JSON.stringify(input));
  for (const clean of [cleanClientId, cleanClientSecret, cleanCode]) {
    for (const bad of [null, undefined, 5, true, {}, ["x"]]) assertEquals(clean(bad), null, JSON.stringify(bad));
  }
});

Deno.test("Z2 the hint is the last 4 of the client id, only for an id of 8 or more", () => {
  assertEquals(keyHint(CLIENT_ID), "7f3a");
  assertEquals(keyHint("1234567"), null);
});

/* ===================== أشكال رد نقطة الرموز ===================== */

const HTML_PAGE = "<!doctype html><html><title>Zoho Accounts</title>An error occurred while processing your request. SENTINEL</html>";
const ROADBLOCK = "<html><body>Access Denied: Maximum request limit reached for your account. Please try again after some time. SENTINEL</body></html>";

Deno.test("classifyToken: every documented shape, whatever the status says", () => {
  const table: [string, number, string | null, string][] = [
    ["invalid_client 200", 200, '{"error":"invalid_client"}', "invalid_client"],
    ["invalid_client_secret 200", 200, '{"error":"invalid_client_secret"}', "invalid_client"],
    ["invalid_client 400", 400, '{"error":"invalid_client"}', "invalid_client"],
    ["invalid_code 200", 200, '{"error":"invalid_code"}', "invalid_code"],
    ["invalid_code 400", 400, '{"error":"invalid_code"}', "invalid_code"],
    ["Access Denied with capital and space", 200, '{"error_description":"You have made too many requests continuously.","error":"Access Denied","status":"failure"}', "throttled"],
    ["access_denied", 200, '{"error":"access_denied"}', "throttled"],
    ["ACCESS DENIED", 400, '{"error":"ACCESS DENIED"}', "throttled"],
    ["roadblock page at 200", 200, ROADBLOCK, "throttled"],
    ["roadblock page at 403", 403, ROADBLOCK, "throttled"],
    ["429", 429, "", "throttled"],
    ["html 400", 400, HTML_PAGE, "bad_response"],
    ["html 500", 500, HTML_PAGE, "server_error"],
    ["html 200", 200, HTML_PAGE, "bad_response"],
    ["empty 200", 200, "", "bad_response"],
    ["not an object", 200, "[1,2]", "bad_response"],
    ["json null", 200, "null", "bad_response"],
    ["another error", 200, '{"error":"invalid_redirect_uri"}', "bad_response"],
    ["non-string error", 200, '{"error":5}', "bad_response"],
    ["too big or not utf-8", 200, null, "bad_response"],
    ["503 json with another error", 503, '{"error":"busy"}', "server_error"],
    ["a token at a status that is not 200", 201, '{"access_token":"x"}', "bad_response"],
    ["an empty token", 200, '{"access_token":""}', "bad_response"],
    ["a token with a space", 200, '{"access_token":"a b"}', "bad_response"],
    ["a token that is not a string", 200, '{"access_token":5}', "bad_response"],
  ];
  for (const [label, status, text, code] of table) assertEquals(classifyToken(status, text), { ok: false, code } as never, label);
});

Deno.test("classifyToken: success, with and without a refresh token", () => {
  assertEquals(classifyToken(200, JSON.stringify({ access_token: "a", refresh_token: "r", api_domain: "https://www.zohoapis.sa", token_type: "Bearer", expires_in: 3600 })), {
    ok: true,
    access_token: "a",
    refresh_token: "r",
    api_domain: "https://www.zohoapis.sa",
    expires_in: 3600,
  });
  assertEquals(classifyToken(200, JSON.stringify({ access_token: "a" })), { ok: true, access_token: "a", refresh_token: null, api_domain: null, expires_in: null });
  assertEquals(classifyToken(200, JSON.stringify({ access_token: "a", refresh_token: "" })), { ok: true, access_token: "a", refresh_token: null, api_domain: null, expires_in: null });
});

Deno.test("Z3 api_domain is only a signal", () => {
  const table: [string | null, string][] = [
    ["https://www.zohoapis.sa", "ok"],
    ["https://api.zoho.sa", "ok"],
    ["https://something-new.zohoapis.sa", "ok"],
    ["not a url", "ok"],
    [null, "ok"],
    ["https://sandbox.zohoapis.sa", "wrong_environment"],
    ["https://developer.zohoapis.sa", "wrong_environment"],
    ["https://www.zohoapis.com", "wrong_environment"],
    ["https://www.zohoapis.eu", "wrong_environment"],
    ["https://api.zoho.com", "wrong_environment"],
    ["https://evil.example", "wrong_environment"],
    ["https://www.zohoapis.sa.evil.example", "wrong_environment"],
  ];
  for (const [value, signal] of table) assertEquals(apiDomainSignal(value), signal, String(value));
});

/* ===================== الطلب إلى نقطة الرموز ===================== */

function assertSafeRequest(seen: Seen, label: string) {
  assert(seen.url.startsWith("https://"), label);
  assertEquals(seen.redirect, "error", label);
  assert(seen.hasSignal, label);
}

Deno.test("Z2 Z4 exchange: one POST to the hardcoded host, secrets in the form body and never in the URL", async () => {
  const fake = new FakeNet();
  const result = await exchangeCode(CLIENT, CODE, netOf(fake), budget());
  assert(result.ok);
  assertEquals(fake.seen.length, 1);
  const seen = fake.seen[0];
  assertSafeRequest(seen, "exchange");
  assertEquals(seen.url, "https://accounts.zoho.sa/oauth/v2/token");
  assertEquals(seen.method, "POST");
  assertEquals(seen.headers["Content-Type"], "application/x-www-form-urlencoded");
  const form = new URLSearchParams(seen.body);
  assertEquals([...form.keys()].sort(), ["client_id", "client_secret", "code", "grant_type"]);
  assertEquals(form.get("client_id"), CLIENT_ID);
  assertEquals(form.get("client_secret"), CLIENT_SECRET);
  assertEquals(form.get("code"), CODE);
  assertEquals(form.get("grant_type"), "authorization_code");
  assertClean(seen.url, "url");
});

Deno.test("Z4 exchange: timeouts and lost connections have their own code, with one try only", async () => {
  const cases: [string, () => Response | Promise<Response>, string][] = [
    ["hang", () => new Promise<Response>(() => {}), "timeout"],
    ["abort", () => Promise.reject(new DOMException(SENTINEL, "AbortError")), "timeout"],
    ["dns", () => Promise.reject(new TypeError(`dns ${SENTINEL}`)), "network"],
    ["redirect refused", () => Promise.reject(new TypeError(`redirect ${SENTINEL}`)), "network"],
  ];
  for (const [label, respond, code] of cases) {
    const fake = new FakeNet();
    fake.token = respond;
    assertEquals(await exchangeCode(CLIENT, CODE, netOf(fake), budget()), { ok: false, code } as never, label);
    assertEquals(fake.seen.length, 1, label);
  }
});

Deno.test("Z4 a budget already spent sends nothing; a call never outlives what is left", async () => {
  const fake = new FakeNet();
  assertEquals(await exchangeCode(CLIENT, CODE, netOf(fake), budget(0)), { ok: false, code: "timeout" });
  assertEquals(fake.seen.length, 0);

  // ساعة تتحرك: الميزانية تنقص مع الوقت
  let clock = NOW;
  const running = new Budget(() => clock, 1000);
  assertEquals(running.left(), 1000);
  clock += 400;
  assertEquals(running.left(), 600);
  clock += 700;
  assert(running.left() < 0);

  // مهلة الميزانية الباقية أقصر من مهلة النداء
  fake.token = () => new Promise<Response>(() => {});
  const started = Date.now();
  await exchangeCode(CLIENT, CODE, netOf(fake, { callTimeoutMs: CALL_TIMEOUT_MS }), budget(30));
  assert(Date.now() - started < 2000);
});

Deno.test("Z4 size caps: declared or actual, the token body is refused without being trusted", async () => {
  const declared = new FakeNet();
  let pulled = 0;
  declared.token = () =>
    new Response(new ReadableStream<Uint8Array>({ pull(c) {
      pulled++;
      c.close();
    } }, { highWaterMark: 0 }), { status: 200, headers: { "content-length": String(TOKEN_MAX_BYTES + 1) } });
  assertEquals(await exchangeCode(CLIENT, CODE, netOf(declared), budget()), { ok: false, code: "bad_response" });
  assertEquals(pulled, 0);

  const grown = new FakeNet();
  let cancelled = false;
  grown.token = () =>
    new Response(new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(new Uint8Array(64 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    }, { highWaterMark: 0 }), { status: 200 });
  assertEquals(await exchangeCode(CLIENT, CODE, netOf(grown), budget()), { ok: false, code: "bad_response" });
  assert(cancelled);

  const notUtf8 = new FakeNet();
  notUtf8.token = () => new Response(new Uint8Array([0xff, 0xfe]), { status: 200 });
  assertEquals(await exchangeCode(CLIENT, CODE, netOf(notUtf8), budget()), { ok: false, code: "bad_response" });
});

Deno.test("Z2 first-run log: a shape with allowlisted values, never a body or a token", async () => {
  const shapes: unknown[] = [];
  const onShape = (shape: unknown) => shapes.push(shape);
  const fake = new FakeNet();
  fake.token = () => jsonReply({ access_token: NEW_ACCESS, refresh_token: "1000.SENTINEL-R", api_domain: "https://www.zohoapis.sa", expires_in: 3600, scope: "x" }, 200, { "content-type": "application/json;charset=UTF-8" });
  await exchangeCode(CLIENT, CODE, netOf(fake, { onShape }), budget());
  assertEquals(shapes[0], {
    stage: "exchange",
    status: 200,
    content_type: "application/json",
    is_json: true,
    code: null,
    has_access_token: true,
    has_refresh_token: true,
    has_scope: true,
    api_domain: "https://www.zohoapis.sa",
    expires_in: 3600,
  });

  const odd = new FakeNet();
  odd.token = () => jsonReply({ error: `odd ${SENTINEL}`, api_domain: `https://${SENTINEL}.example` });
  shapes.length = 0;
  await exchangeCode(CLIENT, CODE, netOf(odd, { onShape }), budget());
  assertEquals((shapes[0] as { code: string }).code, "other");
  assertEquals((shapes[0] as { api_domain: unknown }).api_domain, null);
  assertClean(JSON.stringify(shapes), "shape");

  const errorCode = new FakeNet();
  errorCode.token = () => jsonReply({ error: "Access Denied" });
  shapes.length = 0;
  await exchangeCode(CLIENT, CODE, netOf(errorCode, { onShape }), budget());
  assertEquals((shapes[0] as { code: string }).code, "access_denied");
});

Deno.test("Z2 first-run log: an API reply gives its stage, status and an allowlisted code, never a body", async () => {
  const shapes: unknown[] = [];
  const fake = new FakeNet();
  const s = new ZohoSession(CLIENT, REFRESH, {
    net: netOf(fake, { onShape: (shape) => shapes.push(shape) }),
    refreshBegin: () => Promise.resolve({ allowed: true, wait_seconds: 0 }),
    tokenDenied: () => Promise.resolve(),
  }, budget(), NEW_ACCESS);
  fake.org = () => jsonReply({ code: `ODD_${SENTINEL}`, message: SENTINEL, details: { x: SENTINEL } }, 400);
  await s.request("GET", "/crm/v8/org");
  assertEquals(shapes[0], { stage: "org", status: 400, content_type: "application/json", is_json: true, code: "other" });
  fake.org = () => jsonReply({ code: "OAUTH_SCOPE_MISMATCH", message: SENTINEL }, 401);
  await s.request("GET", "/crm/v8/org");
  assertEquals((shapes[1] as { code: string }).code, "OAUTH_SCOPE_MISMATCH");
  fake.org = () => new Response(`<html>${SENTINEL}</html>`, { status: 502, headers: { "content-type": `text/${SENTINEL} x` } });
  await s.request("GET", "/crm/v8/org");
  assertEquals(shapes[2], { stage: "org", status: 502, content_type: null, is_json: false, code: null });
  fake.org = () => Promise.reject(new TypeError(SENTINEL));
  await s.request("GET", "/crm/v8/org");
  assertEquals(shapes[3], { stage: "org", status: null, content_type: null, is_json: false, code: "network" });
  await s.request("GET", "/crm/v8/users?type=CurrentUser");
  assertEquals((shapes[4] as { stage: string }).stage, "users");
  assertClean(JSON.stringify(shapes), "shape");
});

Deno.test("refresh: the documented form, in the body", async () => {
  const fake = new FakeNet();
  fake.token = () => jsonReply({ access_token: RENEWED_ACCESS, expires_in: 3600 });
  const result = await refreshAccess(CLIENT, REFRESH, netOf(fake), budget());
  assert(result.ok);
  assertEquals(result.access_token, RENEWED_ACCESS);
  const form = new URLSearchParams(fake.seen[0].body);
  assertEquals(form.get("grant_type"), "refresh_token");
  assertEquals(form.get("refresh_token"), REFRESH);
  assertClean(fake.seen[0].url, "url");
});

/* ===================== الإبطال ===================== */

Deno.test("revoke: only HTTP 200 counts, through the documented route, with Basic and a form body, and it never throws", async () => {
  const table: [string, () => Response | Promise<Response>, boolean][] = [
    ["200 no body", () => new Response("", { status: 200 }), true],
    ["200 json", () => jsonReply({ status: "success" }), true],
    ["400 invalid_request", () => jsonReply({ error: "invalid_request", error_description: "The request is invalid." }, 400), false],
    ["400 html", () => new Response("<html></html>", { status: 400 }), false],
    ["500", () => new Response("<html></html>", { status: 500 }), false],
    ["network", () => Promise.reject(new TypeError(SENTINEL)), false],
    ["hang", () => new Promise<Response>(() => {}), false],
  ];
  for (const [label, respond, expected] of table) {
    const fake = new FakeNet();
    fake.revoke = respond;
    assertEquals(await revokeToken(CLIENT, REFRESH, "refresh_token", netOf(fake)), expected, label);
    assertEquals(fake.seen.length, 1, label);
    const seen = fake.seen[0];
    assertSafeRequest(seen, label);
    assertEquals(seen.url, "https://accounts.zoho.sa/oauth/v2/revoke/token", label);
    assertEquals(seen.method, "POST", label);
    assertEquals(seen.headers.Authorization, `Basic ${btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)}`, label);
    const form = new URLSearchParams(seen.body);
    assertEquals(form.get("token"), REFRESH, label);
    assertEquals(form.get("token_type"), "refresh_token", label);
    assertClean(seen.url, label);
  }
});

Deno.test("revoke: a stored value that cannot be encoded is a failed revoke, never a throw", async () => {
  const fake = new FakeNet();
  assertEquals(await revokeToken({ client_id: "مفتاح", client_secret: "x" }, REFRESH, "refresh_token", netOf(fake)), false);
  assertEquals(fake.seen.length, 0);
});

/* ===================== أشكال رد الواجهة ===================== */

Deno.test("classifyApi: every documented shape, branching on the code and not on the status", () => {
  const err = (code: string, extra: Record<string, unknown> = {}) => JSON.stringify({ code, details: {}, message: "x", status: "error", ...extra });
  const table: [string, number, string | null, string][] = [
    ["expired", 401, err("INVALID_TOKEN"), "reauth"],
    ["other spelling", 401, err("INVALID_OAUTHTOKEN"), "reauth"],
    ["auth failure", 401, err("AUTHENTICATION_FAILURE"), "reauth"],
    ["kaizen spelling", 401, err("AUTHENTICATION_FAILED"), "reauth"],
    ["scope", 401, err("OAUTH_SCOPE_MISMATCH"), "scope_mismatch"],
    ["scope with code and message only", 401, '{"code":"OAUTH_SCOPE_MISMATCH","message":"x"}', "scope_mismatch"],
    ["unknown 401", 401, err("SOMETHING_NEW"), "token_revoked"],
    ["401 html", 401, "<html></html>", "token_revoked"],
    ["no permission", 403, err("NO_PERMISSION", { details: { permissions: ["Crm_Implied_Api_Access"] } }), "no_permission"],
    ["inactive", 403, err("INACTIVE_USER"), "inactive_user"],
    ["not allowed", 403, err("NOT_ALLOWED"), "no_permission"],
    ["403 html", 403, "<html></html>", "no_permission"],
    ["authorization on org", 400, err("AUTHORIZATION_FAILED"), "no_permission"],
    ["bad query", 400, err("INVALID_QUERY", { details: { column_name: "x" } }), "refused"],
    ["syntax", 400, err("SYNTAX_ERROR"), "refused"],
    ["invalid data", 400, err("INVALID_DATA"), "refused"],
    ["note in data", 400, JSON.stringify({ data: [{ code: "INVALID_DATA", details: {}, message: "x", status: "error" }] }), "refused"],
    ["authorization in data", 400, JSON.stringify({ data: [{ code: "AUTHORIZATION_FAILED", status: "error" }] }), "no_permission"],
    ["400 html", 400, "<html></html>", "bad_response"],
    ["404", 404, err("INVALID_URL_PATTERN"), "not_found"],
    ["429", 429, err("TOO_MANY_REQUESTS"), "rate_limited"],
    ["429 other code", 429, err("RATE_LIMIT_EXCEEDED"), "rate_limited"],
    ["429 html", 429, "<html></html>", "rate_limited"],
    ["500", 500, err("INTERNAL_ERROR"), "server_error"],
    ["502 html", 502, "<html>gateway</html>", "server_error"],
    ["503 html", 503, "<html></html>", "server_error"],
    ["200 html", 200, "<html></html>", "bad_response"],
    ["200 empty", 200, "", "bad_response"],
    ["200 array", 200, "[]", "bad_response"],
    ["too big", 200, null, "bad_response"],
    ["3xx", 302, "", "bad_response"],
  ];
  for (const [label, status, text, code] of table) assertEquals(classifyApi(status, text), { ok: false, code } as never, label);
  assertEquals(classifyApi(200, '{"org":[]}'), { ok: true, status: 200, body: { org: [] } });
  assertEquals(classifyApi(201, '{"data":[]}'), { ok: true, status: 201, body: { data: [] } });
  assertEquals(classifyApi(204, ""), { ok: true, status: 204, body: null });
  assertEquals(classifyApi(204, '{"not":"read"}'), { ok: true, status: 204, body: null });
});

/* ===================== الجلسة ===================== */

function session(fake: FakeNet, gate = { allowed: true, wait_seconds: 0 }, access: string | null = null) {
  const counts = { refreshes: 0, denied: 0 };
  const s = new ZohoSession(CLIENT, REFRESH, {
    net: netOf(fake),
    refreshBegin: () => {
      counts.refreshes++;
      return Promise.resolve(gate);
    },
    tokenDenied: () => {
      counts.denied++;
      return Promise.resolve();
    },
  }, budget(), access);
  return { s, counts };
}

Deno.test("Z3 session: the token goes only to the hardcoded API host, whatever api_domain says", async () => {
  const fake = new FakeNet();
  fake.token = () => tokenOk({ api_domain: "https://api.zoho.sa", access_token: RENEWED_ACCESS });
  const { s } = session(fake);
  assert((await s.request("GET", "/crm/v8/org")).ok);
  const hosts = fake.seen.map((seen) => new URL(seen.url).hostname);
  assertEquals(hosts, ["accounts.zoho.sa", "www.zohoapis.sa"]);
  assertEquals(fake.seen[1].headers.Authorization, `Zoho-oauthtoken ${RENEWED_ACCESS}`);
  assertSafeRequest(fake.seen[1], "api");
});

Deno.test("Z8 session: no path outside the API, and POST only to COQL and to Notes", async () => {
  const fake = new FakeNet();
  const { s } = session(fake, undefined, NEW_ACCESS);
  for (const path of ["/crm/v8/Leads", "/crm/v8/Leads/1/Notes", "/crm/v8/Notes/1", "/crm/v8/Leads/actions/convert", "/crm/v8/users", "/crm/v8/coql/x", "/oauth/v2/token", "https://evil.example/crm/v8/coql"]) {
    await assertRejects(() => s.request("POST", path), Error, "not allowed");
  }
  await assertRejects(() => s.request("GET", "/crm/v9/org"), Error, "not allowed");
  await assertRejects(() => s.request("GET", "https://evil.example/crm/v8/org"), Error, "not allowed");
  assertEquals(fake.seen.length, 0);
  // أي فعل غير GET وPOST لا يمر من النوع نفسه، وهذا فحص في الكود الجاري أيضاً
  assert(!Deno.readTextFileSync(new URL("./core.ts", import.meta.url)).match(/method:\s*"(PUT|PATCH|DELETE)"/));
  assert(!Deno.readTextFileSync(new URL("./notes.ts", import.meta.url)).match(/"(PUT|PATCH|DELETE)"/));
});

Deno.test("session: no token is asked for before the first real need", () => {
  const fake = new FakeNet();
  const { counts } = session(fake);
  assertEquals(fake.seen.length, 0);
  assertEquals(counts.refreshes, 0);
});

Deno.test("session: INVALID_TOKEN, INVALID_OAUTHTOKEN and AUTHENTICATION_FAILURE refresh once and repeat the call", async () => {
  for (const code of ["INVALID_TOKEN", "INVALID_OAUTHTOKEN", "AUTHENTICATION_FAILURE"]) {
    const fake = new FakeNet();
    let calls = 0;
    fake.org = () => ++calls === 1 ? jsonReply({ code, details: {}, message: "x", status: "error" }, 401) : jsonReply(ORG_OK);
    fake.token = () => jsonReply({ access_token: RENEWED_ACCESS, expires_in: 3600 });
    const { s, counts } = session(fake, undefined, NEW_ACCESS);
    const reply = await s.request("GET", "/crm/v8/org");
    assert(reply.ok, code);
    assertEquals(calls, 2, code);
    assertEquals(counts.refreshes, 1, code);
    assertEquals(fake.tokenRequests("refresh_token").length, 1, code);
    assertEquals(fake.apiRequests().map((seen) => seen.headers.Authorization), [`Zoho-oauthtoken ${NEW_ACCESS}`, `Zoho-oauthtoken ${RENEWED_ACCESS}`], code);
  }
});

Deno.test("session: refresh only once; a token still refused is token_revoked", async () => {
  const fake = new FakeNet();
  fake.org = () => jsonReply({ code: "INVALID_TOKEN" }, 401);
  fake.token = () => jsonReply({ access_token: RENEWED_ACCESS });
  const { s, counts } = session(fake, undefined, NEW_ACCESS);
  assertEquals(await s.request("GET", "/crm/v8/org"), { ok: false, code: "token_revoked" });
  assertEquals(counts.refreshes, 1);
  assertEquals(fake.apiRequests().length, 2);
  assertEquals(await s.request("GET", "/crm/v8/org"), { ok: false, code: "token_revoked" });
  assertEquals(counts.refreshes, 1);
});

Deno.test("session: OAUTH_SCOPE_MISMATCH never refreshes", async () => {
  const fake = new FakeNet();
  fake.org = () => jsonReply({ code: "OAUTH_SCOPE_MISMATCH" }, 401);
  const { s, counts } = session(fake, undefined, NEW_ACCESS);
  assertEquals(await s.request("GET", "/crm/v8/org"), { ok: false, code: "scope_mismatch" });
  assertEquals(counts.refreshes, 0);
  assertEquals(fake.tokenRequests().length, 0);
});

Deno.test("session: a refresh that fails says why", async () => {
  const table: [string, () => Response | Promise<Response>, string][] = [
    ["invalid_code means the stored token died", () => jsonReply({ error: "invalid_code" }), "token_revoked"],
    ["invalid_client", () => jsonReply({ error: "invalid_client" }), "invalid_client"],
    ["invalid_client_secret", () => jsonReply({ error: "invalid_client_secret" }), "invalid_client"],
    ["html 500", () => new Response(HTML_PAGE, { status: 500 }), "server_error"],
    ["html 400", () => new Response(HTML_PAGE, { status: 400 }), "bad_response"],
    ["network", () => Promise.reject(new TypeError(SENTINEL)), "network"],
    ["hang", () => new Promise<Response>(() => {}), "timeout"],
    ["sandbox", () => tokenOk({ api_domain: "https://sandbox.zohoapis.sa" }), "wrong_environment"],
  ];
  for (const [label, respond, code] of table) {
    const fake = new FakeNet();
    fake.token = respond;
    const { s, counts } = session(fake);
    assertEquals(await s.request("GET", "/crm/v8/org"), { ok: false, code } as never, label);
    assertEquals(fake.apiRequests().length, 0, label);
    assertEquals(counts.denied, 0, label);
  }
});

Deno.test("session: Access Denied on refresh is recorded, so nothing asks again during Zoho's window", async () => {
  for (const respond of [() => jsonReply({ error: "Access Denied", status: "failure" }), () => new Response(ROADBLOCK, { status: 200 }), () => jsonReply({ error: "access_denied" })]) {
    const fake = new FakeNet();
    fake.token = respond;
    const { s, counts } = session(fake);
    assertEquals(await s.request("GET", "/crm/v8/org"), { ok: false, code: "throttled" });
    assertEquals(counts.denied, 1);
    assertEquals(s.waitSeconds, 600);
  }
});

Deno.test("Z7 session: our own ceiling stops a refresh before it leaves, and says how long", async () => {
  const fake = new FakeNet();
  const { s, counts } = session(fake, { allowed: false, wait_seconds: 240 });
  assertEquals(await s.request("GET", "/crm/v8/org"), { ok: false, code: "throttled" });
  assertEquals(fake.seen.length, 0);
  assertEquals(counts.refreshes, 1);
  assertEquals(s.waitSeconds, 240);
});

Deno.test("Z4 session: a spent budget sends nothing", async () => {
  const fake = new FakeNet();
  const s = new ZohoSession(CLIENT, REFRESH, { net: netOf(fake), refreshBegin: () => Promise.resolve({ allowed: true, wait_seconds: 0 }), tokenDenied: () => Promise.resolve() }, budget(0), NEW_ACCESS);
  assertEquals(await s.request("GET", "/crm/v8/org"), { ok: false, code: "timeout" });
  assertEquals(fake.seen.length, 0);
});

Deno.test("coql: 204 has no body and means no rows; the request is exactly select_query", async () => {
  const fake = new FakeNet();
  fake.coql = () => new Response(null, { status: 204 });
  const { s } = session(fake, undefined, NEW_ACCESS);
  assertEquals(await coql(s, "select id from Leads where id is not null"), { ok: true, rows: [] });
  const seen = fake.apiRequests()[0];
  assertEquals(seen.method, "POST");
  assertEquals(seen.url, "https://www.zohoapis.sa/crm/v8/coql");
  assertEquals(JSON.parse(seen.body), { select_query: "select id from Leads where id is not null" });
  assertEquals(seen.headers["Content-Type"], "application/json");

  fake.coql = () => jsonReply({ data: "not rows" });
  assertEquals(await coql(s, "x"), { ok: false, code: "bad_response" });
  fake.coql = () => jsonReply({ data: [{ id: "1" }, 5, null, "x"] });
  assertEquals(await coql(s, "x"), { ok: true, rows: [{ id: "1" }] });
});

/* ===================== الفحص ===================== */

const verify = async (fake: FakeNet, access: string | null = NEW_ACCESS) => await verifyConnection(session(fake, undefined, access).s, NOW);

Deno.test("verify: a full pass reads identity and stats, and writes nothing", async () => {
  const fake = new FakeNet();
  const reply = await verify(fake);
  assertEquals(reply, {
    ok: true,
    identity: { org_name: "Mulaem", user_name: "مدير زوهو", user_profile: "Administrator" },
    stats: {
      window_days: 7,
      calls: 15,
      calls_linked: 4,
      long_enough: 7,
      by_owner: [{ name: "alsaiari", calls: 10 }, { name: "second", calls: 5 }],
      leads_new: 3,
      active_users: 6,
    },
  });
  assertEquals(fake.noteRequests().length, 0);
  for (const seen of fake.seen) {
    assert(seen.method === "GET" || new URL(seen.url).pathname === "/crm/v8/coql", seen.url);
    if (seen.method === "POST") assert(/^select /.test(JSON.parse(seen.body).select_query));
  }
});

Deno.test("verify: every query is one of the forms that ran on the real org", async () => {
  const fake = new FakeNet();
  await verify(fake);
  const queries = fake.apiRequests().filter((seen) => seen.method === "POST").map((seen) => JSON.parse(seen.body).select_query as string);
  const since = "2026-10-30T15:00:00+03:00";
  assertEquals(queries, [
    `select Owner, COUNT(id) from Calls where Call_Start_Time >= '${since}' group by Owner`,
    `select Owner, COUNT(id) from Calls where Call_Start_Time >= '${since}' and What_Id is not null group by Owner`,
    `select COUNT(id) from Calls where Call_Start_Time >= '${since}' and Call_Duration_in_seconds >= 30`,
    `select COUNT(id) from Leads where Created_Time >= '${since}'`,
    "select COUNT(id) from Contacts where id is not null",
    "select COUNT(id) from Notes where Note_Title = 'mulaem-check'",
  ]);
  const gets = fake.apiRequests().filter((seen) => seen.method === "GET").map((seen) => seen.url);
  assertEquals(gets, [
    "https://www.zohoapis.sa/crm/v8/org",
    "https://www.zohoapis.sa/crm/v8/users?type=CurrentUser",
    "https://www.zohoapis.sa/crm/v8/users/actions/count?type=ActiveUsers",
  ]);
});

Deno.test("riyadhIso: +03:00 with no milliseconds", () => {
  assertEquals(riyadhIso(Date.UTC(2026, 10, 5, 21, 30, 15)), "2026-11-06T00:30:15+03:00");
});

Deno.test("verify: org type and identity decide the environment and the org; zgid or domain_name is enough", async () => {
  const org = (fields: Record<string, unknown>) => () => jsonReply({ org: [{ type: "production", domain_name: "org150000145002", zgid: "150000145002", company_name: "Mulaem", ...fields }] });
  const table: [string, () => Response, string | true][] = [
    ["sandbox", org({ type: "sandbox" }), "wrong_environment"],
    ["developer", org({ type: "developer" }), "wrong_environment"],
    ["bigin", org({ type: "bigin" }), "wrong_environment"],
    ["both differ", org({ domain_name: "org1", zgid: "1" }), "wrong_org"],
    ["both missing", org({ domain_name: null, zgid: null }), "wrong_org"],
    ["zgid matches alone", org({ domain_name: "something-else" }), true],
    ["domain matches alone", org({ zgid: "1" }), true],
    ["zgid as a number", org({ domain_name: "x", zgid: 150000145002 }), true],
    ["no type", () => jsonReply({ org: [{ zgid: "150000145002" }] }), "bad_response"],
    ["no org", () => jsonReply({ org: [] }), "bad_response"],
    ["org not a list", () => jsonReply({ org: "x" }), "bad_response"],
    ["empty body", () => new Response("", { status: 200 }), "bad_response"],
    ["html", () => new Response("<html></html>", { status: 200 }), "bad_response"],
    ["204", () => new Response(null, { status: 204 }), "bad_response"],
  ];
  for (const [label, respond, expected] of table) {
    const fake = new FakeNet();
    fake.org = respond;
    const reply = await verify(fake);
    if (expected === true) assert(reply.ok, label);
    else assertEquals(reply, { ok: false, code: expected } as never, label);
  }
});

Deno.test("verify: refusals on /org and on the user become the contract's codes", async () => {
  const table: [number, unknown, string][] = [
    [401, { code: "OAUTH_SCOPE_MISMATCH" }, "scope_mismatch"],
    [403, { code: "NO_PERMISSION", details: { permissions: ["Crm_Implied_Api_Access"] } }, "no_permission"],
    [403, { code: "INACTIVE_USER" }, "inactive_user"],
    [400, { code: "AUTHORIZATION_FAILED" }, "no_permission"],
    [429, { code: "TOO_MANY_REQUESTS" }, "rate_limited"],
    [500, { code: "INTERNAL_ERROR" }, "server_error"],
    [400, { code: "INVALID_DATA" }, "bad_response"],
    [404, { code: "INVALID_URL_PATTERN" }, "bad_response"],
  ];
  for (const [status, body, code] of table) {
    for (const where of ["org", "user"] as const) {
      const fake = new FakeNet();
      fake[where] = () => jsonReply(body, status);
      assertEquals(await verify(fake), { ok: false, code } as never, `${where} ${status}`);
    }
  }
});

Deno.test("verify: only the Administrator profile passes, because a narrower user sees smaller numbers with no error", async () => {
  const table: [unknown, boolean][] = [
    [{ name: "Administrator" }, true],
    [{ name: " Administrator " }, true],
    [{ name: "M1" }, false],
    [{ name: "administrator" }, false],
    [{ name: "Standard" }, false],
    [{ name: null }, false],
    [null, false],
    ["Administrator", false],
  ];
  for (const [profile, passes] of table) {
    const fake = new FakeNet();
    fake.user = () => jsonReply({ users: [{ full_name: "x", profile }] });
    const reply = await verify(fake);
    if (passes) assert(reply.ok, JSON.stringify(profile));
    else assertEquals(reply, { ok: false, code: "not_admin" }, JSON.stringify(profile));
  }
  for (const body of [{ users: [] }, { users: "x" }, {}]) {
    const fake = new FakeNet();
    fake.user = () => jsonReply(body);
    assertEquals(await verify(fake), { ok: false, code: "bad_response" }, JSON.stringify(body));
  }
});

Deno.test("verify: a failed count is null and never blocks", async () => {
  for (const status of [400, 500, 502]) {
    const fake = new FakeNet();
    fake.coql = (seen) => {
      const query = JSON.parse(seen.body).select_query as string;
      return query.includes("What_Id") ? jsonReply({ code: "INVALID_QUERY" }, status) : fake.defaultCoql(seen);
    };
    const reply = await verify(fake);
    assert(reply.ok);
    assertEquals(reply.stats.calls_linked, null);
    assertEquals(reply.stats.calls, 15);
    assertEquals(reply.stats.long_enough, 7);
    assertEquals(reply.stats.leads_new, 3);
    assertEquals(reply.stats.active_users, 6);
  }
});

Deno.test("verify: rate limit or a spent budget during counting keeps what was read and stops asking", async () => {
  const fake = new FakeNet();
  let queries = 0;
  fake.coql = (seen) => {
    queries++;
    return queries === 2 ? jsonReply({ code: "TOO_MANY_REQUESTS" }, 429) : fake.defaultCoql(seen);
  };
  const reply = await verify(fake);
  assert(reply.ok);
  assertEquals(queries, 2);
  assertEquals(reply.stats.calls, 15);
  assertEquals(reply.stats.calls_linked, null);
  assertEquals(reply.stats.long_enough, null);
  assertEquals(reply.stats.leads_new, null);
  assertEquals(reply.stats.active_users, null);
  assertEquals(fake.seen.filter((seen) => seen.url.includes("actions/count")).length, 0);
});

Deno.test("verify: scope_mismatch or no_permission fails on what the sync needs (Leads, Contacts, Notes)", async () => {
  for (const mark of ["from Leads", "from Contacts", "from Notes"]) {
    for (const [status, code, expected] of [[401, "OAUTH_SCOPE_MISMATCH", "scope_mismatch"], [403, "NO_PERMISSION", "no_permission"]] as const) {
      const fake = new FakeNet();
      fake.coql = (seen) => (JSON.parse(seen.body).select_query as string).includes(mark) ? jsonReply({ code }, status) : fake.defaultCoql(seen);
      assertEquals(await verify(fake), { ok: false, code: expected }, `${mark} ${code}`);
    }
  }
});

Deno.test("verify: a count shown for information only never burns a code: the number stays empty and the save goes on", async () => {
  const cases: [string, (stats: { calls: number | null; calls_linked: number | null; long_enough: number | null }) => number | null][] = [
    ["group by Owner", (s) => s.calls_linked === null ? 0 : s.calls],
    ["What_Id", (s) => s.calls_linked],
    ["Call_Duration", (s) => s.long_enough],
  ];
  for (const [mark, read] of cases) {
    for (const [status, code] of [[401, "OAUTH_SCOPE_MISMATCH"], [403, "NO_PERMISSION"]] as const) {
      const fake = new FakeNet();
      fake.coql = (seen) => {
        const query = JSON.parse(seen.body).select_query as string;
        const hit = mark === "group by Owner" ? query.includes(mark) && !query.includes("What_Id") : query.includes(mark);
        return hit ? jsonReply({ code }, status) : fake.defaultCoql(seen);
      };
      const reply = await verify(fake);
      assert(reply.ok, `${mark} ${code}`);
      if (mark === "group by Owner") assertEquals(reply.stats.calls, null, `${mark} ${code}`);
      else assertEquals(read(reply.stats), null, `${mark} ${code}`);
    }
  }
  for (const [status, code] of [[401, "OAUTH_SCOPE_MISMATCH"], [403, "NO_PERMISSION"]] as const) {
    const fake = new FakeNet();
    fake.usersCount = () => jsonReply({ code }, status);
    const reply = await verify(fake);
    assert(reply.ok, `users ${code}`);
    assertEquals(reply.stats.active_users, null, `users ${code}`);
  }
});

Deno.test("verify: 204 counts as zero, a row of another shape as unknown", async () => {
  const fake = new FakeNet();
  fake.coql = () => new Response(null, { status: 204 });
  const zero = await verify(fake);
  assert(zero.ok);
  assertEquals([zero.stats.calls, zero.stats.calls_linked, zero.stats.long_enough, zero.stats.leads_new], [0, 0, 0, 0]);
  assertEquals(zero.stats.by_owner, []);

  const named = new FakeNet();
  named.coql = () => jsonReply({ data: [{ total: 9 }] });
  const alias = await verify(named);
  assert(alias.ok);
  assertEquals(alias.stats.long_enough, 9);

  const odd = new FakeNet();
  odd.coql = () => jsonReply({ data: [{ "COUNT(id)": "not a number" }] });
  const unknown = await verify(odd);
  assert(unknown.ok);
  assertEquals(unknown.stats.long_enough, null);
  assertEquals(unknown.stats.calls, null);

  const text = new FakeNet();
  text.coql = () => jsonReply({ data: [{ "COUNT(id)": "12" }] });
  const parsed = await verify(text);
  assert(parsed.ok);
  assertEquals(parsed.stats.leads_new, 12);
});

Deno.test("verify: active users falls back to the list only on 404", async () => {
  const fallback = new FakeNet();
  fallback.usersCount = () => jsonReply({ code: "INVALID_URL_PATTERN" }, 404);
  const counted = await verify(fallback);
  assert(counted.ok);
  assertEquals(counted.stats.active_users, 3);
  assert(fallback.seen.some((seen) => seen.url === "https://www.zohoapis.sa/crm/v8/users?type=ActiveUsers&per_page=200"));

  const failed = new FakeNet();
  failed.usersCount = () => new Response("<html></html>", { status: 500 });
  const missing = await verify(failed);
  assert(missing.ok);
  assertEquals(missing.stats.active_users, null);
  assertFalse(failed.seen.some((seen) => seen.url.includes("per_page")));

  const odd = new FakeNet();
  odd.usersCount = () => jsonReply({ count: "x" });
  const weird = await verify(odd);
  assert(weird.ok);
  assertEquals(weird.stats.active_users, null);
});

Deno.test("Z5 S verify: stats carry staff names and numbers only, with nothing else from the replies", async () => {
  const fake = new FakeNet();
  fake.user = () => jsonReply({ users: [{ full_name: "مدير", email: `${SENTINEL}@x.sa`, phone: SENTINEL, profile: { name: "Administrator", id: SENTINEL } }] });
  fake.org = () => jsonReply({ org: [{ ...ORG_OK.org[0], phone: SENTINEL, primary_email: SENTINEL, license_details: { x: SENTINEL } }] });
  fake.coql = () => jsonReply({ data: [{ "COUNT(id)": 2, Owner: { name: "اسم", id: SENTINEL, email: SENTINEL } }], info: { note: SENTINEL } });
  const reply = await verify(fake);
  assert(reply.ok);
  assertClean(JSON.stringify(reply), "verify");
});

Deno.test("ownerCounts: sorted by calls, capped, cleaned, and rows with no name left out", () => {
  const rows = [
    { "COUNT(id)": 1, Owner: { name: "b", id: "2" } },
    { "COUNT(id)": 5, Owner: { name: "a", id: "1" } },
    { "COUNT(id)": 1, Owner: { name: "a2", id: "3" } },
    { "COUNT(id)": 9, Owner: null },
    { "COUNT(id)": 9, Owner: { id: "4" } },
    { "COUNT(id)": "x", Owner: { name: "c" } },
  ];
  assertEquals(ownerCounts(rows), [{ name: "a", calls: 5 }, { name: "a2", calls: 1 }, { name: "b", calls: 1 }]);
  assertEquals(ownerCounts(Array.from({ length: 60 }, (_, i) => ({ "COUNT(id)": i, Owner: { name: `n${i}` } }))).length, 50);
});

Deno.test("cleanName: no control characters, no tags, a cap", () => {
  assertEquals(cleanName("  اسم\u0000 موظف\n"), "اسم موظف");
  assertEquals(cleanName("<b>x</b>"), "b x /b");
  assertEquals(cleanName("x".repeat(150))?.length, 100);
  assertEquals(cleanName(""), null);
  assertEquals(cleanName("   "), null);
  assertEquals(cleanName(5), null);
  assertEquals(cleanName(null), null);
});

/* ===================== ما يُعرض ===================== */

Deno.test("S pickStats: only the Stats fields survive from a stored value, and odd values become safe ones", () => {
  assertEquals(pickStats(null), null);
  assertEquals(pickStats("x"), null);
  assertEquals(pickStats([]), null);
  const picked = pickStats({
    window_days: 99,
    calls: 3,
    calls_linked: 2,
    long_enough: 1,
    by_owner: [{ name: "a", calls: 2, phone: SENTINEL }, { name: "", calls: 1 }, SENTINEL, null],
    leads_new: 1,
    active_users: 6,
    summary: SENTINEL,
  });
  assertEquals(picked, { window_days: 7, calls: 3, calls_linked: 2, long_enough: 1, by_owner: [{ name: "a", calls: 2 }], leads_new: 1, active_users: 6 });
  assertEquals(pickStats({ calls: -1, calls_linked: SENTINEL, long_enough: 1.5, by_owner: SENTINEL, leads_new: null }), {
    window_days: 7,
    calls: null,
    calls_linked: null,
    long_enough: null,
    by_owner: [],
    leads_new: null,
    active_users: null,
  });
});

const ROW: LinkRow = {
  org_name: "Mulaem",
  user_name: "مدير",
  user_profile: "Administrator",
  client_hint: "1234",
  connected_at: "2026-11-05T10:00:00.123456+00:00",
  connected_by: "u-1",
  last_check_at: "2026-11-05T11:00:00+00:00",
  last_check_ok: true,
  last_check_code: "ok",
  last_check_stats: { calls: 2, summary: SENTINEL },
};

Deno.test("linkFromRow: the contract's shape, with ISO times, whitelisted stats and a closed list of codes", () => {
  assertEquals(linkFromRow(null, "اسم"), emptyLink());
  assertEquals(emptyLink(), { connected: false, org_name: null, user_name: null, user_profile: null, client_hint: null, connected_at: null, connected_by_name: null, check: null });
  const link = linkFromRow(ROW, "اسم المدير");
  assertEquals(Object.keys(link).sort(), ["check", "client_hint", "connected", "connected_at", "connected_by_name", "org_name", "user_name", "user_profile"]);
  assertEquals(link.connected, true);
  assertEquals(link.connected_at, "2026-11-05T10:00:00.123Z");
  assertEquals(link.check?.at, "2026-11-05T11:00:00.000Z");
  assertEquals(link.check?.stats?.calls, 2);
  assertFalse(JSON.stringify(link).includes(SENTINEL));
  assertEquals(linkFromRow({ ...ROW, last_check_at: null }, null).check, null);
  assertEquals(linkFromRow({ ...ROW, last_check_ok: false, last_check_code: "token_revoked" }, null).check, { ok: false, code: "token_revoked", at: "2026-11-05T11:00:00.000Z", stats: null });
  assertEquals(linkFromRow({ ...ROW, last_check_ok: false, last_check_code: SENTINEL }, null).check?.code, "bad_response");
  assertEquals(linkFromRow({ ...ROW, last_check_code: null }, null).check?.code, "bad_response");
  assertEquals(CHECK_CODES.length, 17);
});

Deno.test("syncFromRow: the contract's shape; no row is the empty one; odd values become safe ones", () => {
  assertEquals(syncFromRow(null, "اسم"), emptySync());
  assertEquals(Object.keys(emptySync()).sort(), [
    "ambiguous_total", "enabled", "failed_total", "last_run_at", "last_run_code", "needs_reconnect", "no_match_total", "start_from", "started_at", "started_by_name", "waiting", "written_7d", "written_total",
  ]);
  const sync = syncFromRow({
    enabled: true,
    started_at: "2026-11-05T10:00:00+00:00",
    start_from: "2026-11-05T10:00:00+00:00",
    started_by: "u-1",
    last_run_at: "2026-11-05T10:05:00+00:00",
    last_run_code: "capped",
    needs_reconnect: true,
    written_total: 5,
    written_7d: 4,
    no_match_total: 3,
    waiting: 2,
    failed_total: 1,
    ambiguous_total: 2,
  }, "اسم");
  assertEquals(sync, {
    enabled: true,
    started_at: "2026-11-05T10:00:00.000Z",
    start_from: "2026-11-05T10:00:00.000Z",
    started_by_name: "اسم",
    last_run_at: "2026-11-05T10:05:00.000Z",
    last_run_code: "capped",
    written_total: 5,
    written_7d: 4,
    no_match_total: 3,
    waiting: 2,
    failed_total: 1,
    ambiguous_total: 2,
    needs_reconnect: true,
  });
  const odd = syncFromRow({
    enabled: null,
    started_at: SENTINEL,
    start_from: null,
    started_by: null,
    last_run_at: null,
    last_run_code: `${SENTINEL} text`,
    needs_reconnect: null,
    written_total: null,
    written_7d: -1,
    no_match_total: 1.5,
    waiting: null,
    failed_total: null,
    ambiguous_total: null,
  }, null);
  assertEquals(odd, emptySync());
});

Deno.test("USER_OK stays a fixture: its email does not reach the identity", async () => {
  const reply = await verify(new FakeNet());
  assert(reply.ok);
  assertFalse(JSON.stringify(reply).includes(USER_OK.users[0].email));
});
