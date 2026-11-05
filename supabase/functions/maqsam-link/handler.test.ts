// اختبارات معالج maqsam-link بلا شبكة ولا قاعدة: المعتمِدات مزيّفة في الذاكرة، ومقسم مزيّف بردود مكتوبة.
// كل الأسماء والأرقام مصطنعة (المستودع عام). التشغيل: deno test --allow-read --allow-env supabase/functions/maqsam-link/
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { Check, Credentials, LinkRow, Stats } from "./core.ts";
import { type AuditRow, type ConnectInput, type Deps, handle, type Profile, supabaseDeps } from "./handler.ts";

const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);
const NOW_ISO = new Date(NOW).toISOString();
const SITE = "https://dash.mulaem.sa";
const ARABIC = /[\u0600-\u06ff]/;

// كل قيمة لا يجوز أن تخرج تحمل هذه الكلمة، فيكفي فحص واحد على كل ما خرج
const SENTINEL = "SENTINEL";
const KEY_ID = "SENTINEL-KEY-ID-0123456789-7f3a";
const SECRET = "SENTINEL-SECRET/with+chars=:and space";
const KEY_BASE64 = btoa(`${KEY_ID}:${SECRET}`);
const OLD = { host: "old.maqsam.com", key_id: "old-key-id-1234", secret: "old-secret" };

const SAVE = { action: "save", base_url: "av.maqsam.com", access_key_id: KEY_ID, access_secret: SECRET };

// مكالمة بكل حقول التوثيق، وكل حقل عميل أو نص فيها يحمل الكلمة
const CALL = {
  id: "SENTINEL-id",
  caller: "SENTINEL-caller-name",
  callee: "SENTINEL-callee-name",
  callerNumber: "SENTINEL-966500000001",
  calleeNumber: "SENTINEL-966500000002",
  inputs: ["SENTINEL-input"],
  state: "completed",
  direction: "SENTINEL-direction",
  type: "SENTINEL-type",
  timestamp: 1_790_000_000,
  duration: 45,
  agents: [{ identifier: "SENTINEL-agent-id", email: "Agent.One@Mulaem.sa", name: "SENTINEL-agent-name" }],
  integrations: { crm: "SENTINEL-integration" },
  ringingTime: 1,
  holdTime: 0,
  waitingTime: 0,
  handlingTime: 45,
  acwTime: 0,
  callTags: ["SENTINEL-tag"],
  callAutoTags: ["SENTINEL-autotag"],
  sentiment: "SENTINEL-sentiment",
  summary: "SENTINEL-summary-text",
  callTranscription: "SENTINEL-transcript-text",
};

const STATS: Stats = {
  window_days: 7,
  calls: 1,
  capped: false,
  talked: 1,
  long_enough: 1,
  with_summary: 1,
  with_transcript: 1,
  latest_at: new Date(1_790_000_000_000).toISOString(),
  agents: [{ email: "agent.one@mulaem.sa", calls: 1 }],
  no_agent: 0,
};

const maqsamOk = (calls: unknown[] = [CALL]) => new Response(JSON.stringify({ result: "success", message: calls }), { status: 200 });

/* ===================== عالم مزيّف ===================== */

const PROFILES: Record<string, Profile> = {
  "u-admin": { id: "u-admin", role: "admin", is_blocked: false, legacy_id: 7, fullname: "مدير تجريبي", username: "admin.test" },
  "u-staff": { id: "u-staff", role: "callcenter", is_blocked: false, legacy_id: 8, fullname: "موظف", username: "staff.test" },
  "u-field": { id: "u-field", role: "field", is_blocked: false, legacy_id: 9, fullname: "ميداني", username: "field.test" },
  "u-blocked": { id: "u-blocked", role: "admin", is_blocked: true, legacy_id: 10, fullname: "مدير موقوف", username: "blocked.test" },
  "u-noname": { id: "u-noname", role: "admin", is_blocked: false, legacy_id: null, fullname: null, username: "noname.test" },
};

const TOKENS: Record<string, string> = {
  "admin-token": "u-admin",
  "staff-token": "u-staff",
  "field-token": "u-field",
  "blocked-token": "u-blocked",
  "noname-token": "u-noname",
  "ghost-token": "u-ghost",
};

interface World {
  deps: Deps;
  row: LinkRow | null;
  vault: { key_id: string; secret: string } | null;
  fetches: { url: string; init: RequestInit }[];
  connects: ConnectInput[];
  records: Check[];
  audits: AuditRow[];
  disconnects: number;
  credentialReads: number;
  maqsam: (url: string, init: RequestInit) => Promise<Response> | Response;
}

function world(start: { connected?: boolean; row?: Partial<LinkRow> } = {}): World {
  const w: World = {
    deps: undefined as unknown as Deps,
    row: start.connected
      ? {
        host: OLD.host,
        key_hint: "1234",
        connected_at: "2026-10-01T09:00:00+00:00",
        connected_by: "u-admin",
        last_check_at: "2026-10-01T09:00:00+00:00",
        last_check_ok: true,
        last_check_code: "ok",
        last_check_stats: { ...STATS, calls: 3 },
        ...start.row,
      }
      : null,
    vault: start.connected ? { key_id: OLD.key_id, secret: OLD.secret } : null,
    fetches: [],
    connects: [],
    records: [],
    audits: [],
    disconnects: 0,
    credentialReads: 0,
    maqsam: () => maqsamOk(),
  };
  w.deps = {
    getUser: (token) => Promise.resolve(TOKENS[token] ? { id: TOKENS[token] } : null),
    getProfile: (id) => Promise.resolve(PROFILES[id] ?? null),
    readRow: () => Promise.resolve(w.row ? structuredClone(w.row) : null),
    nameOf: (id) => Promise.resolve(PROFILES[id]?.fullname ?? PROFILES[id]?.username ?? null),
    connect: (input) => {
      w.connects.push(input);
      w.vault = { key_id: input.key_id, secret: input.secret };
      w.row = {
        host: input.host,
        key_hint: input.key_hint,
        connected_at: NOW_ISO,
        connected_by: input.by,
        last_check_at: NOW_ISO,
        last_check_ok: true,
        last_check_code: "ok",
        last_check_stats: input.stats,
      };
      return Promise.resolve();
    },
    credentials: (): Promise<Credentials | null> => {
      w.credentialReads++;
      return Promise.resolve(w.row && w.vault ? { host: w.row.host, ...w.vault, connected_at: w.row.connected_at! } : null);
    },
    recordCheck: (check, connectedAt) => {
      w.records.push(check);
      if (!w.row || w.row.connected_at !== connectedAt) return Promise.resolve(false);
      w.row = {
        ...w.row,
        last_check_at: check.at,
        last_check_ok: check.ok,
        last_check_code: check.code,
        last_check_stats: check.stats,
      };
      return Promise.resolve(true);
    },
    disconnect: () => {
      w.disconnects++;
      w.row = null;
      w.vault = null;
      return Promise.resolve();
    },
    audit: (row) => {
      w.audits.push(row);
      return Promise.resolve();
    },
    fetch: (url, init) => {
      w.fetches.push({ url, init });
      return Promise.resolve(w.maqsam(url, init));
    },
    now: () => NOW,
    timeoutMs: 50,
  };
  return w;
}

function post(body: unknown, options: { token?: string | null; headers?: Record<string, string> } = {}): Request {
  const token = options.token === undefined ? "admin-token" : options.token;
  return new Request("https://functions.test/maqsam-link", {
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

// كل ما طُبع على console أثناء fn
async function capture<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string }> {
  const methods = ["log", "info", "warn", "error", "debug", "trace"] as const;
  const saved = methods.map((method) => console[method]);
  const lines: string[] = [];
  for (const method of methods) {
    console[method] = (...args: unknown[]) => {
      lines.push(args.map((arg) => typeof arg === "string" ? arg : Deno.inspect(arg, { depth: 10, showHidden: true })).join(" "));
    };
  }
  try {
    const result = await fn();
    return { result, lines: lines.join("\n") };
  } finally {
    methods.forEach((method, index) => {
      console[method] = saved[index];
    });
  }
}

function assertClean(text: string, label: string) {
  assertFalse(text.includes(SENTINEL), `${label} leaked a sentinel: ${text}`);
  assertFalse(text.includes(KEY_BASE64), `${label} leaked the Basic credentials`);
  assertFalse(text.includes(OLD.key_id), `${label} leaked the stored key id`);
  assertFalse(text.includes(OLD.secret), `${label} leaked the stored secret`);
}

function assertError(reply: { res: Response; json: Json }, status: number, code: string) {
  assertEquals(reply.res.status, status, JSON.stringify(reply.json));
  assertEquals(reply.json.status, "error");
  assertEquals(reply.json.code, code);
  assert(ARABIC.test(reply.json.message), `message is not Arabic: ${reply.json.message}`);
  assertEquals(Object.keys(reply.json).sort(), ["code", "message", "status"]);
}

function assertNoEffects(w: World, label: string) {
  assertEquals(w.fetches.length, 0, `${label}: called Maqsam`);
  assertEquals(w.connects.length, 0, `${label}: stored`);
  assertEquals(w.records.length, 0, `${label}: recorded`);
  assertEquals(w.audits.length, 0, `${label}: audited`);
  assertEquals(w.disconnects, 0, `${label}: disconnected`);
  assertEquals(w.credentialReads, 0, `${label}: read the credentials`);
}

const ACTIONS: Record<string, unknown>[] = [{ action: "status" }, SAVE, { action: "test" }, { action: "disconnect" }];

/* ===================== S1: المدير غير الموقوف وحده ===================== */

Deno.test("S1 no token or a bad one is 401 for every action, and nothing happens", async () => {
  for (const action of ACTIONS) {
    for (const token of [null, "", "wrong-token"]) {
      const w = world({ connected: true });
      const reply = await call(w, action, { token });
      assertError(reply, 401, "unauthenticated");
      assertNoEffects(w, `${action.action} ${token}`);
      assertEquals(w.vault, { key_id: OLD.key_id, secret: OLD.secret });
    }
    for (const header of ["Basic abc", "Bearer", "Bearer a b", "admin-token"]) {
      const w = world({ connected: true });
      const reply = await call(w, action, { token: null, headers: { Authorization: header } });
      assertError(reply, 401, "unauthenticated");
      assertNoEffects(w, `${action.action} ${header}`);
    }
  }
});

Deno.test("S1 anyone who is not an active admin is 403 for every action, and nothing happens", async () => {
  for (const action of ACTIONS) {
    for (const token of ["staff-token", "field-token", "blocked-token", "ghost-token"]) {
      const w = world({ connected: true });
      const reply = await call(w, action, { token });
      assertError(reply, 403, "forbidden");
      assertNoEffects(w, `${action.action} ${token}`);
      assertEquals(w.vault, { key_id: OLD.key_id, secret: OLD.secret });
    }
  }
});

Deno.test("S1 the caller is checked before the body is read", async () => {
  const w = world();
  let read = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      read = true;
      controller.close();
    },
  }, { highWaterMark: 0 });
  const req = new Request("https://functions.test/maqsam-link", { method: "POST", body, headers: { Authorization: "Bearer staff-token" } });
  const res = await handle(req, w.deps);
  assertEquals(res.status, 403);
  assertFalse(read);
  await res.body?.cancel();
});

Deno.test("S1 an auth lookup that throws fails closed with a plain 500", async () => {
  for (const broken of ["getUser", "getProfile"] as const) {
    const w = world({ connected: true });
    w.deps[broken] = () => Promise.reject(new Error(`boom ${SENTINEL}`));
    const { result, lines } = await capture(() => call(w, { action: "disconnect" }));
    assertError(result, 500, "server_error");
    assertNoEffects(w, broken);
    assertClean(result.text, broken);
    assertClean(lines, broken);
  }
});

/* ===================== S8: الجسم وCORS ===================== */

Deno.test("S8 CORS: the allowed origin is fixed, on OPTIONS and every reply, whatever the Origin", async () => {
  const preflight = await handle(
    new Request("https://functions.test/maqsam-link", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }),
    world().deps,
  );
  await preflight.text();
  assertEquals(preflight.status, 200);
  assertEquals(preflight.headers.get("Access-Control-Allow-Origin"), SITE);
  assert(preflight.headers.get("Access-Control-Allow-Methods")?.includes("POST"));
  assertEquals(preflight.headers.get("Access-Control-Allow-Headers"), "authorization, x-client-info, apikey, content-type");

  const origin = { Origin: "https://evil.example" };
  const replies = [
    await call(world(), { action: "status" }, { headers: origin }),
    await call(world(), { action: "status" }, { token: null, headers: origin }),
    await call(world(), { action: "status" }, { token: "staff-token", headers: origin }),
    await call(world(), "{bad", { headers: origin }),
    await call(world(), { action: "test" }, { headers: origin }),
  ];
  for (const { res } of replies) {
    assertEquals(res.headers.get("Access-Control-Allow-Origin"), SITE);
    assertEquals(res.headers.get("Cache-Control"), "no-store");
  }
  const other = await handle(new Request("https://functions.test/maqsam-link", { method: "GET", headers: origin }), world().deps);
  assertEquals(other.headers.get("Access-Control-Allow-Origin"), SITE);
  await other.text();
});

Deno.test("S8 anything but POST is 405 bad_request", async () => {
  for (const method of ["GET", "PUT", "DELETE", "PATCH", "HEAD"]) {
    const w = world();
    const res = await handle(new Request("https://functions.test/maqsam-link", { method, headers: { Authorization: "Bearer admin-token" } }), w.deps);
    const text = await res.text();
    assertEquals(res.status, 405, method);
    if (method !== "HEAD") {
      assertError({ res, json: JSON.parse(text) }, 405, "bad_request");
    }
    assertNoEffects(w, method);
  }
});

Deno.test("S8 a body above 8 KB is 413, by its header or by what actually arrives", async () => {
  const padded = (size: number, filler = "x") => {
    const base = JSON.stringify({ action: "disconnect", pad: "" });
    return base.slice(0, -2) + filler.repeat(size - base.length) + '"}';
  };
  // بالترويسة، ولو كان الجسم صغيراً
  const declared = world({ connected: true });
  assertError(await call(declared, { action: "disconnect" }, { headers: { "Content-Length": "8193" } }), 413, "bad_request");
  assertNoEffects(declared, "declared");

  // بلا ترويسة: ما وصل فعلاً
  const actual = world({ connected: true });
  const big = padded(8193);
  assertEquals(new TextEncoder().encode(big).byteLength, 8193);
  assertError(await call(actual, big), 413, "bad_request");
  assertNoEffects(actual, "actual");

  // الحد بالبايت لا بالحرف: 4100 حرف عربي أقل من 8 ك حرفاً وأكثر منها بايتاً
  const arabic = world({ connected: true });
  assertError(await call(arabic, { action: "disconnect", pad: "س".repeat(4100) }), 413, "bad_request");
  assertNoEffects(arabic, "arabic");

  // 8 KB تماماً تمر
  const exact = world({ connected: true });
  const fits = padded(8192);
  assertEquals(new TextEncoder().encode(fits).byteLength, 8192);
  const reply = await call(exact, fits);
  assertEquals(reply.res.status, 200);
  assertEquals(exact.disconnects, 1);
});

Deno.test("S8 an oversized body from a caller without rights is refused without reading it", async () => {
  const w = world();
  const reply = await call(w, "x".repeat(10_000), { token: null });
  assertError(reply, 401, "unauthenticated");
});

Deno.test("a body that is not a JSON object, or an unknown action, is 400 bad_request", async () => {
  const bodies = [
    "", "not json", "{bad", "null", "5", '"status"', "[]", '[{"action":"status"}]',
    "{}", '{"action":null}', '{"action":5}', '{"action":"other"}', '{"action":"STATUS"}', '{"action":["status"]}',
  ];
  for (const body of bodies) {
    const w = world({ connected: true });
    const res = await handle(
      new Request("https://functions.test/maqsam-link", { method: "POST", headers: { Authorization: "Bearer admin-token" }, body }),
      w.deps,
    );
    assertError({ res, json: await res.json() }, 400, "bad_request");
    assertNoEffects(w, body);
  }
  const notUtf8 = world();
  const res = await handle(
    new Request("https://functions.test/maqsam-link", {
      method: "POST",
      headers: { Authorization: "Bearer admin-token" },
      body: new Uint8Array([0xff, 0xfe]),
    }),
    notUtf8.deps,
  );
  assertError({ res, json: await res.json() }, 400, "bad_request");
});

/* ===================== status ===================== */

Deno.test("status: not connected is the contract's empty link", async () => {
  const w = world();
  const reply = await call(w, { action: "status" });
  assertEquals(reply.res.status, 200);
  assertEquals(reply.json, {
    status: "ok",
    link: { connected: false, host: null, key_hint: null, connected_at: null, connected_by_name: null, check: null },
  });
  assertNoEffects(w, "status");
});

Deno.test("status: connected shows the row with the name, without calling Maqsam or reading the secrets", async () => {
  const w = world({ connected: true });
  const reply = await call(w, { action: "status" });
  assertEquals(reply.res.status, 200);
  assertEquals(Object.keys(reply.json).sort(), ["link", "status"]);
  assertEquals(reply.json.link, {
    connected: true,
    host: "old.maqsam.com",
    key_hint: "1234",
    connected_at: "2026-10-01T09:00:00.000Z",
    connected_by_name: "مدير تجريبي",
    check: { ok: true, code: "ok", at: "2026-10-01T09:00:00.000Z", stats: { ...STATS, calls: 3 } },
  });
  assertNoEffects(w, "status");
});

Deno.test("status: a person who was deleted leaves the name empty", async () => {
  const w = world({ connected: true, row: { connected_by: null } });
  assertEquals((await call(w, { action: "status" })).json.link.connected_by_name, null);
});

Deno.test("S5 status: a stored check with extra fields returns only the Stats fields", async () => {
  const w = world({
    connected: true,
    row: {
      last_check_stats: {
        ...STATS,
        summary: "SENTINEL-summary",
        callTranscription: "SENTINEL-transcript",
        caller: "SENTINEL-caller",
        agents: [{ email: "a@x.sa", calls: 1, number: "SENTINEL-number" }],
      },
    },
  });
  const reply = await call(w, { action: "status" });
  assertClean(reply.text, "status");
  assertEquals(Object.keys(reply.json.link.check.stats).sort(), Object.keys(STATS).sort());
  assertEquals(reply.json.link.check.stats.agents, [{ email: "a@x.sa", calls: 1 }]);
});

/* ===================== save ===================== */

Deno.test("save: success probes first, stores the cleaned values once, and reports the contract's shape", async () => {
  const w = world();
  const reply = await call(w, {
    action: "save",
    base_url: "  https://portal.av.maqsam.com/docs/v2/calls \n",
    access_key_id: `  ${KEY_ID}\r\n`,
    access_secret: `\t${SECRET}  `,
  });
  assertEquals(reply.res.status, 200);
  assertEquals(Object.keys(reply.json).sort(), ["check", "link", "saved", "status"]);
  assertEquals(reply.json.status, "ok");
  assertEquals(reply.json.saved, true);
  assertEquals(reply.json.check, { ok: true, code: "ok", at: NOW_ISO, stats: STATS });
  assertEquals(reply.json.link, {
    connected: true,
    host: "av.maqsam.com",
    key_hint: "7f3a",
    connected_at: NOW_ISO,
    connected_by_name: "مدير تجريبي",
    check: { ok: true, code: "ok", at: NOW_ISO, stats: STATS },
  });
  assertEquals(w.fetches.length, 1);
  assertEquals(new URL(w.fetches[0].url).hostname, "api.av.maqsam.com");
  assertEquals((w.fetches[0].init.headers as Record<string, string>).Authorization, `Basic ${KEY_BASE64}`);
  assertEquals(w.connects, [{ host: "av.maqsam.com", key_id: KEY_ID, secret: SECRET, key_hint: "7f3a", by: "u-admin", stats: STATS }]);
  assertEquals(w.records, []);
});

Deno.test("S2 save: a key shorter than 8 characters gets no hint", async () => {
  const w = world();
  const reply = await call(w, { ...SAVE, access_key_id: "SENTINE" });
  assertEquals(reply.json.saved, true);
  assertEquals(w.connects[0].key_hint, null);
  assertEquals(reply.json.link.key_hint, null);
  assertFalse(reply.text.includes("SENTINE"));
});

Deno.test("S3 S9 save: bad values are refused with their own code before anything goes out", async () => {
  const table: [Record<string, unknown>, string][] = [
    [{ base_url: "evil.com" }, "invalid_host"],
    [{ base_url: "maqsam.com.evil.com" }, "invalid_host"],
    [{ base_url: "evilmaqsam.com" }, "invalid_host"],
    [{ base_url: "maqsam.com:443" }, "invalid_host"],
    [{ base_url: "user@maqsam.com" }, "invalid_host"],
    [{ base_url: "127.0.0.1" }, "invalid_host"],
    [{ base_url: "maqsam.com." }, "invalid_host"],
    [{ base_url: "" }, "invalid_host"],
    [{ base_url: null }, "invalid_host"],
    [{ base_url: 5 }, "invalid_host"],
    [{ base_url: undefined }, "invalid_host"],
    [{ access_key_id: "" }, "invalid_key_id"],
    [{ access_key_id: "   " }, "invalid_key_id"],
    [{ access_key_id: "a b" }, "invalid_key_id"],
    [{ access_key_id: "a:b" }, "invalid_key_id"],
    [{ access_key_id: "x".repeat(257) }, "invalid_key_id"],
    [{ access_key_id: "مفتاح" }, "invalid_key_id"],
    [{ access_key_id: null }, "invalid_key_id"],
    [{ access_key_id: 5 }, "invalid_key_id"],
    [{ access_key_id: undefined }, "invalid_key_id"],
    [{ access_secret: "" }, "invalid_secret"],
    [{ access_secret: "   " }, "invalid_secret"],
    [{ access_secret: "x".repeat(513) }, "invalid_secret"],
    [{ access_secret: "سر" }, "invalid_secret"],
    [{ access_secret: "a\nb" }, "invalid_secret"],
    [{ access_secret: null }, "invalid_secret"],
    [{ access_secret: {} }, "invalid_secret"],
    [{ access_secret: undefined }, "invalid_secret"],
  ];
  for (const [change, code] of table) {
    const w = world({ connected: true });
    const before = structuredClone(w.row);
    const reply = await call(w, { ...SAVE, ...change });
    assertError(reply, 400, code);
    assertNoEffects(w, JSON.stringify(change));
    assertEquals(w.row, before);
    // رسالة الخطأ ثابتة: لا تعيد ما كُتب
    for (const value of Object.values(change)) {
      if (typeof value === "string" && value.trim() !== "") assertFalse(reply.text.includes(value), `echoed ${value}`);
    }
  }
});

/* ===================== S7: الحفظ بعد التجربة ===================== */

const FAILING_MAQSAM: [string, string, () => Promise<Response> | Response][] = [
  ["401", "unauthorized", () => new Response(JSON.stringify({ error: true, message: `Unauthorized ${SENTINEL}` }), { status: 401 })],
  ["403", "unauthorized", () => new Response(`Forbidden ${SENTINEL}`, { status: 403 })],
  ["404", "not_found", () => new Response(`Not found ${SENTINEL}`, { status: 404 })],
  ["429", "rate_limited", () => new Response(`Slow down ${SENTINEL}`, { status: 429 })],
  ["500", "server_error", () => new Response(`Oops ${SENTINEL}`, { status: 500 })],
  ["400", "bad_response", () => new Response(JSON.stringify({ error: true, message: `Invalid Start Time ${SENTINEL}` }), { status: 400 })],
  ["200 html", "bad_response", () => new Response(`<html>${SENTINEL}</html>`, { status: 200 })],
  ["200 other shape", "bad_response", () => new Response(JSON.stringify({ error: true, message: SENTINEL }), { status: 200 })],
  ["redirect refused", "network", () => Promise.reject(new TypeError(`redirect ${SENTINEL}`))],
  ["dns", "network", () => Promise.reject(new TypeError(`dns error ${SENTINEL}`))],
  ["abort", "timeout", () => Promise.reject(new DOMException(SENTINEL, "AbortError"))],
  ["hang", "timeout", () => new Promise<Response>(() => {})],
];

Deno.test("S7 save: a failed probe writes nothing on a fresh link", async () => {
  for (const [label, code, respond] of FAILING_MAQSAM) {
    const w = world();
    w.maqsam = respond;
    const { result: reply, lines } = await capture(() => call(w, SAVE));
    assertEquals(reply.res.status, 200, label);
    assertEquals(reply.json.status, "ok");
    assertEquals(reply.json.saved, false, label);
    assertEquals(reply.json.check, { ok: false, code, at: NOW_ISO, stats: null }, label);
    assertEquals(reply.json.link.connected, false);
    assertEquals(w.connects.length, 0, label);
    assertEquals(w.records.length, 0, label);
    assertEquals(w.audits.length, 0, label);
    assertEquals(w.row, null);
    assertEquals(w.vault, null);
    assertClean(reply.text, label);
    assertClean(lines, label);
  }
});

Deno.test("S7 save: a failed probe keeps earlier keys in place, and a later test still uses them", async () => {
  for (const [label, code, respond] of FAILING_MAQSAM) {
    const w = world({ connected: true });
    const rowBefore = structuredClone(w.row);
    w.maqsam = respond;
    const { result: reply } = await capture(() => call(w, SAVE));
    assertEquals(reply.json.saved, false, label);
    assertEquals(reply.json.check.code, code, label);
    assertEquals(w.connects.length, 0, label);
    assertEquals(w.records.length, 0, label);
    assertEquals(w.audits.length, 0, label);
    assertEquals(w.disconnects, 0, label);
    assertEquals(w.row, rowBefore, label);
    assertEquals(w.vault, { key_id: OLD.key_id, secret: OLD.secret }, label);
    // الرد يصف الربط القائم كما هو
    assertEquals(reply.json.link.host, "old.maqsam.com", label);
    assertEquals(reply.json.link.key_hint, "1234", label);
    assertEquals(reply.json.link.check.ok, true, label);
    assertEquals(reply.json.link.check.at, "2026-10-01T09:00:00.000Z", label);

    w.fetches.length = 0;
    w.maqsam = () => maqsamOk([]);
    const later = await call(w, { action: "test" });
    assertEquals(later.json.check.ok, true, label);
    assertEquals(new URL(w.fetches[0].url).hostname, "api.old.maqsam.com", label);
    assertEquals((w.fetches[0].init.headers as Record<string, string>).Authorization, `Basic ${btoa(`${OLD.key_id}:${OLD.secret}`)}`, label);
  }
});

Deno.test("save: Maqsam's success served as text/html still saves (live Maqsam serves its JSON that way)", async () => {
  const w = world();
  w.maqsam = () => new Response(JSON.stringify({ result: "success", message: [CALL] }), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  const reply = await call(w, SAVE);
  assertEquals(reply.json.saved, true);
  assertEquals(reply.json.check.code, "ok");
  assertEquals(w.connects.length, 1);
});

Deno.test("S7 save: a passing probe replaces earlier keys", async () => {
  const w = world({ connected: true });
  const reply = await call(w, SAVE);
  assertEquals(reply.json.saved, true);
  assertEquals(w.vault, { key_id: KEY_ID, secret: SECRET });
  assertEquals(reply.json.link.host, "av.maqsam.com");
  assertEquals(reply.json.link.key_hint, "7f3a");
});

Deno.test("save: when the database refuses after a good probe, the reply is a plain 500 with nothing leaked and no audit", async () => {
  const w = world({ connected: true });
  w.deps.connect = () => Promise.reject(new Error(`insert failed for ${KEY_ID} ${SECRET}`));
  const { result: reply, lines } = await capture(() => call(w, SAVE));
  assertError(reply, 500, "server_error");
  // «حاول مرة أخرى» وحدها طريق مغلق إن كان الخطأ لا يزول: تقول لمن يُرجع
  assertEquals(reply.json.message, "تعذّر إكمال العملية. جرّب بعد قليل. إذا تكرر فأخبر مسؤول النظام.");
  assertEquals(w.audits, []);
  assertClean(reply.text, "reply");
  assertClean(lines, "log");
});

Deno.test("save: a read failing after the keys were stored still says saved, with the link just stored", async () => {
  for (const broken of ["readRow", "nameOf"] as const) {
    const w = world({ connected: true });
    Object.assign(w.deps, { [broken]: () => Promise.reject(new Error(`read failed ${SENTINEL}`)) });
    const { result: reply, lines } = await capture(() => call(w, SAVE));
    assertEquals(reply.res.status, 200, broken);
    assertEquals(reply.json.saved, true, broken);
    const check = { ok: true, code: "ok", at: NOW_ISO, stats: STATS };
    assertEquals(reply.json.check, check, broken);
    assertEquals(reply.json.link, {
      connected: true,
      host: "av.maqsam.com",
      key_hint: "7f3a",
      connected_at: NOW_ISO,
      connected_by_name: "مدير تجريبي",
      check,
    }, broken);
    assertEquals(w.vault, { key_id: KEY_ID, secret: SECRET }, broken);
    assertEquals(w.audits.length, 1, broken);
    assertClean(reply.text, broken);
    assertClean(lines, broken);
    assert(lines.includes("save-readback"), broken);
  }
});

Deno.test("save: the same read failing after a refused probe is a plain 500, because nothing was stored", async () => {
  const w = world({ connected: true });
  w.maqsam = () => new Response("", { status: 401 });
  w.deps.readRow = () => Promise.reject(new Error(`read failed ${SENTINEL}`));
  const { result: reply } = await capture(() => call(w, SAVE));
  assertError(reply, 500, "server_error");
  assertEquals(w.connects, []);
});

/* ===================== test ===================== */

Deno.test("test: not connected is 409 with no call to Maqsam", async () => {
  const w = world();
  assertError(await call(w, { action: "test" }), 409, "not_connected");
  assertEquals(w.fetches.length, 0);
  assertEquals(w.records.length, 0);
});

Deno.test("test: a row whose secrets are gone is also 409", async () => {
  const w = world({ connected: true });
  w.vault = null;
  assertError(await call(w, { action: "test" }), 409, "not_connected");
  assertEquals(w.fetches.length, 0);
});

Deno.test("test: a pass records the result and returns it, without another audit row", async () => {
  const w = world({ connected: true });
  const reply = await call(w, { action: "test" });
  assertEquals(reply.res.status, 200);
  assertEquals(Object.keys(reply.json).sort(), ["check", "link", "status"]);
  assertEquals(reply.json.check, { ok: true, code: "ok", at: NOW_ISO, stats: STATS });
  assertEquals(reply.json.link.check, { ok: true, code: "ok", at: NOW_ISO, stats: STATS });
  assertEquals(reply.json.link.host, "old.maqsam.com");
  assertEquals(w.records, [{ ok: true, code: "ok", at: NOW_ISO, stats: STATS }]);
  assertEquals(w.audits, []);
  assertEquals(w.connects, []);
});

Deno.test("test: a failure is recorded, the link stays connected, and no old stats are shown as current", async () => {
  for (const [label, code, respond] of FAILING_MAQSAM) {
    const w = world({ connected: true });
    w.maqsam = respond;
    const { result: reply, lines } = await capture(() => call(w, { action: "test" }));
    assertEquals(reply.res.status, 200, label);
    assertEquals(reply.json.check, { ok: false, code, at: NOW_ISO, stats: null }, label);
    assertEquals(reply.json.link.connected, true, label);
    assertEquals(reply.json.link.check, { ok: false, code, at: NOW_ISO, stats: null }, label);
    assertEquals(w.records, [{ ok: false, code: code as Check["code"], at: NOW_ISO, stats: null }], label);
    assertEquals(w.vault, { key_id: OLD.key_id, secret: OLD.secret }, label);
    assertClean(reply.text, label);
    assertClean(lines, label);
  }
});

Deno.test("S3 test: a stored host outside the allowlist gets no outbound request and no credentials", async () => {
  for (const host of ["evil.com", "maqsam.com.evil.com", "evilmaqsam.com", "maqsam.com:8443", "maqsam.com@evil.com", "169.254.169.254", ""]) {
    const w = world({ connected: true });
    w.deps.credentials = () => Promise.resolve({ host, key_id: OLD.key_id, secret: OLD.secret, connected_at: NOW_ISO });
    const reply = await call(w, { action: "test" });
    assertError(reply, 400, "invalid_host");
    assertEquals(w.fetches.length, 0, host);
    assertEquals(w.records.length, 0, host);
    assertClean(reply.text, host);
  }
});

Deno.test("test: when recording fails the reply is a plain 500", async () => {
  const w = world({ connected: true });
  w.deps.recordCheck = () => Promise.reject(new Error(`update failed ${SENTINEL}`));
  const { result: reply, lines } = await capture(() => call(w, { action: "test" }));
  assertError(reply, 500, "server_error");
  assertClean(reply.text, "reply");
  assertClean(lines, "log");
});

// فحص يعلق عند مقسم حتى يُطلق، ليحدث شيء آخر أثناءه
async function heldTest(w: World) {
  let release: ((res: Response) => void) | null = null;
  w.deps.timeoutMs = 5_000;
  w.maqsam = () => new Promise<Response>((resolve) => (release = resolve));
  const reply = call(w, { action: "test" });
  while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
  return { reply, release: release as (res: Response) => void };
}

Deno.test("test: a slow probe of the old key does not overwrite a save made meanwhile", async () => {
  const w = world({ connected: true });
  const held = await heldTest(w);
  w.maqsam = () => maqsamOk();
  assertEquals((await call(w, SAVE)).json.saved, true);
  const saved = structuredClone(w.row);

  held.release(new Response("", { status: 401 }));
  const reply = await held.reply;
  assertEquals(reply.res.status, 200);
  assertEquals(w.row, saved);
  assertEquals(w.vault, { key_id: KEY_ID, secret: SECRET });
  // الرد يصف الربط القائم ونتيجته هو، لا نتيجة المفتاح القديم
  assertEquals(reply.json.check, { ok: true, code: "ok", at: NOW_ISO, stats: STATS });
  assertEquals(reply.json.link.key_hint, "7f3a");
  assertEquals(reply.json.link.check, reply.json.check);
  assertEquals((await call(w, { action: "status" })).json.link.check.code, "ok");
});

Deno.test("test: a link removed during the probe answers not_connected, not a passed check", async () => {
  const w = world({ connected: true });
  const held = await heldTest(w);
  assertEquals((await call(w, { action: "disconnect" })).json.link.connected, false);

  held.release(maqsamOk());
  assertError(await held.reply, 409, "not_connected");
  assertEquals(w.row, null);
});

/* ===================== disconnect ===================== */

Deno.test("disconnect: removes the keys and the row and returns the empty link; repeating it is harmless", async () => {
  const w = world({ connected: true });
  const reply = await call(w, { action: "disconnect" });
  assertEquals(reply.res.status, 200);
  assertEquals(reply.json, {
    status: "ok",
    link: { connected: false, host: null, key_hint: null, connected_at: null, connected_by_name: null, check: null },
  });
  assertEquals(w.disconnects, 1);
  assertEquals(w.row, null);
  assertEquals(w.vault, null);
  assertEquals(w.fetches.length, 0);

  assertEquals((await call(w, { action: "disconnect" })).res.status, 200);
  assertError(await call(w, { action: "test" }), 409, "not_connected");
});

Deno.test("disconnect: when the database refuses, the reply is a plain 500 and no audit row is written", async () => {
  const w = world({ connected: true });
  w.deps.disconnect = () => Promise.reject(new Error(`delete failed ${SENTINEL}`));
  const { result: reply, lines } = await capture(() => call(w, { action: "disconnect" }));
  assertError(reply, 500, "server_error");
  assertEquals(w.audits, []);
  assertClean(lines, "log");
});

Deno.test("disconnect: a read failing afterwards cannot make it look undone: nothing is read back", async () => {
  for (const broken of ["readRow", "nameOf"] as const) {
    const w = world({ connected: true });
    Object.assign(w.deps, { [broken]: () => Promise.reject(new Error(`read failed ${SENTINEL}`)) });
    const reply = await call(w, { action: "disconnect" });
    assertEquals(reply.res.status, 200, broken);
    assertEquals(reply.json.link, { connected: false, host: null, key_hint: null, connected_at: null, connected_by_name: null, check: null }, broken);
    assertEquals(w.vault, null, broken);
    assertEquals(w.audits.length, 1, broken);
  }
});

/* ===================== سجل النشاطات ===================== */

Deno.test("audit: one row per save and per disconnect naming the action only", async () => {
  const w = world();
  await call(w, SAVE);
  assertEquals(w.audits, [{ action: "ربط مقسم", user_id: 7, user_name: "مدير تجريبي" }]);
  await call(w, { action: "disconnect" });
  assertEquals(w.audits[1], { action: "فصل مقسم", user_id: 7, user_name: "مدير تجريبي" });
  assertEquals(w.audits.length, 2);
  assertClean(JSON.stringify(w.audits), "audit");
});

Deno.test("audit: status, test and a failed save write no row", async () => {
  const w = world({ connected: true });
  await call(w, { action: "status" });
  await call(w, { action: "test" });
  w.maqsam = () => new Response("", { status: 401 });
  await call(w, SAVE);
  assertEquals(w.audits, []);
});

Deno.test("audit: falls back to the username, and a person with no legacy number is still recorded", async () => {
  const w = world();
  await call(w, SAVE, { token: "noname-token" });
  assertEquals(w.audits, [{ action: "ربط مقسم", user_id: null, user_name: "noname.test" }]);
});

Deno.test("audit: a failing audit row does not fail what already happened", async () => {
  const saved = world();
  saved.deps.audit = () => Promise.reject(new Error(`audit failed ${SENTINEL}`));
  const first = await capture(() => call(saved, SAVE));
  assertEquals(first.result.res.status, 200);
  assertEquals(first.result.json.saved, true);
  assertClean(first.lines, "log");

  const removed = world({ connected: true });
  removed.deps.audit = () => Promise.reject(new Error(`audit failed ${SENTINEL}`));
  const second = await capture(() => call(removed, { action: "disconnect" }));
  assertEquals(second.result.res.status, 200);
  assertEquals(second.result.json.link.connected, false);
  assertClean(second.lines, "log");
});

/* ===================== S2 وS5: ما يخرج ===================== */

Deno.test("S2 S5 a whole lifecycle: nothing secret or customer-related in any reply, log line or stored value", async () => {
  const w = world();
  const replies: string[] = [];
  const say = async (body: unknown, respond?: () => Promise<Response> | Response) => {
    if (respond) w.maqsam = respond;
    const reply = await call(w, body);
    replies.push(reply.text);
    return reply;
  };
  const { lines } = await capture(async () => {
    const failed = await say(SAVE, () => new Response(JSON.stringify({ error: true, message: SENTINEL }), { status: 401 }));
    assertEquals(failed.json.saved, false);
    const saved = await say(SAVE, () => maqsamOk());
    assertEquals(saved.json.saved, true);
    await say({ action: "status" });
    await say({ action: "test" }, () => maqsamOk([CALL, CALL]));
    await say({ action: "test" }, () => new Response(`<html>${SENTINEL}</html>`, { status: 500 }));
    await say({ action: "test" }, () => Promise.reject(new TypeError(`tls ${SENTINEL} ${KEY_ID} ${SECRET}`)));
    await say(SAVE, () => new Response(JSON.stringify({ result: "success", message: SENTINEL }), { status: 200 }));
    await say({ ...SAVE, base_url: `${SENTINEL}.evil.com` });
    await say({ ...SAVE, access_key_id: `${SENTINEL} with space` });
    await say({ ...SAVE, access_secret: `${SENTINEL}\nnewline` });
    await say({ action: SENTINEL });
    await say({ action: "disconnect" });
  });
  assertEquals(replies.length, 12);
  for (const text of replies) assertClean(text, "reply");
  assertClean(lines, "log");
  // ما حُفظ: الملخص وأثر الفحص ونشاط السجل. المفتاحان لا يذهبان إلا إلى connect.
  assertClean(JSON.stringify(w.connects.map(({ key_id: _k, secret: _s, ...rest }) => rest)), "stored stats");
  assertClean(JSON.stringify(w.records), "recorded checks");
  assertClean(JSON.stringify(w.audits), "audit rows");
  assertEquals(w.connects[0].stats, STATS);
});

Deno.test("S2 every failure path logs a fixed line: an error's text, stack and fields never reach the log", async () => {
  const boom = () => {
    const error = new Error(`boom ${KEY_ID} ${SECRET} ${SENTINEL}`) as Error & { cause?: unknown; details?: unknown };
    error.cause = SENTINEL;
    error.details = { secret: SECRET };
    return Promise.reject(error);
  };
  const broken: (keyof Deps)[] = ["readRow", "nameOf", "connect", "credentials", "recordCheck", "disconnect", "audit"];
  for (const name of broken) {
    const w = world({ connected: true });
    (w.deps as unknown as Record<string, unknown>)[name] = boom;
    const { result, lines } = await capture(async () => [
      await call(w, { action: "status" }),
      await call(w, SAVE),
      await call(w, { action: "test" }),
      await call(w, { action: "disconnect" }),
    ]);
    for (const reply of result) {
      assertClean(reply.text, `${name} reply`);
      assert(reply.res.status === 200 || reply.res.status === 500 || reply.res.status === 409, `${name} ${reply.res.status}`);
    }
    assertClean(lines, `${name} log`);
  }
});

/* ===================== وصل القاعدة الحقيقية (بعميل مزيّف، مع مقارنة بملف الترحيل) ===================== */

interface ClientCall {
  table?: string;
  rpc?: string;
  args?: Record<string, unknown>;
  select?: string;
  eq?: [string, unknown];
  eqs?: [string, unknown][];
  update?: Record<string, unknown>;
  insert?: Record<string, unknown>;
  maybeSingle?: boolean;
}

type DbReply = { data?: unknown; error?: unknown };

function fakeClient(reply: (call: ClientCall) => DbReply = () => ({})) {
  const calls: ClientCall[] = [];
  // وعد بطرق إضافية: مثل بنّاء الاستعلام في supabase-js، والرد يُحسب بعد اكتمال السلسلة
  const chain = (entry: ClientCall) => {
    calls.push(entry);
    const promise = Promise.resolve().then(() => {
      const out = reply(entry);
      return { data: out.data ?? null, error: out.error ?? null };
    });
    const self = Object.assign(promise, {
      select: (columns: string) => (entry.select = columns, self),
      eq: (column: string, value: unknown) => (entry.eq = [column, value], (entry.eqs ??= []).push([column, value]), self),
      update: (values: Record<string, unknown>) => (entry.update = values, self),
      insert: (values: Record<string, unknown>) => (entry.insert = values, self),
      maybeSingle: () => (entry.maybeSingle = true, self),
    });
    return self;
  };
  const client = {
    auth: {
      getUser: (token: string) => {
        calls.push({ rpc: "auth.getUser", args: { token } });
        return Promise.resolve(token === "good" ? { data: { user: { id: "u-1" } }, error: null } : { data: { user: null }, error: { message: "bad jwt" } });
      },
    },
    from: (table: string) => chain({ table }),
    rpc: (rpc: string, args?: Record<string, unknown>) => chain({ rpc, args }),
  };
  return { calls, client: client as unknown as SupabaseClient };
}

const MIGRATION = new URL("../../migrations/041_maqsam_link.sql", import.meta.url);

function migrationSql(): string {
  return Deno.readTextFileSync(MIGRATION).replace(/\r\n/g, "\n");
}

function tableColumns(sql: string): string[] {
  const body = sql.slice(sql.indexOf("create table if not exists public.maqsam_link ("));
  const block = body.slice(0, body.indexOf("\n);"));
  return [...block.matchAll(/^ {4}([a-z_]+) +[a-z]/gm)].map((match) => match[1]);
}

const CHECK: Check = { ok: true, code: "ok", at: NOW_ISO, stats: null };

Deno.test("wiring: getUser reads the token, and a refusal is no user", async () => {
  const { client } = fakeClient();
  const deps = supabaseDeps(client);
  assertEquals(await deps.getUser("good"), { id: "u-1" });
  assertEquals(await deps.getUser("bad"), null);
});

Deno.test("wiring: the row and the name come from the expected places, and the row selects every column of 041 but id", async () => {
  const { calls, client } = fakeClient(({ table, select }) => {
    if (table === "maqsam_link") return { data: { host: "maqsam.com" } };
    if (select === "fullname, username") return { data: { fullname: "", username: "user.name" } };
    return { data: PROFILES["u-admin"] };
  });
  const deps = supabaseDeps(client);
  assertEquals((await deps.readRow())?.host, "maqsam.com");
  assertEquals((await deps.getProfile("u-admin"))?.role, "admin");
  assertEquals(await deps.nameOf("u-admin"), "user.name");

  const read = calls.find((entry) => entry.table === "maqsam_link")!;
  assertEquals(read.eq, ["id", true]);
  assert(read.maybeSingle);
  const columns = tableColumns(migrationSql());
  assertEquals(columns.length, 9);
  assertEquals(read.select!.split(",").map((part) => part.trim()).sort(), columns.filter((column) => column !== "id").sort());

  const profile = calls.find((entry) => entry.table === "profiles")!;
  assertEquals(profile.eq, ["id", "u-admin"]);
  assert(profile.select?.includes("is_blocked"));
  assert(profile.select?.includes("role"));
});

Deno.test("wiring: connect passes exactly the parameters declared in 041, and it is the only place the keys go", async () => {
  const { calls, client } = fakeClient();
  await supabaseDeps(client).connect({ host: "maqsam.com", key_id: "k", secret: "s", key_hint: null, by: "u-1", stats: STATS });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].rpc, "maqsam_link_connect");
  const declared = migrationSql().match(/create or replace function public\.maqsam_link_connect\(([\s\S]*?)\) returns void/)?.[1] ?? "";
  const parameters = [...declared.matchAll(/\bp_[a-z_]+/g)].map((match) => match[0]);
  assertEquals(parameters, ["p_host", "p_key_id", "p_secret", "p_key_hint", "p_by", "p_stats"]);
  assertEquals(Object.keys(calls[0].args ?? {}), parameters);
  assertEquals(calls[0].args, { p_host: "maqsam.com", p_key_id: "k", p_secret: "s", p_key_hint: null, p_by: "u-1", p_stats: STATS });
});

Deno.test("wiring: credentials reads the columns 041 returns; no row is null", async () => {
  const sql = migrationSql();
  assert(sql.includes("returns table (host text, key_id text, secret text, connected_at timestamptz)"));
  const some = fakeClient(() => ({ data: [{ host: "maqsam.com", key_id: "k", secret: "s", connected_at: NOW_ISO, extra: "x" }] }));
  assertEquals(await supabaseDeps(some.client).credentials(), { host: "maqsam.com", key_id: "k", secret: "s", connected_at: NOW_ISO });
  assertEquals(some.calls[0].rpc, "maqsam_link_credentials");
  assertEquals(await supabaseDeps(fakeClient(() => ({ data: [] })).client).credentials(), null);
  assertEquals(await supabaseDeps(fakeClient(() => ({ data: null })).client).credentials(), null);
});

Deno.test("wiring: recordCheck updates exactly the columns 041 grants to the service role, on the link that was probed only", async () => {
  const { calls, client } = fakeClient(() => ({ data: [{ id: true }] }));
  assertEquals(await supabaseDeps(client).recordCheck({ ...CHECK, ok: false, code: "timeout" }, "2026-10-01T09:00:00.123456+00:00"), true);
  assertEquals(calls[0].table, "maqsam_link");
  assertEquals(calls[0].eqs, [["id", true], ["connected_at", "2026-10-01T09:00:00.123456+00:00"]]);
  assertEquals(calls[0].select, "id");
  assertEquals(await supabaseDeps(fakeClient(() => ({ data: [] })).client).recordCheck(CHECK, NOW_ISO), false);
  assertEquals(calls[0].update, { last_check_at: NOW_ISO, last_check_ok: false, last_check_code: "timeout", last_check_stats: null });
  const granted = migrationSql().match(/grant update \(([^)]*)\) on table public\.maqsam_link to service_role;/)?.[1] ?? "";
  assertEquals(Object.keys(calls[0].update ?? {}).sort(), granted.split(",").map((part) => part.trim()).sort());
});

Deno.test("wiring: disconnect calls its function, and audit fits public.activities as it is", async () => {
  const { calls, client } = fakeClient();
  const deps = supabaseDeps(client);
  await deps.disconnect();
  assertEquals(calls[0].rpc, "maqsam_link_disconnect");
  await deps.audit({ action: "ربط مقسم", user_id: 7, user_name: "اسم" });
  assertEquals(calls[1].table, "activities");
  assertEquals(calls[1].insert, { action: "ربط مقسم", user_id: 7, user_name: "اسم" });

  const init = Deno.readTextFileSync(new URL("../../migrations/001_init.sql", import.meta.url)).replace(/\r\n/g, "\n");
  const block = init.slice(init.indexOf("create table if not exists public.activities ("));
  const table = block.slice(0, block.indexOf("\n);"));
  for (const column of Object.keys(calls[1].insert ?? {})) assert(new RegExp(`^ {4}${column} `, "m").test(table), column);
  // لا عمود مطلوب غير المعرّف الذي يولده الجدول
  assertFalse(table.includes("not null"));
});

Deno.test("S2 wiring: a database error loses its text on the way out, and the handler stays silent about it", async () => {
  const message = `value ${SENTINEL} ${KEY_ID} ${SECRET} violates something`;
  const client = fakeClient(() => ({ error: { code: "23514", message, details: SENTINEL, hint: SENTINEL } })).client;
  const deps = supabaseDeps(client);
  const operations: [string, () => Promise<unknown>][] = [
    ["profile", () => deps.getProfile("u")],
    ["read", () => deps.readRow()],
    ["name", () => deps.nameOf("u")],
    ["connect", () => deps.connect({ host: "maqsam.com", key_id: KEY_ID, secret: SECRET, key_hint: null, by: "u", stats: STATS })],
    ["credentials", () => deps.credentials()],
    ["record", () => deps.recordCheck(CHECK, NOW_ISO)],
    ["disconnect", () => deps.disconnect()],
    ["audit", () => deps.audit({ action: "x", user_id: null, user_name: null })],
  ];
  for (const [label, run] of operations) {
    const error = await run().then(() => null, (e) => e) as Error & { code?: string } | null;
    assert(error, label);
    assertEquals(error.code, "23514", label);
    assertClean(`${error.message} ${error.stack} ${Deno.inspect(error, { depth: 10, showHidden: true })}`, label);
  }

  // عبر المعالج كاملاً: مدير سليم، والقاعدة ترفض الكتابة وتذكر القيمة في رسالتها
  const w = world();
  const real = fakeClient(({ rpc }) => rpc === "maqsam_link_connect" ? { error: { code: "P0001", message } } : {});
  w.deps.connect = supabaseDeps(real.client).connect;
  const { result: reply, lines } = await capture(() => call(w, SAVE));
  assertError(reply, 500, "server_error");
  assertClean(reply.text, "reply");
  assertClean(lines, "log");
  assert(lines.includes("P0001"), "the log keeps the database code");
});

Deno.test("every action before 041 is applied names the missing update instead of the general error", async () => {
  const told = "الربط لم يُفعَّل بعد في قاعدة البيانات (التحديث 041). وافق على تشغيل migrate في GitHub.";
  for (const code of ["PGRST205", "PGRST202", "42P01", "42883"]) {
    for (const action of ACTIONS) {
      const w = world({ connected: true });
      const real = supabaseDeps(fakeClient(() => ({ error: { code, message: SENTINEL } })).client);
      Object.assign(w.deps, { readRow: real.readRow, connect: real.connect, credentials: real.credentials, disconnect: real.disconnect });
      const { result: reply, lines } = await capture(() => call(w, action));
      assertEquals(reply.res.status, 500, `${code} ${action.action}`);
      assertEquals(reply.json, { status: "error", code: "server_error", message: told }, `${code} ${action.action}`);
      assertClean(lines, "log");
      assert(lines.includes(code), "the log keeps the database code");
    }
  }
  // خطأ آخر من القاعدة يبقى الخطأ العام
  const w = world({ connected: true });
  w.deps.readRow = supabaseDeps(fakeClient(() => ({ error: { code: "23514", message: SENTINEL } })).client).readRow;
  const { result: other } = await capture(() => call(w, { action: "status" }));
  assertError(other, 500, "server_error");
  assertFalse(other.json.message.includes("041"));
});

Deno.test("wiring: an odd error code is not copied into the log", async () => {
  const w = world();
  const real = fakeClient(() => ({ error: { code: SENTINEL, message: SENTINEL } }));
  w.deps.connect = supabaseDeps(real.client).connect;
  const { result: reply, lines } = await capture(() => call(w, SAVE));
  assertError(reply, 500, "server_error");
  assertClean(lines, "log");
});
