// اختبارات وظيفة wa-triage بلا شبكة ولا مفتاح ولا قاعدة: handler(req, deps) بقاعدة مزيّفة في الذاكرة (ما تناديه
// الوظيفة من supabase-js فقط) و Jev مزيّف بردود مكتوبة. كل النصوص والأرقام مصطنعة (المستودع عام).
// التشغيل: deno test --allow-read --allow-env supabase/functions/wa-triage/
// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals, assertFalse } from "jsr:@std/assert@1";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { handler, safeErrorText } from "./index.ts";

/* ===================== قاعدة مزيّفة ===================== */

type Row = Record<string, any>;
interface DbError {
  code: string;
  message: string;
}

interface FakeOptions {
  users?: Record<string, string>; // رمز الجلسة → معرّف المستخدم
  profiles?: Row[];
  settings?: Record<string, unknown>; // crm_settings
  budget?: { spent_usd: number; cap_usd: number } | DbError;
  tickets?: Record<string, number> | DbError; // بصمة السر → العناصر الباقية
  triage?: Row[];
  fail?: Record<string, DbError>; // "الجدول:العملية" → خطأ
  explode?: boolean; // from() يرمي
}

const ADMIN = "admin-session";
const STAFF = "staff-session";
const BLOCKED = "blocked-session";
const ADMIN_ID = "00000000-0000-4000-8000-000000000001";

function fakeDb(o: FakeOptions) {
  const tables: Record<string, Row[]> = {
    profiles: o.profiles ?? [
      { id: ADMIN_ID, role: "admin", is_blocked: false },
      { id: "u-staff", role: "callcenter", is_blocked: false },
      { id: "u-blocked", role: "admin", is_blocked: true },
    ],
    crm_settings: Object.entries(o.settings ?? {}).map(([key, value]) => ({ key, value })),
    wa_triage: (o.triage ?? []).map((r) => structuredClone(r)),
    wa_triage_calls: [],
  };
  const ops: string[] = [];
  const rpcs: { fn: string; args: any }[] = [];
  let seq = 0;
  const stamp = () => new Date(Date.UTC(2026, 9, 2, 0, 0, seq++)).toISOString();
  const users = o.users ?? { [ADMIN]: ADMIN_ID, [STAFF]: "u-staff", [BLOCKED]: "u-blocked" };

  class Query {
    op = "select";
    payload: any;
    options: any;
    filters: ((r: Row) => boolean)[] = [];
    sort: { col: string; ascending: boolean } | null = null;
    max: number | null = null;
    single = false;
    returning = false;
    constructor(readonly table: string) {}
    select(_cols?: string) {
      if (this.op !== "select") this.returning = true;
      return this;
    }
    insert(row: any) {
      this.op = "insert";
      this.payload = row;
      return this;
    }
    update(patch: any) {
      this.op = "update";
      this.payload = patch;
      return this;
    }
    upsert(rows: any, options: any) {
      this.op = "upsert";
      this.payload = rows;
      this.options = options;
      return this;
    }
    eq(col: string, value: unknown) {
      this.filters.push((r) => r[col] === value);
      return this;
    }
    in(col: string, values: unknown[]) {
      this.filters.push((r) => values.includes(r[col]));
      return this;
    }
    order(col: string, opts: { ascending: boolean }) {
      this.sort = { col, ascending: opts.ascending };
      return this;
    }
    limit(n: number) {
      this.max = n;
      return this;
    }
    maybeSingle() {
      this.single = true;
      return this;
    }
    // يُنتظر كما يُنتظر منشئ استعلام supabase-js
    then(resolve: (v: any) => unknown, reject: (e: unknown) => unknown) {
      return Promise.resolve().then(() => this.run()).then(resolve, reject);
    }
    run(): { data: any; error: DbError | null } {
      ops.push(`${this.table}:${this.op}`);
      const err = o.fail?.[`${this.table}:${this.op}`];
      if (err) return { data: null, error: err };
      const rows = tables[this.table] ??= [];
      const match = (r: Row) => this.filters.every((f) => f(r));
      if (this.op === "select") {
        let out = rows.filter(match);
        if (this.sort) {
          const { col, ascending } = this.sort;
          out = [...out].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (ascending ? 1 : -1));
        }
        if (this.max !== null) out = out.slice(0, this.max);
        out = out.map((r) => structuredClone(r));
        return { data: this.single ? out[0] ?? null : out, error: null };
      }
      if (this.op === "insert") {
        for (const r of [this.payload].flat()) rows.push({ created_at: stamp(), ...structuredClone(r) });
        return { data: null, error: null };
      }
      if (this.op === "update") {
        const hit = rows.filter(match);
        for (const r of hit) Object.assign(r, structuredClone(this.payload));
        return { data: this.returning ? hit.map((r) => structuredClone(r)) : null, error: null };
      }
      // upsert: ON CONFLICT (onConflict) DO NOTHING حين ignoreDuplicates، ويعيد ما أُدرج فقط
      const cols = String(this.options?.onConflict ?? "").split(",").map((c) => c.trim());
      const inserted: Row[] = [];
      for (const r of [this.payload].flat()) {
        const old = rows.find((x) => cols.every((c) => x[c] === r[c]));
        if (old) {
          if (!this.options?.ignoreDuplicates) Object.assign(old, structuredClone(r));
        } else {
          const row = { created_at: stamp(), owner_label: null, ...structuredClone(r) };
          rows.push(row);
          inserted.push(row);
        }
      }
      return { data: this.returning ? inserted.map((r) => structuredClone(r)) : null, error: null };
    }
  }

  const rpc = (fn: string, args: any = {}) => {
    rpcs.push({ fn, args });
    ops.push(`rpc:${fn}`);
    if (fn === "wa_triage_budget") {
      const b = o.budget ?? { spent_usd: 0.01, cap_usd: 0.5 };
      return Promise.resolve("code" in b ? { data: null, error: b } : { data: { ...b }, error: null });
    }
    if (fn === "wa_triage_take_ticket") {
      const t = o.tickets ?? {};
      if ("code" in t && typeof t.code === "string") return Promise.resolve({ data: null, error: t as DbError });
      const left = (t as Record<string, number>)[args.p_hash];
      // كما في 026: السالب مرفوض، والصفر يتحقق من التذكرة ولا يحجز منها شيئاً
      if (left === undefined || args.p_items < 0 || args.p_items > left) {
        return Promise.resolve({ data: { ok: false, code: "ticket_invalid" }, error: null });
      }
      (t as Record<string, number>)[args.p_hash] = left - args.p_items;
      return Promise.resolve({ data: { ok: true, remaining: left - args.p_items }, error: null });
    }
    return Promise.resolve({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
  };

  return {
    tables,
    ops,
    rpcs,
    rpc,
    from(table: string) {
      if (o.explode) throw new Error("socket hang up at select * from wa_triage");
      return new Query(table);
    },
    auth: {
      getUser: (token: string) =>
        Promise.resolve(
          users[token]
            ? { data: { user: { id: users[token] } }, error: null }
            : { data: { user: null }, error: { message: "invalid JWT" } },
        ),
    },
  };
}

/* ===================== Jev مزيّف ===================== */

type Script = (body: any) => { status: number; body?: unknown };

const choice = (c: string, confidence: number | null, probabilities?: Record<string, number>) =>
  ({ type: "choice", choice: c, ...(confidence === null ? {} : { confidence }), ...(probabilities ? { probabilities } : {}) });

// نية الرسالة من كلماتها، وحي الرسالة أول مرشّح في سؤال الحي إن طُرح
function reply(body: any, intent: string, conf: number, extra: Record<string, unknown> = {}) {
  const district = body.questions.district ? { district: choice(Object.keys(body.questions.district.criteria)[0], 0.85) } : {};
  return {
    status: 200,
    body: {
      id: "gen-dec-test",
      model: "typesafe/jev-1.13-20260917",
      provider: "TypeSafe",
      answers: {
        intent: choice(intent, conf, { [intent]: conf, other: Math.round((1 - conf) * 100) / 100 }),
        kind: choice("apartment", 0.7, { apartment: 0.8, villa: 0.15, land: 0.05 }),
        city: choice("jeddah", 0.8),
        ...district,
        multiple: { type: "noul", noul: 0.1 },
        ...extra,
      },
      usage: { input_tokens: 500, output_tokens: 60, cost: 0.000021 },
    },
  };
}

const defaultScript: Script = (body) => {
  const m: string = body.state.message;
  if (m.includes("للبيع")) return reply(body, "sale_offer", 0.92);
  if (m.includes("مطلوب")) return reply(body, "wanted", 0.95);
  if (m.includes("للإيجار")) return reply(body, "rent_offer", 0.9);
  if (m.includes("صباح")) return reply(body, "not_property", 0.97);
  return reply(body, "other", 0.4);
};

function jevFetch(script: Script, seen: any[]): typeof fetch {
  return ((_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    seen.push(body);
    const r = script(body);
    return Promise.resolve(new Response(JSON.stringify(r.body ?? {}), { status: r.status }));
  }) as typeof fetch;
}

/* ===================== أدوات ===================== */

const URL_ = "http://localhost/functions/v1/wa-triage";

function post(body: unknown, headers: Record<string, string> = { Authorization: `Bearer ${ADMIN}` }) {
  return new Request(URL_, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function setup(
  o: FakeOptions & { env?: Record<string, string>; script?: Script; fetchImpl?: typeof fetch; now?: () => number } = {},
) {
  const db = fakeDb(o);
  const seen: any[] = [];
  const vars = o.env ?? { OPENROUTER_API_KEY: "or-test-key" };
  const deps = {
    db: db as unknown as SupabaseClient,
    env: (name: string) => vars[name],
    fetchImpl: o.fetchImpl ?? jevFetch(o.script ?? defaultScript, seen),
    sleep: () => Promise.resolve(),
    now: o.now,
  };
  const call = async (req: Request) => {
    const res = await handler(req, deps);
    return { status: res.status, body: await res.json() as any, text: "" };
  };
  return { db, deps, seen, call };
}

const item = (ref: string, text: string, extra: Record<string, unknown> = {}) => ({ ref, text, group: "عروض جدة", regex_kind: "offer", ...extra });
const triage = (items: unknown[], extra: Record<string, unknown> = {}) => post({ action: "triage", items, ...extra });

/* ===================== الدخول ===================== */

Deno.test("wa-triage: OPTIONS answers with CORS; anything but POST is 405", async () => {
  const { deps } = setup();
  const pre = await handler(new Request(URL_, { method: "OPTIONS" }), deps);
  assertEquals([pre.status, await pre.text(), pre.headers.get("Access-Control-Allow-Origin")], [200, "ok", "*"]);
  assertEquals(pre.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
  const get = await handler(new Request(URL_, { method: "GET" }), deps);
  assertEquals([get.status, await get.json()], [405, { status: "error", message: "طلب غير مدعوم" }]);
});

// جسم يسجّل أي قراءة له، ولو من نسخة (clone): لا يُسحب منه شيء ما لم يُطلب
function watchedPost(body: unknown, headers: Record<string, string>, pulled: { value: boolean }) {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      pulled.value = true;
      c.enqueue(bytes);
      c.close();
    },
  }, { highWaterMark: 0 });
  return new Request(URL_, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: stream });
}

Deno.test("wa-triage: the caller is checked before the body is read — no token or a bad one 401, not an active admin 403", async () => {
  const cases: [Record<string, string>, number, string][] = [
    [{}, 401, "غير مصرح"],
    [{ Authorization: "Bearer not-a-session" }, 401, "غير مصرح"],
    [{ Authorization: `Bearer ${STAFF}` }, 403, "هذه العملية للمدير فقط"],
    [{ Authorization: `Bearer ${BLOCKED}` }, 403, "هذه العملية للمدير فقط"],
  ];
  for (const [headers, status, message] of cases) {
    const { call, db, seen } = setup();
    const pulled = { value: false };
    const req = watchedPost({ action: "triage", items: [item("r1", "شقة للبيع")] }, headers, pulled);
    const res = await call(req);
    assertEquals([res.status, res.body], [status, { status: "error", message }]);
    assertFalse(req.bodyUsed || pulled.value, "the body was read before the caller was checked");
    assertEquals([seen.length, db.tables.wa_triage_calls.length, db.rpcs.length], [0, 0, 0]);
  }
  // المدير يُقرأ جسمه بعد التحقق
  const pulled = { value: false };
  const ok = await setup().call(watchedPost({ action: "status" }, { Authorization: `Bearer ${ADMIN}` }, pulled));
  assertEquals([ok.status, ok.body.status, pulled.value], [200, "success", true]);
  // مدير بلا ملف
  const { call } = setup({ profiles: [] });
  assertEquals((await call(post({ action: "status" }))).status, 403);
});

Deno.test("wa-triage: an unknown action is refused; an unexpected failure is «خطأ داخلي» without its text", async () => {
  const { call } = setup();
  assertEquals((await call(post({ action: "delete_all" }))).body, { status: "error", message: "إجراء غير معروف" });
  assertEquals((await call(post("not an object"))).body.message, "إجراء غير معروف");
  const boom = setup({ explode: true });
  const res = await boom.call(post({ action: "label", key: "a".repeat(64), label: "other" }));
  assertEquals([res.status, res.body], [500, { status: "error", message: "خطأ داخلي" }]);
});

/* ===================== status ===================== */

Deno.test("wa-triage status: enabled with the key and the mode; the model, qset, today's spend and cap", async () => {
  const { call } = setup({ settings: { wa_triage_mode: "preselect" }, budget: { spent_usd: 0.0123456789, cap_usd: 0.5 } });
  assertEquals((await call(post({ action: "status" }))).body, {
    status: "success", enabled: true, mode: "preselect", model: "typesafe/jev-1.13", qset: "wa-1",
    spent_today_usd: 0.012346, cap_usd: 0.5, message: null,
  });
  const custom = setup({ env: { OPENROUTER_API_KEY: "k", AGENT_TRIAGE_MODEL: "typesafe/jev-1.14" } });
  const body = (await custom.call(post({ action: "status" }))).body;
  // صف الوضع غائب = suggest
  assertEquals([body.enabled, body.mode, body.model], [true, "suggest", "typesafe/jev-1.14"]);
});

Deno.test("wa-triage status: never fails — no key, mode off, migration missing or unreadable settings give enabled:false in Arabic", async () => {
  const status = async (o: Parameters<typeof setup>[0]) => {
    const res = await setup(o).call(post({ action: "status" }));
    assertEquals(res.status, 200);
    assertEquals(res.body.status, "success");
    return res.body;
  };
  const noKey = await status({ env: {} });
  assertEquals([noKey.enabled, noKey.mode], [false, "suggest"]);
  assert(noKey.message.includes("OPENROUTER_API_KEY"), noKey.message);
  const off = await status({ settings: { wa_triage_mode: "off" } });
  assertEquals([off.enabled, off.mode, off.message], [false, "off", "فرز Jev متوقف"]);
  const notReady = await status({ budget: { code: "PGRST202", message: "Could not find the function public.wa_triage_budget" } });
  assertEquals(notReady.enabled, false);
  assert(notReady.message.includes("026_wa_triage"), notReady.message);
  const old = await status({ budget: { code: "42883", message: "function does not exist" } });
  assertEquals(old.enabled, false);
  const unreadable = await status({ fail: { "crm_settings:select": { code: "57014", message: "canceling statement due to timeout" } } });
  assertEquals([unreadable.enabled, unreadable.message], [false, "تعذّر قراءة إعدادات فرز Jev"]);
  // تعذّر قراءة الإنفاق وحده لا يوقف الفرز
  const noBudget = await status({ budget: { code: "08006", message: "connection failure" } });
  assertEquals([noBudget.enabled, noBudget.spent_today_usd, noBudget.cap_usd], [true, null, null]);
  // قيمة وضع غير معروفة = suggest
  assertEquals((await status({ settings: { wa_triage_mode: "turbo" } })).mode, "suggest");
});

/* ===================== triage: التحقق والتخطي ===================== */

Deno.test("wa-triage triage: 1..25 items with a ref and a text; page callers cannot pick a qset or send an override", async () => {
  const cases: [unknown, number, string][] = [
    [{ action: "triage", items: [] }, 400, "عدد العناصر غير صالح"],
    [{ action: "triage" }, 400, "عدد العناصر غير صالح"],
    [{ action: "triage", items: Array.from({ length: 26 }, (_, i) => item(`r${i}`, `شقة للبيع ${i}`)) }, 400, "عدد العناصر غير صالح"],
    [{ action: "triage", items: [{ text: "شقة للبيع" }] }, 400, "عنصر غير صالح"],
    [{ action: "triage", items: [{ ref: "r1", text: 5 }] }, 400, "عنصر غير صالح"],
    [{ action: "triage", items: ["شقة"] }, 400, "عنصر غير صالح"],
    [{ action: "triage", items: [item("r1", "أ"), item("r1", "ب")] }, 400, "عنصر غير صالح"],
    [{ action: "triage", items: [item("x".repeat(201), "أ")] }, 400, "عنصر غير صالح"],
    [{ action: "triage", qset: "wa-1-ar", items: [item("r1", "أ")] }, 403, "غير مسموح"],
    [{ action: "triage", override: { name: "x" }, items: [item("r1", "أ")] }, 403, "غير مسموح"],
  ];
  for (const [body, status, message] of cases) {
    const { call, seen, db } = setup();
    const res = await call(post(body));
    assertEquals([res.status, res.body], [status, { status: "error", message }], JSON.stringify(body).slice(0, 80));
    assertEquals([seen.length, db.tables.wa_triage_calls.length], [0, 0]);
  }
  // الصفحة تذكر المجموعة الافتراضية صراحة: مقبول
  const { call } = setup();
  assertEquals((await call(triage([item("r1", "شقة للبيع")], { qset: "wa-1" }))).body.status, "success");
});

Deno.test("wa-triage triage: mode off, no key or today's cap reached → skipped, no Jev call, one calls row", async () => {
  const cases: [Parameters<typeof setup>[0], string, string][] = [
    [{ settings: { wa_triage_mode: "off" } }, "فرز Jev متوقف", "skipped: mode_off"],
    [{ env: {} }, "فرز Jev غير مفعّل — لم يُضبط السر OPENROUTER_API_KEY في أسرار Supabase بعد.", "skipped: disabled"],
    [{ budget: { spent_usd: 0.5, cap_usd: 0.5 } }, "بلغ فرز Jev سقفه اليومي", "skipped: budget_reached"],
  ];
  for (const [o, message, logged] of cases) {
    const { call, seen, db } = setup(o);
    const res = await call(triage([item("r1", "شقة للبيع في الروضة")]));
    assertEquals([res.status, res.body], [200, { status: "skipped", message }]);
    assertEquals(seen.length, 0);
    assertEquals(db.tables.wa_triage.length, 0);
    assertEquals(db.tables.wa_triage_calls.length, 1);
    assertEquals(db.tables.wa_triage_calls[0].error, logged);
    assertEquals([db.tables.wa_triage_calls[0].purpose, db.tables.wa_triage_calls[0].jev_calls], ["page", 0]);
  }
  // الترحيل غائب: تخطٍّ برسالة، ولا كتابة
  const { call, db } = setup({ budget: { code: "PGRST202", message: "Could not find the function" } });
  const res = await call(triage([item("r1", "شقة للبيع")]));
  assertEquals(res.body.status, "skipped");
  assert(res.body.message.includes("026_wa_triage"));
  assertEquals(db.ops.filter((op) => op.startsWith("wa_triage")), []);
  // الإعدادات لا تُقرأ: خطأ عربي بلا نص القاعدة
  const broken = setup({ fail: { "crm_settings:select": { code: "XX000", message: "relation crm_settings is broken" } } });
  const err = await broken.call(triage([item("r1", "شقة للبيع")]));
  assertEquals([err.status, err.body], [500, { status: "error", message: "تعذّر قراءة إعدادات فرز Jev" }]);
});

/* ===================== triage: Jev والحكم والذاكرة ===================== */

Deno.test("wa-triage triage: only the redacted block text and the group reach Jev — no sender, phone or e-mail", async () => {
  const { call, seen, db } = setup();
  const text = "فيلا للبيع في حي السامر\nللتواصل 0551234567 أو sales@example.com";
  const res = await call(triage([{ ref: "r1", text, group: "عروض 0559876543", regex_kind: "offer", sender: "+966 55 000 0001" }]));
  assertEquals(res.body.items[0].verdict, "send");
  assertEquals(seen.length, 1);
  assertEquals(seen[0].state, { message: "فيلا للبيع في حي السامر\nللتواصل [PHONE_1] أو [EMAIL_1]", group: "عروض [PHONE_2]" });
  const sent = JSON.stringify(seen[0]);
  for (const secret of ["0551234567", "sales@example.com", "0559876543", "000 0001", "or-test-key"]) assertFalse(sent.includes(secret), secret);
  assertEquals(Object.keys(seen[0].questions), ["intent", "kind", "city", "district", "multiple"]);
  assertEquals(seen[0].provider, { only: ["typesafe"], allow_fallbacks: false, data_collection: "deny" });
  // القاعدة لا تحفظ النص ولا الجوال
  const stored = JSON.stringify(db.tables);
  for (const secret of ["0551234567", "sales@example.com", "للتواصل", "فيلا للبيع"]) assertFalse(stored.includes(secret), secret);
});

Deno.test("wa-triage triage: a verdict per ref in order, keyed by sha256 of the trimmed text; rows cached without text; one calls row", async () => {
  const { call, db, seen } = setup({ budget: { spent_usd: 0.1, cap_usd: 0.5 } });
  const shaA = "a".repeat(64);
  const res = await call(triage([
    item("r1", "  شقة للبيع في حي المروه بسعر 850 ألف  ", { source_shas: [shaA, "not-a-sha", shaA] }),
    item("r2", "مطلوب فيلا في أبحر الشمالية", { regex_kind: "wanted" }),
    item("r3", "صباح الخير يا شباب", { regex_kind: "other" }),
    item("r4", "شقة للإيجار في الصفا"),
    item("r5", "   "),
  ]));
  assertEquals(res.status, 200);
  const body = res.body;
  assertEquals([body.status, body.model, body.qset], ["success", "typesafe/jev-1.13-20260917", "wa-1"]);
  assertEquals(body.items.map((i: any) => i.ref), ["r1", "r2", "r3", "r4", "r5"]);
  const key1 = await sha256Hex("شقة للبيع في حي المروه بسعر 850 ألف");
  assertEquals(body.items[0], {
    ref: "r1", key: key1, ok: true, cached: false, verdict: "send", reasons: ["sale_offer"], truncated: false,
    intent: { choice: "sale_offer", confidence: 0.92 }, kind: { choice: "apartment", confidence: 0.7 },
    city: { choice: "jeddah", confidence: 0.8 }, district: { choice: "المروة", confidence: 0.85 }, multiple: 0.1, owner_label: null,
  });
  assertEquals([body.items[1].verdict, body.items[1].reasons], ["skip", ["wanted"]]);
  assertEquals([body.items[2].verdict, body.items[2].reasons], ["skip", ["not_property"]]);
  // بلا حي في الرسالة: الحي not_stated بالكود، بلا سؤال
  assertEquals(body.items[2].district, { choice: "not_stated", confidence: null });
  assertEquals([body.items[3].verdict, body.items[3].reasons], ["skip", ["rent"]]);
  assertEquals(body.items[4], { ref: "r5", key: await sha256Hex(""), ok: false, error: "empty" });
  assertEquals(seen.length, 4);
  assertEquals(body.usage, { jev_calls: 4, cached: 0, errors: 1, input_tokens: 2000, cost_usd: 0.000084 });
  assertEquals([body.spent_today_usd, body.cap_usd], [0.100084, 0.5]);

  // الأحكام محفوظة بلا نص: البصمة والتسميات والاحتمالات
  assertEquals(db.tables.wa_triage.length, 4);
  const row = db.tables.wa_triage.find((r) => r.key === key1)!;
  assertEquals(row.qset, "wa-1");
  assertEquals([row.model, row.verdict, row.reasons, row.regex_kind, row.source_shas], [
    "typesafe/jev-1.13-20260917", "send", ["sale_offer"], "offer", [shaA],
  ]);
  assertEquals([row.input_tokens, row.cost_usd, row.created_by], [500, 0.000021, ADMIN_ID]);
  assertEquals(row.answers.intent, { choice: "sale_offer", confidence: 0.92, probabilities: { sale_offer: 0.92, other: 0.08 } });
  assertEquals(row.answers.kind, { choice: "apartment", confidence: 0.7, top: [["apartment", 0.8], ["villa", 0.15], ["land", 0.05]] });
  assertEquals(row.answers.district, { choice: "المروة", confidence: 0.85, top: [] });
  assertEquals(row.answers.multiple, { noul: 0.1 });
  assertFalse("truncated" in row.answers);
  const stored = JSON.stringify(db.tables.wa_triage);
  for (const words of ["للبيع", "بسعر", "مطلوب", "صباح الخير", "للإيجار", "عروض جدة"]) assertFalse(stored.includes(words), words);

  // سطر نداء واحد
  assertEquals(db.tables.wa_triage_calls.length, 1);
  const logged = db.tables.wa_triage_calls[0];
  assertEquals(
    [logged.purpose, logged.requested_by, logged.items, logged.jev_calls, logged.cached, logged.errors, logged.input_tokens],
    ["page", ADMIN_ID, 5, 4, 0, 1, 2000],
  );
  assertEquals([logged.cost_usd, logged.model, logged.provider, logged.error], [0.000084, "typesafe/jev-1.13-20260917", "TypeSafe", "empty"]);
  assert(Number.isInteger(logged.duration_ms) && logged.duration_ms >= 0);
  // لا كتابة إلا في جدولي الفرز
  assertEquals(new Set(db.ops), new Set(["profiles:select", "crm_settings:select", "rpc:wa_triage_budget", "wa_triage:select", "wa_triage:upsert", "wa_triage_calls:insert"]));
});

Deno.test("wa-triage triage: a cached verdict comes back without a Jev call, with the owner's label; new copies' shas are merged", async () => {
  const text = "شقة للبيع في حي الصفا";
  const key = await sha256Hex(text);
  const shaA = "a".repeat(64), shaB = "b".repeat(64);
  const answers = {
    intent: { choice: "sale_offer", confidence: 0.7, probabilities: { sale_offer: 0.76, other: 0.24 } },
    city: { choice: "not_stated", confidence: 0.5, probabilities: null },
    kind: { choice: "apartment", confidence: 0.9, top: [["apartment", 0.92]] },
    district: { choice: "الصفا", confidence: 0.9, top: [["الصفا", 0.95], ["none", 0.05]] },
    multiple: { noul: 0.2 },
    truncated: true,
  };
  const cachedRow = {
    key, qset: "wa-1", model: "typesafe/jev-1.13-20260901", verdict: "review", reasons: ["low_confidence"], answers,
    regex_kind: "offer", source_shas: [shaA], owner_label: "sale_offer", created_at: "2026-10-01T00:00:00.000Z",
  };
  const otherQset = { ...cachedRow, qset: "wa-0", verdict: "skip", owner_label: null };
  const { call, seen, db } = setup({ triage: [cachedRow, otherQset] });
  const res = await call(triage([item("r1", text, { source_shas: [shaA, shaB] })]));
  assertEquals(seen.length, 0);
  assertEquals(res.body.items[0], {
    ref: "r1", key, ok: true, cached: true, verdict: "review", reasons: ["low_confidence"], truncated: true,
    intent: { choice: "sale_offer", confidence: 0.7 }, kind: { choice: "apartment", confidence: 0.9 },
    city: { choice: "not_stated", confidence: 0.5 }, district: { choice: "الصفا", confidence: 0.9 }, multiple: 0.2,
    owner_label: "sale_offer",
  });
  assertEquals(res.body.usage, { jev_calls: 0, cached: 1, errors: 0, input_tokens: 0, cost_usd: 0 });
  // البصمة الجديدة دُمجت في صف wa-1 وحده، والحكم المحفوظ لم يتغير
  const rows = db.tables.wa_triage;
  assertEquals(rows.find((r) => r.qset === "wa-1")!.source_shas, [shaA, shaB]);
  assertEquals(rows.find((r) => r.qset === "wa-1")!.verdict, "review");
  assertEquals(rows.find((r) => r.qset === "wa-0")!.source_shas, [shaA]);
  assertEquals(db.tables.wa_triage_calls[0].cached, 1);
  // بلا بصمة جديدة: لا كتابة
  const again = setup({ triage: [cachedRow] });
  await again.call(triage([item("r1", text, { source_shas: [shaA] })]));
  assertFalse(again.db.ops.includes("wa_triage:update"));
});

Deno.test("wa-triage triage: the same text twice in one page call is asked once and answered for both refs", async () => {
  const { call, seen, db } = setup();
  const res = await call(triage([
    item("r1", "شقة للبيع في النعيم", { source_shas: ["1".repeat(64)] }),
    item("r2", "شقة للبيع في النعيم ", { source_shas: ["2".repeat(64)] }),
  ]));
  assertEquals(seen.length, 1);
  assertEquals(res.body.items.map((i: any) => [i.ref, i.verdict]), [["r1", "send"], ["r2", "send"]]);
  assertEquals(res.body.items[0].key, res.body.items[1].key);
  assertEquals(db.tables.wa_triage.length, 1);
  assertEquals(db.tables.wa_triage[0].source_shas, ["1".repeat(64), "2".repeat(64)]);
});

Deno.test("wa-triage triage: a document-only block is review «document_only» by code — cached with model «code», no Jev call", async () => {
  const { call, seen, db, deps } = setup();
  const doc = item("d1", "بروشور المشروع.pdf • 12 صفحة", { regex_kind: "document" });
  const first = (await call(triage([doc]))).body.items[0];
  assertEquals(seen.length, 0);
  assertEquals(first, {
    ref: "d1", key: first.key, ok: true, cached: false, verdict: "review", reasons: ["document_only"], truncated: false,
    intent: null, kind: null, city: null, district: null, multiple: null, owner_label: null,
  });
  assertEquals(db.tables.wa_triage.length, 1);
  assertEquals([db.tables.wa_triage[0].model, db.tables.wa_triage[0].cost_usd, db.tables.wa_triage[0].input_tokens], ["code", null, null]);
  assertEquals(db.tables.wa_triage[0].answers, { intent: null, city: null, kind: null, district: null, multiple: null });
  // المرة الثانية من الذاكرة
  const second = await handler(triage([doc]), deps);
  const again = (await second.json()).items[0];
  assertEquals([again.cached, again.verdict, again.reasons], [true, "review", ["document_only"]]);
});

Deno.test("wa-triage triage: a failed Jev call fails its item only — nothing cached for it, and no provider text returned", async () => {
  let busy = 0;
  const script: Script = (body) => {
    const m: string = body.state.message;
    if (m.includes("تعطّل")) {
      return {
        status: 400,
        body: { error: { code: 400, message: "Provider returned error", metadata: { provider_name: "TypeSafe", raw: '{"input":"تعطّل 0551234567"}' } } },
      };
    }
    if (m.includes("مشغول")) {
      busy++;
      return { status: 503, body: { error: { message: "Service temporarily unavailable" } } };
    }
    return defaultScript(body);
  };
  const { call, db } = setup({ script });
  const res = await call(triage([
    item("ok", "شقة للبيع في الربوة"),
    item("bad", "عرض تعطّل نصه"),
    item("busy", "الخادم مشغول الآن"),
  ]));
  assertEquals(res.status, 200);
  const [ok, bad, slow] = res.body.items;
  assertEquals([ok.ok, ok.verdict], [true, "send"]);
  assertEquals([bad.ok, bad.error, slow.ok, slow.error], [false, "bad_request", false, "server"]);
  assertEquals(busy, 2); // إعادة واحدة
  assertEquals(db.tables.wa_triage.map((r) => r.key), [ok.key]);
  assertEquals([res.body.usage.jev_calls, res.body.usage.errors], [3, 2]);
  const text = JSON.stringify(res.body);
  assertFalse(text.includes("Provider returned error") || text.includes("unavailable") || text.includes("0551234567"));
  // السجل: الأنواع ونص المزوّد بلا عربية ولا جوال
  const logged = db.tables.wa_triage_calls[0].error as string;
  assert(logged.includes("bad_request 400") && logged.includes("server 503"), logged);
  assertFalse(/[؀-ۿ]/.test(logged) || logged.includes("0551234567"), logged);
  const single = setup({ script });
  await single.call(triage([item("bad", "عرض تعطّل نصه")]));
  assertEquals(single.db.tables.wa_triage_calls[0].error, "bad_request 400: TypeSafe: Provider returned error");
});

Deno.test("wa-triage triage: an answer without a usable intent is review «error» and is not cached", async () => {
  const script: Script = (body) => reply(body, "sale_offer", 0.9, { intent: { type: "choice", choice: "buy_now", confidence: 0.99 } });
  const { call, db } = setup({ script });
  const res = await call(triage([item("r1", "شقة للبيع في البوادي")]));
  const r = res.body.items[0];
  assertEquals([r.ok, r.verdict, r.reasons, r.intent], [true, "review", ["error"], null]);
  assertEquals(db.tables.wa_triage.length, 0);
});

Deno.test("wa-triage triage: missing confidence is derived from the probabilities over the question's options", async () => {
  const script: Script = (body) =>
    reply(body, "sale_offer", 0.9, {
      intent: { type: "choice", choice: "sale_offer", probabilities: { sale_offer: 0.9, status_update: 0.06, other: 0.04 } },
      city: { type: "choice", choice: "makkah", probabilities: { makkah: 0.7, jeddah: 0.3 } },
    });
  const { call } = setup({ script });
  const r = (await call(triage([item("r1", "شقة للبيع قرب الحرم")]))).body.items[0];
  // النية: 6 خيارات → (6×0.9 − 1)/5 = 0.88؛ المدينة: 6 خيارات → (6×0.7 − 1)/5 = 0.64 ≥ 0.6 → خارج جدة
  assertEquals(Math.round(r.intent.confidence * 1e9) / 1e9, 0.88);
  assertEquals(Math.round(r.city.confidence * 1e9) / 1e9, 0.64);
  assertEquals([r.verdict, r.reasons], ["review", ["outside_jeddah"]]);
});

Deno.test("wa-triage triage: at most 6 Jev calls at once; none starts after 50 s; the unstarted are «deadline»", async () => {
  let clock = 1_000_000;
  let inFlight = 0, most = 0, calls = 0;
  const slow = (async (_url: string, init?: RequestInit) => {
    calls++;
    inFlight++;
    most = Math.max(most, inFlight);
    clock += 9_000; // كل نداء يقدّم الساعة 9 ث حين يبدأ: السادس يبدأ عند 45 ث، والسابع يجدها 54 ث
    await new Promise((r) => setTimeout(r, 2));
    inFlight--;
    const body = JSON.parse(String(init?.body));
    const r = defaultScript(body);
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
  const { call, db } = setup({ fetchImpl: slow, now: () => clock });
  const items = Array.from({ length: 25 }, (_, i) => item(`r${i}`, `شقة للبيع رقم ${i} في الروضة`));
  const res = await call(triage(items));
  assertEquals([most, calls], [6, 6]);
  const late = res.body.items.filter((i: any) => !i.ok);
  assertEquals(late.length, 19);
  assert(late.every((i: any) => i.error === "deadline" && typeof i.key === "string"));
  assertEquals([res.body.usage.jev_calls, res.body.usage.errors], [6, 19]);
  assertEquals(db.tables.wa_triage.length, 6);
  assert(String(db.tables.wa_triage_calls[0].error).includes("deadline ×19"));
});

Deno.test("wa-triage triage: 25 items are asked six at a time — never more in flight, all answered within the time", async () => {
  let inFlight = 0, most = 0, calls = 0;
  const slow = (async (_url: string, init?: RequestInit) => {
    calls++;
    inFlight++;
    most = Math.max(most, inFlight);
    await new Promise((r) => setTimeout(r, 3));
    inFlight--;
    const r = defaultScript(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
  const { call } = setup({ fetchImpl: slow });
  const res = await call(triage(Array.from({ length: 25 }, (_, i) => item(`r${i}`, `شقة للبيع رقم ${i} في النسيم`))));
  assertEquals([most, calls], [6, 25]);
  assert(res.body.items.every((i: any) => i.ok && i.verdict === "send"));
});

Deno.test("wa-triage triage: a text over 20000 characters is cut before hashing; over 6000 it reaches Jev truncated", async () => {
  const { call, seen, db } = setup();
  const text = "شقة للبيع في حي الشاطئ " + "ب".repeat(25_000);
  const r = (await call(triage([item("r1", text)]))).body.items[0];
  assertEquals(r.key, await sha256Hex(text.slice(0, 20_000).trim()));
  assertEquals(r.truncated, true);
  assertEquals(seen[0].state.message.length, 6000);
  assertEquals(db.tables.wa_triage[0].answers.truncated, true);
});

Deno.test("wa-triage triage: a long run of e-mail characters is cut before redaction — fast, keyed on the original, marked truncated", async () => {
  const { call, seen, db } = setup();
  const text = "شقة للبيع في حي الصفا\n" + "1.".repeat(9_000) + "\nللتواصل sales@example.com";
  const r = (await call(triage([item("r1", text)]))).body.items[0];
  assertEquals(r.key, await sha256Hex(text));
  // السلسلة مقصورة على 64 حرفاً (وأرقامها x)، والبريد بعدها مخفي
  assertEquals(seen[0].state.message, "شقة للبيع في حي الصفا\n" + "x.".repeat(32) + "\nللتواصل [EMAIL_1]");
  assertEquals([r.ok, r.truncated, db.tables.wa_triage[0].answers.truncated], [true, true, true]);
  // نمط البريد في Redactor تربيعي على سلسلة بلا @: 25 عنصراً كهذا كانت تأخذ نحو 27 ث من المعالج (الحد 2 ث)
  const many = setup();
  const started = performance.now();
  const res = await many.call(triage(Array.from({ length: 25 }, (_, i) => item(`r${i}`, `${i}|` + "1.".repeat(9_990)))));
  const ms = performance.now() - started;
  assertEquals([res.status, res.body.items.filter((x: any) => x.ok).length], [200, 25]);
  assert(ms < 2_000, `25 long-run items took ${Math.round(ms)} ms`);
});

/* ===================== التقييم بتذكرة ===================== */

Deno.test("wa-triage eval: the ticket's sha256 is checked, then reserves the items; probabilities come back; no cache read or write", async () => {
  const token = "tkt_synthetic_token_0123456789";
  const hash = await sha256Hex(token);
  const text = "شقة للبيع في حي الصفا";
  const cachedRow = {
    key: await sha256Hex(text), qset: "wa-1-ar", model: "m", verdict: "skip", reasons: ["not_property"],
    answers: {}, source_shas: [], owner_label: null, created_at: "2026-10-01T00:00:00.000Z",
  };
  // سقف اليوم بلغ حدّه: لا يوقف التقييم
  const tickets = { [hash]: 30 };
  const { call, db, seen } = setup({ tickets, triage: [cachedRow], budget: { spent_usd: 1, cap_usd: 0.5 } });
  const req = post(
    { action: "triage", qset: "wa-1-ar", items: [{ ref: "e1", text, group: "مجموعة", regex_kind: "offer" }, { ref: "e2", text: "مطلوب أرض" }] },
    { "x-triage-ticket": token, Authorization: "Bearer anon-jwt" },
  );
  const res = await call(req);
  assertEquals(res.status, 200);
  // تحقق بلا حجز (p_items = 0) قبل قراءة الجسم، ثم حجز العنصرين
  assertEquals(db.rpcs.slice(0, 2), [
    { fn: "wa_triage_take_ticket", args: { p_hash: hash, p_items: 0 } },
    { fn: "wa_triage_take_ticket", args: { p_hash: hash, p_items: 2 } },
  ]);
  assertEquals(tickets[hash], 28);
  assertFalse(db.ops.includes("profiles:select"), "no user lookup for a ticket");
  assertEquals(res.body.qset, "wa-1-ar");
  const [e1, e2] = res.body.items;
  assertEquals([e1.ok, e1.cached, e1.verdict], [true, false, "send"]);
  assertEquals(e1.intent, { choice: "sale_offer", confidence: 0.92, probabilities: { sale_offer: 0.92, other: 0.08 } });
  assertEquals(e1.city, { choice: "jeddah", confidence: 0.8, probabilities: null });
  assertEquals(e1.district, { choice: "الصفا", confidence: 0.85, probabilities: null });
  assertEquals([e2.verdict, e2.district], ["skip", { choice: "not_stated", confidence: null, probabilities: null }]);
  // الأسئلة العربية، والحالة بلا مجموعة فارغة للعنصر الثاني
  assert(/[ء-ي]/.test(seen[0].questions.intent.instructions));
  assertEquals(seen[1].state, { message: "مطلوب أرض", group: "" });
  // الذاكرة لم تُقرأ ولم تُكتب؛ سطر النداء للتقييم بلا مستخدم
  assertEquals(db.ops.filter((op) => op.startsWith("wa_triage:")), []);
  assertEquals(db.tables.wa_triage, [cachedRow]);
  assertEquals([db.tables.wa_triage_calls[0].purpose, db.tables.wa_triage_calls[0].requested_by], ["eval", null]);
  assertEquals([res.body.spent_today_usd, res.body.cap_usd], [1.000042, 0.5]);
  // حُجز من التذكرة عنصران، ثم عنصر
  const again = await call(post({ action: "triage", items: [item("e3", "شقة للبيع")] }, { "x-triage-ticket": token }));
  assertEquals(again.status, 200);
  assertEquals([db.rpcs.at(-3)!.args.p_items, db.rpcs.at(-2)!.args.p_items, tickets[hash]], [0, 1, 27]);
});

Deno.test("wa-triage eval: the ticket is checked before the body is read — a bad, empty or missing-migration ticket reads nothing", async () => {
  const token = "tkt_synthetic_token_0123456789";
  const hash = await sha256Hex(token);
  const body = { action: "triage", items: [item("e1", "شقة للبيع")] };
  const cases: [Parameters<typeof setup>[0], string, number, Record<string, unknown>, number][] = [
    // [القاعدة، التذكرة، الحالة، الرد، نداءات التذكرة]
    [{ tickets: { [hash]: 30 } }, "wrong-token-000000", 401, { status: "error", message: "غير مصرح" }, 1],
    [{ tickets: {} }, token, 401, { status: "error", message: "غير مصرح" }, 1],
    [{ tickets: { [hash]: 30 } }, "", 401, { status: "error", message: "غير مصرح" }, 0],
    [{ tickets: { [hash]: 30 } }, "t".repeat(513), 401, { status: "error", message: "غير مصرح" }, 0],
    [{ tickets: { code: "08006", message: "connection failure at 10.0.0.1" } }, token, 500, { status: "error", message: "تعذّر التحقق من التذكرة" }, 1],
  ];
  for (const [o, ticket, status, reply, tries] of cases) {
    const { call, db, seen } = setup(o);
    const pulled = { value: false };
    const req = watchedPost(body, { "x-triage-ticket": ticket }, pulled);
    const res = await call(req);
    assertEquals([res.status, res.body], [status, reply], ticket.slice(0, 20));
    assertFalse(req.bodyUsed || pulled.value, "the body was read before the ticket was accepted");
    assertEquals(db.rpcs.map((r) => [r.fn, r.args.p_items]), Array(tries).fill(["wa_triage_take_ticket", 0]));
    assertEquals([seen.length, db.tables.wa_triage_calls.length], [0, 0]);
  }
  // دالة التذكرة غائبة (الترحيل): تخطٍّ برسالة، ولا جسم يُقرأ
  const missing = setup({ tickets: { code: "PGRST202", message: "Could not find the function" } });
  const pulled = { value: false };
  const m = await missing.call(watchedPost(body, { "x-triage-ticket": token }, pulled));
  assertEquals([m.status, m.body.status, pulled.value], [200, "skipped", false]);
  assert(m.body.message.includes("026_wa_triage"), m.body.message);
});

Deno.test("wa-triage eval: with a valid ticket, only triage is allowed and bad input is refused before any item is reserved", async () => {
  const token = "tkt_synthetic_token_0123456789";
  const hash = await sha256Hex(token);
  const one = [item("e1", "شقة للبيع")];
  const cases: [unknown, number, string][] = [
    [{ action: "status" }, 403, "غير مسموح"],
    [{ action: "label", key: "a".repeat(64), label: "other" }, 403, "غير مسموح"],
    [{ action: "triage", qset: "wa-9", items: one }, 400, "مجموعة أسئلة غير معروفة"],
    [{ action: "triage", items: [] }, 400, "عدد العناصر غير صالح"],
    [{ action: "triage", items: Array.from({ length: 31 }, (_, i) => item(`e${i}`, "أ")) }, 400, "عدد العناصر غير صالح"],
    // التقييم يختار المجموعة؛ override لم يُدعم بعد
    [{ action: "triage", items: one, override: { name: "x" } }, 400, "الأسئلة المخصّصة (override) غير مدعومة في هذه النسخة من الوظيفة"],
  ];
  for (const [body, status, message] of cases) {
    const tickets = { [hash]: 30 };
    const { call, db, seen } = setup({ tickets });
    const res = await call(post(body, { "x-triage-ticket": token }));
    assertEquals([res.status, res.body], [status, { status: "error", message }], JSON.stringify(body).slice(0, 60));
    // التحقق وحده (p_items = 0)، ولم يُحجز شيء
    assertEquals(db.rpcs, [{ fn: "wa_triage_take_ticket", args: { p_hash: hash, p_items: 0 } }]);
    assertEquals([tickets[hash], seen.length, db.tables.wa_triage_calls.length], [30, 0, 0]);
  }
  // تذكرة صالحة لا يكفي ما بقي منها: 401 عند الحجز، ولا شيء يعمل
  const tickets = { [hash]: 1 };
  const short = setup({ tickets });
  const res = await short.call(post({ action: "triage", items: [item("e1", "أ"), item("e2", "ب")] }, { "x-triage-ticket": token }));
  assertEquals([res.status, res.body], [401, { status: "error", message: "غير مصرح" }]);
  assertEquals(short.db.rpcs.map((r) => r.args.p_items), [0, 2]);
  assertEquals([tickets[hash], short.seen.length, short.db.tables.wa_triage_calls.length], [1, 0, 0]);
});

/* ===================== label ===================== */

Deno.test("wa-triage label: the owner's intent goes on the newest row for the key; unknown key 404; bad input 400", async () => {
  const key = "c".repeat(64);
  const rows = [
    { key, qset: "wa-0", verdict: "skip", reasons: [], answers: {}, owner_label: null, created_at: "2026-09-01T00:00:00.000Z" },
    { key, qset: "wa-1", verdict: "review", reasons: [], answers: {}, owner_label: null, created_at: "2026-10-01T00:00:00.000Z" },
  ];
  const { call, db } = setup({ triage: rows });
  const res = await call(post({ action: "label", key, label: "status_update" }));
  assertEquals([res.status, res.body], [200, { status: "success" }]);
  const newest = db.tables.wa_triage.find((r) => r.qset === "wa-1")!;
  assertEquals([newest.owner_label, newest.owner_label_by], ["status_update", ADMIN_ID]);
  assert(typeof newest.owner_label_at === "string" && !Number.isNaN(Date.parse(newest.owner_label_at)));
  assertEquals(db.tables.wa_triage.find((r) => r.qset === "wa-0")!.owner_label, null);

  assertEquals((await call(post({ action: "label", key: "d".repeat(64), label: "other" }))).body, { status: "error", message: "غير موجود" });
  assertEquals((await call(post({ action: "label", key: "d".repeat(64), label: "other" }))).status, 404);
  assertEquals((await call(post({ action: "label", key, label: "spam" }))).body.message, "تصنيف غير صالح");
  assertEquals((await call(post({ action: "label", key: "XYZ", label: "other" }))).body.message, "مفتاح غير صالح");
  assertEquals((await call(post({ action: "label", key: key.toUpperCase(), label: "other" }))).status, 400);
  // خطأ القاعدة لا يتسرب نصه
  const broken = setup({ triage: rows, fail: { "wa_triage:select": { code: "42501", message: "permission denied for table wa_triage" } } });
  const err = await broken.call(post({ action: "label", key, label: "other" }));
  assertEquals([err.status, err.body], [500, { status: "error", message: "تعذّر حفظ التصحيح" }]);
  // الجدول غائب (الترحيل لم يُطبَّق)
  const absent = setup({ fail: { "wa_triage:select": { code: "PGRST205", message: "Could not find the table 'public.wa_triage'" } } });
  const none = await absent.call(post({ action: "label", key, label: "other" }));
  assertEquals(none.status, 503);
  assert(none.body.message.includes("026_wa_triage"), none.body.message);
});

Deno.test("wa-triage triage: a cache that cannot be read is skipped (Jev is asked) and SQL text never reaches the caller", async () => {
  const { call, seen } = setup({ fail: { "wa_triage:select": { code: "42P01", message: 'relation "public.wa_triage" does not exist' } } });
  const res = await call(triage([item("r1", "شقة للبيع في النزهة")]));
  assertEquals([res.status, res.body.items[0].verdict, seen.length], [200, "send", 1]);
  assertFalse(JSON.stringify(res.body).includes("relation"));
});

/* ===================== نص الأخطاء ===================== */

Deno.test("safeErrorText: phones, e-mails, long digit runs and Arabic text never reach logs or the calls row", () => {
  const raw = 'Provider returned error {"input":{"message":"فيلا للبيع 0551234567","email":"owner@example.com"}} ref 12345678 at 429';
  const safe = safeErrorText(raw);
  assert(safe.startsWith("Provider returned error"), safe);
  for (const leak of ["0551234567", "owner@example.com", "12345678", "فيلا", "للبيع"]) assertFalse(safe.includes(leak), leak);
  assert(safe.includes("429"), safe);
  assertEquals(safeErrorText("word ".repeat(1000)).length, 300);
  assertEquals(safeErrorText("a\n\n b", 50), "a b");
  // سلسلة طويلة بلا @ تُقصر قبل الإخفاء (نمط البريد تربيعي عليها)، وأرقامها x
  assertEquals(safeErrorText("1.".repeat(10_000)), "x.".repeat(32));
  assertEquals(safeErrorText("err 055 – 123 – 4567"), "err xxx – xxx – xxxx");
});
