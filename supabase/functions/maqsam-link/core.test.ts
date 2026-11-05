// اختبارات منطق maqsam-link بلا شبكة: النطاق، والمفتاحان، وتصنيف رد مقسم، والملخص، والفحص بـ fetch وساعة مزيّفين.
// كل الأسماء والأرقام مصطنعة (المستودع عام). التشغيل: deno test --allow-read --allow-env supabase/functions/maqsam-link/
import { assert, assertEquals, assertFalse, assertThrows } from "jsr:@std/assert@1";
import {
  basicAuth,
  callsUrl,
  type Check,
  classifyStatus,
  cleanKeyId,
  cleanSecret,
  computeStats,
  emptyLink,
  isAllowedHost,
  keyHint,
  linkFromRow,
  type LinkRow,
  MAX_REQUEST_BYTES,
  MAX_RESPONSE_BYTES,
  normalizeHost,
  parseCallsBody,
  parseRequestBody,
  pickStats,
  probe,
  PROBE_TIMEOUT_MS,
  readCapped,
  WINDOW_DAYS,
} from "./core.ts";

const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);
const NOW_ISO = new Date(NOW).toISOString();
const END = Math.floor(NOW / 1000);
const CREDS = { host: "av.maqsam.com", key_id: "key-id-1234", secret: "se:cret/+=" };

/* ===================== S3: النطاق ===================== */

Deno.test("S3 normalizeHost: accepts maqsam.com and its subdomains in the forms a paste can take", () => {
  const good: [string, string][] = [
    ["maqsam.com", "maqsam.com"],
    ["av.maqsam.com", "av.maqsam.com"],
    ["AV.Maqsam.COM", "av.maqsam.com"],
    ["  av.maqsam.com \r\n", "av.maqsam.com"],
    ["\tav.maqsam.com\u00a0", "av.maqsam.com"],
    ["\u200fav.maqsam.com\u200e", "av.maqsam.com"],
    ["\ufeffav.maqsam.com", "av.maqsam.com"],
    ["https://av.maqsam.com", "av.maqsam.com"],
    ["http://av.maqsam.com/", "av.maqsam.com"],
    ["HTTPS://AV.MAQSAM.COM/docs/v2/calls", "av.maqsam.com"],
    ["portal.av.maqsam.com", "av.maqsam.com"],
    ["https://portal.av.maqsam.com/docs/v2/calls", "av.maqsam.com"],
    ["api.av.maqsam.com", "av.maqsam.com"],
    ["https://api.av.maqsam.com/v2/calls", "av.maqsam.com"],
    ["api.maqsam.com", "maqsam.com"],
    ["portal.maqsam.com", "maqsam.com"],
    ["a-b.c1.maqsam.com", "a-b.c1.maqsam.com"],
    ["maqsam.com/evil.com", "maqsam.com"],
  ];
  for (const [input, expected] of good) assertEquals(normalizeHost(input), expected, JSON.stringify(input));
});

const HOSTILE_HOSTS: unknown[] = [
  // ليس نصاً أو فارغ
  null, undefined, 5, true, {}, ["maqsam.com"], "", "   ", "\u200f",
  // شبيهات وغرباء
  "evil.com", "maqsam.com.evil.com", "av.maqsam.com.evil.com", "evilmaqsam.com", "notmaqsam.com", "maqsam.co", "maqsam.com.sa",
  "maqsam-com.evil.com", "maqsamXcom", "xn--maqsam-0ya.com", "com", "maqsam", "evil.com/maqsam.com", "https://evil.com/maqsam.com",
  "api.evil.com", "portal.evil.com", "api.", "portal.",
  // هوية داخل الرابط
  "user@maqsam.com", "user:pass@maqsam.com", "maqsam.com@evil.com", "maqsam.com:pw@evil.com", "https://maqsam.com@evil.com/",
  "https://evil.com@maqsam.com/", "av.maqsam.com/@evil.com",
  // منفذ
  "maqsam.com:443", "av.maqsam.com:8443", "https://maqsam.com:443/", "maqsam.com:", "maqsam.com:80@evil.com",
  // شرطة مائلة عكسية
  "maqsam.com\\evil.com", "evil.com\\.maqsam.com", "https://evil.com\\@maqsam.com", "https:\\\\maqsam.com", "maqsam.com/\\evil.com",
  // مسافات في الوسط
  "maq sam.com", "av .maqsam.com", "maqsam.com\tevil.com", "maqsam.com\nevil.com", "maqsam.com\r\n.evil.com", "maqsam.com/ evil",
  // نسبة مئوية
  "maqsam.com%2f.evil.com", "%6daqsam.com", "evil.com%2f.maqsam.com", "maqsam.com%00", "maqsam.com/%2e%2e",
  // استعلام أو جزء
  "maqsam.com?x=1", "evil.com?.maqsam.com", "maqsam.com#frag", "evil.com#.maqsam.com", "https://evil.com/?.maqsam.com", "maqsam.com/path?x=1",
  "https://maqsam.com/#x",
  // نقطة في الآخر
  "maqsam.com.", "av.maqsam.com.", "https://maqsam.com./", "maqsam.com..",
  // عناوين IP
  "127.0.0.1", "10.0.0.1", "169.254.169.254", "[::1]", "[::ffff:127.0.0.1]", "2130706433", "0x7f.0.0.1", "https://127.0.0.1/",
  // صيغة خاطئة
  ".maqsam.com", "a..maqsam.com", "-a.maqsam.com", "a-.maqsam.com", "a_b.maqsam.com", "*.maqsam.com", "https://", "http://", "//maqsam.com",
  "https:/maqsam.com", "https://https://maqsam.com", "ftp://maqsam.com", "file:///maqsam.com", "javascript:alert(1)", "<maqsam.com>",
  "maqsam.com,evil.com", "maqsam.com;evil.com",
  // غير ASCII وخفي في الوسط
  "maqsam\u3002com", "maqs\u0430m.com", "\uff4daqsam.com", "\u212aav.maqsam.com", "maq\u200bsam.com", "maqsam.com\u0000", "\u0000maqsam.com",
  "مقسم.com",
  // طول
  `${"a".repeat(64)}.maqsam.com`, `${"a.".repeat(130)}maqsam.com`,
];

Deno.test("S3 normalizeHost: a table of hostile values is refused", () => {
  for (const input of HOSTILE_HOSTS) assertEquals(normalizeHost(input), null, JSON.stringify(input));
});

Deno.test("S3 isAllowedHost: the exact check on a stored host", () => {
  for (const host of ["maqsam.com", "av.maqsam.com", "a-b.c1.maqsam.com"]) assert(isAllowedHost(host), host);
  const stored = [
    ...HOSTILE_HOSTS,
    "MAQSAM.COM", "Av.maqsam.com", " maqsam.com", "maqsam.com ", "maqsam.com\n", "https://maqsam.com", "maqsam.com/", "maqsam.com/x",
  ];
  for (const host of stored) assertFalse(isAllowedHost(host), JSON.stringify(host));
});

Deno.test("S3 callsUrl: https to api.{host} on the documented path, and it refuses to build anything else", () => {
  assertEquals(
    callsUrl("av.maqsam.com", NOW),
    `https://api.av.maqsam.com/v2/calls?start_time=${END - 7 * 86_400}&end_time=${END}`,
  );
  const parsed = new URL(callsUrl("maqsam.com", NOW));
  assertEquals(parsed.protocol, "https:");
  assertEquals(parsed.hostname, "api.maqsam.com");
  assertEquals(parsed.port, "");
  assertEquals(parsed.pathname, "/v2/calls");
  assertEquals([...parsed.searchParams.keys()].sort(), ["end_time", "start_time"]);
  assertEquals(WINDOW_DAYS, 7);
  for (const host of ["evil.com", "maqsam.com.evil.com", "maqsam.com:443", "maqsam.com@evil.com", "127.0.0.1", ""]) {
    assertThrows(() => callsUrl(host, NOW), Error, "not allowed");
  }
});

/* ===================== S9: المفتاحان ===================== */

Deno.test("S9 cleanKeyId: 1..256 printable ASCII, no spaces or colons, trimmed first", () => {
  const good: [string, string][] = [
    ["a", "a"],
    ["A1b2-_.~!@#", "A1b2-_.~!@#"],
    ["x".repeat(256), "x".repeat(256)],
    ["  padded\t\r\n", "padded"],
    ["\u200fkey\u200e", "key"],
    [`${"x".repeat(256)}   `, "x".repeat(256)],
  ];
  for (const [input, expected] of good) assertEquals(cleanKeyId(input), expected, JSON.stringify(input));
  const bad: unknown[] = [
    null, undefined, 12345678, {}, ["a"], "", "   ", "\n", "a b", "a:b", ":", "a:", "x".repeat(257), "مفتاح", "ke\ty", "ke\ny", "key\u0000", "caf\u00e9", "\u007f",
    "a\u200bb",
  ];
  for (const input of bad) assertEquals(cleanKeyId(input), null, JSON.stringify(input));
});

Deno.test("S9 cleanSecret: 1..512 printable ASCII (spaces and colons inside are fine), trimmed first", () => {
  const printable = Array.from({ length: 0x7e - 0x21 + 1 }, (_, i) => String.fromCharCode(0x21 + i)).join("");
  const good: [string, string][] = [
    ["a", "a"],
    ["with space inside", "with space inside"],
    ["with:colon", "with:colon"],
    [printable, printable],
    ["x".repeat(512), "x".repeat(512)],
    ["  padded \r\n", "padded"],
    ["\ufeffsecret", "secret"],
  ];
  for (const [input, expected] of good) assertEquals(cleanSecret(input), expected, JSON.stringify(input));
  const bad: unknown[] = [
    null, undefined, 1, [], {}, "", "   ", "x".repeat(513), "سر", "se\ncret", "se\tcret", "\u007f", "a\u0080", "se\u0000cret", "caf\u00e9",
  ];
  for (const input of bad) assertEquals(cleanSecret(input), null, JSON.stringify(input));
});

Deno.test("S2 keyHint: the last 4 characters, only for a key of 8 or more", () => {
  assertEquals(keyHint("12345678"), "5678");
  assertEquals(keyHint("abcdefghijkl"), "ijkl");
  assertEquals(keyHint("1234567"), null);
  assertEquals(keyHint("a"), null);
});

Deno.test("basicAuth: id:secret in base64; a colon in the secret stays in the secret", () => {
  assertEquals(basicAuth("id", "se:cret"), `Basic ${btoa("id:se:cret")}`);
  assertEquals(atob(basicAuth("id", "se:cret").slice(6)), "id:se:cret");
});

/* ===================== تصنيف الرد ===================== */

Deno.test("classifyStatus: the contract's mapping", () => {
  const table: [number, string | null][] = [
    [200, null],
    [401, "unauthorized"],
    [403, "unauthorized"],
    [404, "not_found"],
    [429, "rate_limited"],
    [500, "server_error"],
    [502, "server_error"],
    [503, "server_error"],
    [599, "server_error"],
    [201, "bad_response"],
    [204, "bad_response"],
    [301, "bad_response"],
    [302, "bad_response"],
    [400, "bad_response"],
    [405, "bad_response"],
    [418, "bad_response"],
    [600, "bad_response"],
  ];
  for (const [status, code] of table) assertEquals(classifyStatus(status), code, String(status));
});

Deno.test("parseCallsBody: only result=success with an array message", () => {
  const bytes = (text: string) => new TextEncoder().encode(text);
  assertEquals(parseCallsBody(bytes('{"result":"success","message":[{"id":1},2]}')), [{ id: 1 }, 2]);
  assertEquals(parseCallsBody(bytes('{"result":"success","message":[]}')), []);
  for (
    const text of [
      "", "not json", "<html></html>", "null", "[]", '"success"', "{}", '{"result":"success"}', '{"result":"success","message":{}}',
      '{"result":"success","message":"x"}', '{"result":"error","message":[]}', '{"error":true,"message":"Unauthorized"}', '{"message":[]}',
    ]
  ) {
    assertEquals(parseCallsBody(bytes(text)), null, text);
  }
  assertEquals(parseCallsBody(new Uint8Array([0xff, 0xfe, 0xfd])), null);
});

Deno.test("parseRequestBody: only a JSON object", () => {
  const bytes = (text: string) => new TextEncoder().encode(text);
  assertEquals(parseRequestBody(bytes('{"action":"status","x":1}')), { action: "status", x: 1 });
  assertEquals(parseRequestBody(bytes("{}")), {});
  for (const text of ["", " ", "not json", "{bad", "null", "5", '"status"', "true", "[]", '[{"action":"status"}]']) {
    assertEquals(parseRequestBody(bytes(text)), null, text);
  }
  assertEquals(parseRequestBody(new Uint8Array([0xff, 0xfe])), null);
});

Deno.test("readCapped: returns the bytes up to the cap, null above it, and cancels what is left", async () => {
  let cancelled = false;
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++;
      controller.enqueue(new Uint8Array(4));
    },
    cancel() {
      cancelled = true;
    },
  }, { highWaterMark: 0 });
  assertEquals(await readCapped(stream, 10), null);
  assert(cancelled);
  assertEquals(pulls, 3);

  const exact = new Response(new Uint8Array(10)).body;
  assertEquals((await readCapped(exact, 10))?.byteLength, 10);
  assertEquals((await readCapped(null, 10))?.byteLength, 0);
});

/* ===================== الملخص ===================== */

const STATS_KEYS = [
  "agents", "calls", "capped", "latest_at", "long_enough", "no_agent", "talked", "window_days", "with_summary", "with_transcript",
];

Deno.test("computeStats: an empty week", () => {
  assertEquals(computeStats([]), {
    window_days: 7,
    calls: 0,
    capped: false,
    talked: 0,
    long_enough: 0,
    with_summary: 0,
    with_transcript: 0,
    latest_at: null,
    agents: [],
    no_agent: 0,
  });
});

Deno.test("computeStats: talked and long_enough follow state and duration", () => {
  const talked = (call: Record<string, unknown>) => {
    const stats = computeStats([call]);
    return [stats.talked, stats.long_enough];
  };
  assertEquals(talked({ state: "completed", duration: 45 }), [1, 1]);
  assertEquals(talked({ state: "serviced", duration: 45 }), [1, 1]);
  assertEquals(talked({ state: "completed", duration: 30 }), [1, 1]);
  assertEquals(talked({ state: "completed", duration: 29 }), [1, 0]);
  assertEquals(talked({ state: "completed", duration: 29.9 }), [1, 0]);
  assertEquals(talked({ state: "completed", duration: 1 }), [1, 0]);
  assertEquals(talked({ state: "completed", duration: 0 }), [0, 0]);
  assertEquals(talked({ state: "completed", duration: -5 }), [0, 0]);
  assertEquals(talked({ state: "completed", duration: "45" }), [1, 1]);
  assertEquals(talked({ state: "completed", duration: "abc" }), [0, 0]);
  assertEquals(talked({ state: "completed", duration: null }), [0, 0]);
  assertEquals(talked({ state: "completed" }), [0, 0]);
  assertEquals(talked({ duration: 45 }), [0, 0]);
  assertEquals(talked({ state: null, duration: 45 }), [0, 0]);
  assertEquals(talked({ state: 1, duration: 45 }), [0, 0]);
  for (
    const state of ["initiated", "in_progress", "busy", "no_answer", "canceled", "failed", "aborted", "blocked", "abandoned", "dropped", "out_of_hours"]
  ) {
    assertEquals(talked({ state, duration: 45 }), [0, 0], state);
  }
});

const ODD_FILLED: [unknown, boolean][] = [
  ["نص", true],
  ["some text", true],
  ["  x  ", true],
  [["a"], true],
  [[{ speaker: "x" }], true],
  [[null, "a"], true],
  [{ text: "x" }, true],
  [{ a: { b: ["x"] } }, true],
  [[null], false],
  [{ a: null }, false],
  [{ text: "", segments: [] }, false],
  [[{ text: "  " }], false],
  ["null", false],
  [" NONE ", false],
  ["[]", false],
  ["{ }", false],
  ["n/a", false],
  [{ text: "null" }, false],
  ["", false],
  ["   ", false],
  ["\n\t ", false],
  [[], false],
  [{}, false],
  [null, false],
  [undefined, false],
  [0, false],
  [1, false],
  [true, false],
  [false, false],
];

Deno.test("computeStats: a very deep value neither crashes nor counts", () => {
  let deep: unknown = "x";
  for (let i = 0; i < 100_000; i++) deep = [deep];
  assertEquals(computeStats([{ summary: deep, callTranscription: deep }]).with_summary, 0);
  assertEquals(computeStats([{ summary: deep, callTranscription: deep }]).with_transcript, 0);
});

Deno.test("computeStats: odd shapes of summary", () => {
  for (const [summary, counted] of ODD_FILLED) {
    assertEquals(computeStats([{ summary }]).with_summary, counted ? 1 : 0, JSON.stringify(summary));
    assertEquals(computeStats([{ summary }]).with_transcript, 0);
  }
});

Deno.test("computeStats: odd shapes of callTranscription", () => {
  for (const [callTranscription, counted] of ODD_FILLED) {
    assertEquals(computeStats([{ callTranscription }]).with_transcript, counted ? 1 : 0, JSON.stringify(callTranscription));
    assertEquals(computeStats([{ callTranscription }]).with_summary, 0);
  }
});

Deno.test("computeStats: odd shapes of agents", () => {
  const table: [unknown, string[]][] = [
    [[{ email: "a@x.sa" }], ["a@x.sa"]],
    [[{ identifier: "7", email: "a@x.sa", name: "اسم" }], ["a@x.sa"]],
    [{ email: "a@x.sa" }, ["a@x.sa"]],
    [{ identifier: "7", email: "A@X.SA" }, ["a@x.sa"]],
    [["a@x.sa"], ["a@x.sa"]],
    [["a@x.sa", "b@x.sa"], ["a@x.sa", "b@x.sa"]],
    [[{ email: "a@x.sa" }, { email: "b@x.sa" }], ["a@x.sa", "b@x.sa"]],
    [[{ email: "  A@X.sa " }], ["a@x.sa"]],
    [[{ email: "a@x.sa" }, { email: "a@x.sa" }, "A@x.sa"], ["a@x.sa"]],
    [[{ email: "a@x.sa" }, { email: "not-an-email" }, 5, null, { name: "x" }], ["a@x.sa"]],
    // ما عداها لا موظف فيه
    [null, []],
    [undefined, []],
    ["a@x.sa", []],
    [5, []],
    [true, []],
    [[], []],
    [{}, []],
    [{ name: "x" }, []],
    [{ email: null }, []],
    [{ email: 5 }, []],
    [{ email: "" }, []],
    [{ email: "not-an-email" }, []],
    [[null], []],
    [[5, true, []], []],
    [[{}], []],
    [[{ identifier: "7" }], []],
    [["7", "not-an-email"], []],
    [[{ email: "a b@x.sa" }], []],
    [[{ email: "a@x" }], []],
    [[{ email: "@x.sa" }], []],
    [[{ email: "a@" }], []],
    [[{ email: "a@x..sa" }], []],
    [[{ email: "<a@x.sa>" }], []],
    [[{ email: `${"a".repeat(250)}@x.sa` }], []],
    [[[{ email: "a@x.sa" }]], []],
    ['[{"email":"a@x.sa"}]', []],
  ];
  for (const [agents, emails] of table) {
    const stats = computeStats([{ agents }]);
    assertEquals(stats.agents.map((agent) => agent.email).sort(), emails, JSON.stringify(agents));
    assertEquals(stats.no_agent, emails.length ? 0 : 1, JSON.stringify(agents));
  }
});

Deno.test("computeStats: a call with several agents counts once for each; counts sorted by calls then email", () => {
  const stats = computeStats([
    { agents: [{ email: "b@x.sa" }, { email: "a@x.sa" }] },
    { agents: [{ email: "b@x.sa" }] },
    { agents: { email: "C@x.sa" } },
    { agents: ["c@x.sa", "b@x.sa"] },
    { agents: null },
    {},
  ]);
  assertEquals(stats.calls, 6);
  assertEquals(stats.agents, [
    { email: "b@x.sa", calls: 3 },
    { email: "c@x.sa", calls: 2 },
    { email: "a@x.sa", calls: 1 },
  ]);
  assertEquals(stats.no_agent, 2);
});

Deno.test("computeStats: at most 50 agents, keeping the busiest", () => {
  const calls = Array.from({ length: 60 }, (_, i) => ({
    agents: [{ email: `agent${String(i).padStart(2, "0")}@x.sa` }],
  }));
  calls.push({ agents: [{ email: "agent59@x.sa" }] });
  const stats = computeStats(calls);
  assertEquals(stats.agents.length, 50);
  assertEquals(stats.agents[0], { email: "agent59@x.sa", calls: 2 });
  assertEquals(stats.agents[1], { email: "agent00@x.sa", calls: 1 });
  assertEquals(stats.agents[49], { email: "agent48@x.sa", calls: 1 });
});

Deno.test("computeStats: capped at 100 or more calls returned", () => {
  for (const [count, capped] of [[0, false], [99, false], [100, true], [101, true]] as [number, boolean][]) {
    const stats = computeStats(Array.from({ length: count }, () => ({})));
    assertEquals(stats.capped, capped, String(count));
    assertEquals(stats.calls, count);
  }
});

Deno.test("computeStats: latest_at is the largest timestamp, in seconds or milliseconds", () => {
  const latest = (...timestamps: unknown[]) => computeStats(timestamps.map((timestamp) => ({ timestamp }))).latest_at;
  const iso = (ms: number) => new Date(ms).toISOString();
  assertEquals(latest(1_790_000_000), iso(1_790_000_000_000));
  assertEquals(latest(1_790_000_000, 1_790_000_100, 1_789_000_000), iso(1_790_000_100_000));
  assertEquals(latest(1_790_000_000_000), iso(1_790_000_000_000));
  // ثانية وميلي ثانية في القائمة نفسها تُقارنان بعد التوحيد
  assertEquals(latest(1_790_000_100, 1_790_000_000_000), iso(1_790_000_100_000));
  assertEquals(latest("1790000000"), iso(1_790_000_000_000));
  // 1e12 نفسها ثوانٍ كما في العقد، وما فوقها ميلي ثانية
  assertEquals(latest(1e12), iso(1e15));
  assertEquals(latest(1e12 + 1), iso(1e12 + 1));
  for (const bad of [null, undefined, 0, -5, "x", "", true, {}, [], 1e20, Number.MAX_VALUE]) {
    assertEquals(latest(bad), null, JSON.stringify(bad));
  }
  assertEquals(latest(null, 1_790_000_000, "x", 1e20), iso(1_790_000_000_000));
});

Deno.test("computeStats: an entry that is not an object counts as a call and nothing else", () => {
  const stats = computeStats([null, 5, "x", [], true]);
  assertEquals(stats.calls, 5);
  assertEquals(stats.no_agent, 5);
  assertEquals([stats.talked, stats.long_enough, stats.with_summary, stats.with_transcript], [0, 0, 0, 0]);
  assertEquals(stats.latest_at, null);
});

Deno.test("S5 computeStats: only the Stats fields, with no customer data, summary or transcript text", () => {
  const stats = computeStats([{
    id: "SENTINEL-id",
    caller: "SENTINEL-caller",
    callee: "SENTINEL-callee",
    callerNumber: "SENTINEL-966500000001",
    calleeNumber: "SENTINEL-966500000002",
    inputs: ["SENTINEL-input"],
    state: "completed",
    direction: "SENTINEL-direction",
    type: "SENTINEL-type",
    timestamp: 1_790_000_000,
    duration: 45,
    agents: [{ identifier: "SENTINEL-identifier", email: "a@x.sa", name: "SENTINEL-name" }],
    integrations: { x: "SENTINEL-integration" },
    callTags: ["SENTINEL-tag"],
    callAutoTags: ["SENTINEL-autotag"],
    sentiment: "SENTINEL-sentiment",
    summary: "SENTINEL-summary",
    callTranscription: [{ text: "SENTINEL-transcript" }],
  }]);
  assertEquals(Object.keys(stats).sort(), STATS_KEYS);
  assertFalse(JSON.stringify(stats).includes("SENTINEL"));
  assertEquals(Object.keys(stats.agents[0]).sort(), ["calls", "email"]);
  assertEquals(stats.with_summary, 1);
  assertEquals(stats.with_transcript, 1);
});

Deno.test("S5 pickStats: only the Stats fields survive from a stored value, and odd values become safe ones", () => {
  assertEquals(pickStats(null), null);
  assertEquals(pickStats("x"), null);
  assertEquals(pickStats([]), null);
  const picked = pickStats({
    window_days: 99,
    calls: 3,
    capped: true,
    talked: 2,
    long_enough: 1,
    with_summary: 1,
    with_transcript: 1,
    latest_at: "2026-11-05T10:00:00+00:00",
    agents: [
      { email: "A@x.sa", calls: 2, phone: "SENTINEL-phone" },
      { email: "not-an-email", calls: 1 },
      "SENTINEL-string",
      null,
    ],
    no_agent: 1,
    summary: "SENTINEL-summary",
    callTranscription: "SENTINEL-transcript",
  });
  assertEquals(picked, {
    window_days: 7,
    calls: 3,
    capped: true,
    talked: 2,
    long_enough: 1,
    with_summary: 1,
    with_transcript: 1,
    latest_at: "2026-11-05T10:00:00.000Z",
    agents: [{ email: "a@x.sa", calls: 2 }],
    no_agent: 1,
  });
  assertEquals(pickStats({ calls: -1, talked: "SENTINEL", capped: "true", latest_at: "SENTINEL", agents: "SENTINEL", no_agent: 1.5 }), {
    window_days: 7,
    calls: 0,
    capped: false,
    talked: 0,
    long_enough: 0,
    with_summary: 0,
    with_transcript: 0,
    latest_at: null,
    agents: [],
    no_agent: 0,
  });
  assertEquals(pickStats({ agents: Array.from({ length: 60 }, (_, i) => ({ email: `a${i}@x.sa`, calls: 1 })) })?.agents.length, 50);
});

/* ===================== Link ===================== */

const ROW: LinkRow = {
  host: "av.maqsam.com",
  key_hint: "1234",
  connected_at: "2026-11-05T10:00:00+00:00",
  connected_by: "u-1",
  last_check_at: "2026-11-05T11:00:00+00:00",
  last_check_ok: true,
  last_check_code: "ok",
  last_check_stats: { calls: 2, summary: "SENTINEL" },
};

Deno.test("linkFromRow: no row is the contract's empty link", () => {
  const empty = {
    connected: false,
    host: null,
    key_hint: null,
    connected_at: null,
    connected_by_name: null,
    check: null,
  };
  assertEquals(emptyLink(), empty);
  assertEquals(linkFromRow(null, "اسم"), empty);
});

Deno.test("linkFromRow: maps the row, with ISO times and whitelisted stats", () => {
  const link = linkFromRow(ROW, "اسم المدير");
  assertEquals(link.connected, true);
  assertEquals(link.host, "av.maqsam.com");
  assertEquals(link.key_hint, "1234");
  assertEquals(link.connected_at, "2026-11-05T10:00:00.000Z");
  assertEquals(link.connected_by_name, "اسم المدير");
  assertEquals(link.check?.ok, true);
  assertEquals(link.check?.code, "ok");
  assertEquals(link.check?.at, "2026-11-05T11:00:00.000Z");
  assertEquals(link.check?.stats?.calls, 2);
  assertFalse(JSON.stringify(link).includes("SENTINEL"));
});

Deno.test("linkFromRow: no check yet is null; a failed check carries no stats; an unknown code is bad_response", () => {
  assertEquals(linkFromRow({ ...ROW, last_check_at: null }, null).check, null);
  assertEquals(linkFromRow({ ...ROW, last_check_ok: false, last_check_code: "unauthorized" }, null).check, {
    ok: false,
    code: "unauthorized",
    at: "2026-11-05T11:00:00.000Z",
    stats: null,
  });
  assertEquals(linkFromRow({ ...ROW, last_check_ok: false, last_check_code: "SENTINEL" }, null).check?.code, "bad_response");
  assertEquals(linkFromRow({ ...ROW, last_check_code: null }, null).check?.code, "bad_response");
});

/* ===================== الفحص (S4) ===================== */

type Seen = { url: string; init: RequestInit };

function fakeFetch(respond: (seen: Seen) => Promise<Response> | Response) {
  const seen: Seen[] = [];
  return {
    seen,
    fetch: (url: string, init: RequestInit) => {
      const entry = { url, init };
      seen.push(entry);
      return Promise.resolve(respond(entry));
    },
  };
}

const success = (calls: unknown[], init?: ResponseInit) => new Response(JSON.stringify({ result: "success", message: calls }), init);

Deno.test("probe: a success gives ok with the stats, at the injected time", async () => {
  const net = fakeFetch(() => success([{ state: "completed", duration: 60, agents: [{ email: "a@x.sa" }], timestamp: 1_790_000_000 }]));
  const check = await probe(CREDS, { fetch: net.fetch, now: () => NOW });
  assertEquals(check, {
    ok: true,
    code: "ok",
    at: NOW_ISO,
    stats: {
      window_days: 7,
      calls: 1,
      capped: false,
      talked: 1,
      long_enough: 1,
      with_summary: 0,
      with_transcript: 0,
      latest_at: new Date(1_790_000_000_000).toISOString(),
      agents: [{ email: "a@x.sa", calls: 1 }],
      no_agent: 0,
    },
  });
});

// مقسم الحي قدّم JSON رد 401 بنوع text/html، فنوع الرد لا يدخل في الحكم: الحالة والجسم وحدهما
Deno.test("probe: a success served as text/html is still a success", async () => {
  const net = fakeFetch(() => success([], { headers: { "content-type": "text/html; charset=utf-8" } }));
  const check = await probe(CREDS, { fetch: net.fetch, now: () => NOW });
  assertEquals(check.code, "ok");
  assertEquals(check.ok, true);
});

Deno.test("S4 probe: GET over https, redirect error, a signal, Basic auth in the header and nothing secret in the URL", async () => {
  const net = fakeFetch(() => success([]));
  await probe(CREDS, { fetch: net.fetch, now: () => NOW });
  assertEquals(net.seen.length, 1);
  const { url, init } = net.seen[0];
  assertEquals(url, `https://api.av.maqsam.com/v2/calls?start_time=${END - 604_800}&end_time=${END}`);
  assert(url.startsWith("https://"));
  assertFalse(url.includes(CREDS.key_id));
  assertFalse(url.includes(encodeURIComponent(CREDS.secret)));
  assertEquals(new URL(url).username, "");
  assertEquals(new URL(url).password, "");
  assertEquals(init.method, "GET");
  assertEquals(init.redirect, "error");
  assert(init.signal instanceof AbortSignal);
  assertEquals((init.headers as Record<string, string>).Authorization, `Basic ${btoa(`${CREDS.key_id}:${CREDS.secret}`)}`);
});

Deno.test("S3 probe: a stored host outside the allowlist never reaches fetch", async () => {
  for (const host of ["evil.com", "maqsam.com.evil.com", "maqsam.com@evil.com", "127.0.0.1", "maqsam.com:8443", ""]) {
    const net = fakeFetch(() => success([]));
    const check = await probe({ ...CREDS, host }, { fetch: net.fetch, now: () => NOW });
    assertEquals(net.seen.length, 0, host);
    assertFalse(check.ok);
    assertEquals(check.stats, null);
  }
});

Deno.test("probe: the status mapping, and the body of a refused request is neither read nor returned", async () => {
  const table: [number, string][] = [
    [401, "unauthorized"],
    [403, "unauthorized"],
    [404, "not_found"],
    [429, "rate_limited"],
    [500, "server_error"],
    [503, "server_error"],
    [400, "bad_response"],
    [202, "bad_response"],
  ];
  for (const [status, code] of table) {
    let pulled = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new TextEncoder().encode('{"error":true,"message":"SENTINEL"}'));
      },
      cancel() {
        cancelled = true;
      },
    }, { highWaterMark: 0 });
    const statuses: number[] = [];
    const net = fakeFetch(() => new Response(body, { status }));
    const check = await probe(CREDS, { fetch: net.fetch, now: () => NOW, onStatus: (s) => statuses.push(s) });
    assertEquals(check, { ok: false, code: code as Check["code"], at: NOW_ISO, stats: null }, String(status));
    assertEquals(pulled, 0, String(status));
    assert(cancelled, String(status));
    assertEquals(statuses, [status]);
  }
});

Deno.test("probe: a 200 with a body of another shape is bad_response", async () => {
  for (
    const text of [
      "", "not json", "<html>SENTINEL</html>", "{}", '{"result":"success"}', '{"result":"success","message":"SENTINEL"}',
      '{"result":"success","message":{}}', '{"error":true,"message":"SENTINEL"}', '{"result":"failure","message":[]}',
    ]
  ) {
    const net = fakeFetch(() => new Response(text, { status: 200 }));
    assertEquals(await probe(CREDS, { fetch: net.fetch, now: () => NOW }), { ok: false, code: "bad_response", at: NOW_ISO, stats: null }, text);
  }
  const noBody = fakeFetch(() => new Response(null, { status: 200 }));
  assertEquals((await probe(CREDS, { fetch: noBody.fetch, now: () => NOW })).code, "bad_response");
});

Deno.test("probe: DNS, TLS and redirect failures are network, and the error text goes nowhere", async () => {
  for (
    const error of [
      new TypeError("error sending request: dns error SENTINEL"),
      new TypeError("invalid peer certificate SENTINEL"),
      new TypeError("Fetch failed: redirect SENTINEL"),
      new Error("SENTINEL"),
      "SENTINEL",
      null,
    ]
  ) {
    const check = await probe(CREDS, { fetch: () => Promise.reject(error), now: () => NOW });
    assertEquals(check, { ok: false, code: "network", at: NOW_ISO, stats: null });
  }
});

Deno.test("probe: an abort or a timeout error from fetch is timeout", async () => {
  for (
    const error of [
      new DOMException("aborted", "AbortError"),
      new DOMException("timed out", "TimeoutError"),
      Object.assign(new Error("x"), { name: "AbortError" }),
    ]
  ) {
    const check = await probe(CREDS, { fetch: () => Promise.reject(error), now: () => NOW });
    assertEquals(check, { ok: false, code: "timeout", at: NOW_ISO, stats: null });
  }
});

Deno.test("S4 probe: fetch that never answers ends at the deadline and the request is aborted", async () => {
  let signal: AbortSignal | undefined;
  const check = await probe(CREDS, {
    fetch: (_url, init) => {
      signal = init.signal ?? undefined;
      return new Promise<Response>(() => {});
    },
    now: () => NOW,
    timeoutMs: 5,
  });
  assertEquals(check, { ok: false, code: "timeout", at: NOW_ISO, stats: null });
  assert(signal?.aborted);
});

Deno.test("S4 probe: a body that stalls after the headers ends at the same deadline", async () => {
  let signal: AbortSignal | undefined;
  const stalled = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"result":"success",'));
    },
  });
  const check = await probe(CREDS, {
    fetch: (_url, init) => {
      signal = init.signal ?? undefined;
      return Promise.resolve(new Response(stalled, { status: 200 }));
    },
    now: () => NOW,
    timeoutMs: 5,
  });
  assertEquals(check, { ok: false, code: "timeout", at: NOW_ISO, stats: null });
  assert(signal?.aborted);
});

Deno.test("S4 probe: the deadline is 15 seconds by default, and it is cleared after an answer", async () => {
  assertEquals(PROBE_TIMEOUT_MS, 15_000);
  const delays: (number | undefined)[] = [];
  const cleared: unknown[] = [];
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  const marker = 424242;
  globalThis.setTimeout = ((_fn: () => void, ms?: number) => {
    delays.push(ms);
    return marker;
  }) as unknown as typeof globalThis.setTimeout;
  globalThis.clearTimeout = ((id?: number) => {
    cleared.push(id);
  }) as unknown as typeof globalThis.clearTimeout;
  try {
    const net = fakeFetch(() => success([]));
    assertEquals((await probe(CREDS, { fetch: net.fetch, now: () => NOW })).code, "ok");
  } finally {
    globalThis.setTimeout = realSet;
    globalThis.clearTimeout = realClear;
  }
  assertEquals(delays, [15_000]);
  assertEquals(cleared, [marker]);
});

Deno.test("S4 probe: a declared size over 20 MB is refused without reading", async () => {
  assertEquals(MAX_RESPONSE_BYTES, 20 * 1024 * 1024);
  let pulled = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled++;
      controller.close();
    },
    cancel() {
      cancelled = true;
    },
  }, { highWaterMark: 0 });
  const net = fakeFetch(() => new Response(body, { status: 200, headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) } }));
  assertEquals(await probe(CREDS, { fetch: net.fetch, now: () => NOW }), { ok: false, code: "bad_response", at: NOW_ISO, stats: null });
  assertEquals(pulled, 0);
  assert(cancelled);
});

Deno.test("S4 probe: a body that grows past 20 MB without declaring it is cut off", async () => {
  const chunk = new Uint8Array(1024 * 1024);
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++;
      controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  }, { highWaterMark: 0 });
  const net = fakeFetch(() => new Response(body, { status: 200 }));
  assertEquals(await probe(CREDS, { fetch: net.fetch, now: () => NOW }), { ok: false, code: "bad_response", at: NOW_ISO, stats: null });
  assert(cancelled);
  assertEquals(pulls, 21);
});

Deno.test("S4 probe: a body of exactly 20 MB is still read", async () => {
  const head = '{"result":"success","message":[{"state":"completed","duration":60}]}';
  const bytes = new Uint8Array(MAX_RESPONSE_BYTES).fill(0x20);
  bytes.set(new TextEncoder().encode(head));
  const net = fakeFetch(() => new Response(bytes, { status: 200 }));
  const check = await probe(CREDS, { fetch: net.fetch, now: () => NOW });
  assertEquals(check.code, "ok");
  assertEquals(check.stats?.talked, 1);
});

Deno.test("probe: a connection lost while reading is network; aborted while reading is timeout", async () => {
  const breaks = (error: unknown) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"result":'));
      },
      pull(controller) {
        controller.error(error);
      },
    });
  const lost = fakeFetch(() => new Response(breaks(new TypeError("connection reset SENTINEL")), { status: 200 }));
  assertEquals((await probe(CREDS, { fetch: lost.fetch, now: () => NOW })).code, "network");
  const aborted = fakeFetch(() => new Response(breaks(new DOMException("aborted", "AbortError")), { status: 200 }));
  assertEquals((await probe(CREDS, { fetch: aborted.fetch, now: () => NOW })).code, "timeout");
});

Deno.test("the request cap is 8 KB", () => {
  assertEquals(MAX_REQUEST_BYTES, 8 * 1024);
});
