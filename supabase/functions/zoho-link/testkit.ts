// عدّة اختبارات zoho-link وmaqsam-sync: عالم مزيّف في الذاكرة بقاعدة تطابق دوال 042 (يثبتها test042.mjs على Postgres)، وZoho ومقسم مزيّفان بردود مكتوبة.
// لا يستوردها index.ts، فلا تُنشر. كل الأسماء والأرقام مصطنعة (المستودع عام).
import { assertFalse } from "jsr:@std/assert@1";
import type { Check, Credentials, LinkRow, SyncRow } from "./core.ts";
import type { AttemptGate, AuditRow, ConnectInput, Deps, Profile } from "./handler.ts";
import type { ClaimRow, MaqsamCredentials } from "./notes.ts";
import type { CallRow, RunBegin } from "./store.ts";

export const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);
export const NOW_ISO = new Date(NOW).toISOString();
export const HOUR = 3_600_000;

// كل قيمة لا يجوز أن تخرج تحمل هذه الكلمة، فيكفي فحص واحد على كل ما خرج
export const SENTINEL = "SENTINEL";
export const CLIENT_ID = "1000.SENTINEL-CLIENT-ID-0123456789-7f3a";
export const CLIENT_SECRET = "SENTINEL-CLIENT-SECRET-abcdef";
export const CODE = "1000.SENTINEL-GRANT-CODE.abcdef";
export const NEW_REFRESH = "1000.SENTINEL-NEW-REFRESH.abcdef";
export const NEW_ACCESS = "1000.SENTINEL-NEW-ACCESS.abcdef";
export const RENEWED_ACCESS = "1000.SENTINEL-RENEWED-ACCESS.abcdef";
export const OLD_CLIENT = { client_id: "1000.SENTINEL-OLD-CLIENT-1234", client_secret: "SENTINEL-OLD-SECRET", refresh_token: "1000.SENTINEL-OLD-REFRESH.abcdef" };
export const MAQSAM_KEYS = { host: "av.maqsam.com", key_id: "SENTINEL-MAQSAM-KEY", secret: "SENTINEL-MAQSAM-SECRET" };
export const CUSTOMER_NUMBER = "966500000001";
export const OTHER_NUMBER = "966500000002";
// الملخص يصل Zoho والمدير في المعاينة وحدهما: كلمته الخاصة تفصله عن الأسرار
export const SUMMARY_MARK = "CUSTOMERWORDS";

export const LEAD_ID = "1500000000000000111";
export const CONTACT_ID = "1500000000000000222";

export const SITE = "https://dash.mulaem.sa";
export const ARABIC = /[؀-ۿ]/;

export function assertClean(text: string, label: string) {
  assertFalse(text.includes(SENTINEL), `${label} leaked a sentinel: ${text}`);
  assertFalse(text.includes(btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)), `${label} leaked the Basic value`);
  assertFalse(text.includes(btoa(`${OLD_CLIENT.client_id}:${OLD_CLIENT.client_secret}`)), `${label} leaked the old Basic value`);
}

// مع ذلك: لا ملخص ولا رقم عميل
export function assertNoCustomer(text: string, label: string) {
  assertClean(text, label);
  assertFalse(text.includes(SUMMARY_MARK), `${label} leaked a customer summary: ${text}`);
  for (const number of [CUSTOMER_NUMBER, OTHER_NUMBER]) {
    const local = number.slice(3);
    assertFalse(text.includes(local), `${label} leaked a customer number: ${text}`);
  }
}

// كل ما طُبع على console أثناء fn
export async function capture<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string }> {
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

/* ===================== مكالمات مقسم ===================== */

export interface CallOptions {
  id?: number;
  state?: string;
  direction?: string;
  ageMs?: number;
  duration?: number;
  number?: string;
  summary?: unknown;
  agents?: unknown;
}

// مكالمة بكل حقول التوثيق، وكل ما ليس للملاحظة يحمل الكلمة
export function maqsamCall(options: CallOptions = {}): Record<string, unknown> {
  const direction = options.direction ?? "outbound";
  const number = options.number ?? CUSTOMER_NUMBER;
  const atMs = NOW - (options.ageMs ?? HOUR);
  return {
    id: options.id ?? 1234567,
    caller: "SENTINEL-caller-name",
    callee: "SENTINEL-callee-name",
    callerNumber: direction === "outbound" ? "966111111111" : number,
    calleeNumber: direction === "outbound" ? number : "966111111111",
    inputs: ["SENTINEL-input"],
    state: options.state ?? "completed",
    direction,
    type: "SENTINEL-type",
    timestamp: Math.floor(atMs / 1000),
    duration: options.duration ?? 192,
    agents: "agents" in options ? options.agents : [{ identifier: "SENTINEL-agent-id", email: "agent.one@mulaem.sa", name: "موظف تجريبي" }],
    integrations: { crm: "SENTINEL-integration" },
    callTags: ["SENTINEL-tag"],
    callAutoTags: ["SENTINEL-autotag"],
    sentiment: "SENTINEL-sentiment",
    summary: "summary" in options ? options.summary : { ar: `${SUMMARY_MARK} ملخص عربي للمكالمة`, en: `${SUMMARY_MARK} english summary` },
    callTranscription: [{ content: "SENTINEL-transcript-text", startTime: 0, endTime: 1, party: "customer" }],
  };
}

/* ===================== Zoho ومقسم ===================== */

export interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  redirect: string | undefined;
  hasSignal: boolean;
}

export const jsonReply = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export const tokenOk = (fields: Record<string, unknown> = {}) =>
  jsonReply({ access_token: NEW_ACCESS, refresh_token: NEW_REFRESH, api_domain: "https://www.zohoapis.sa", token_type: "Bearer", expires_in: 3600, ...fields });

export const ORG_OK = { org: [{ type: "production", domain_name: "org150000145002", zgid: "150000145002", company_name: "Mulaem", country: "SA" }] };
export const USER_OK = { users: [{ full_name: "مدير زوهو", email: "SENTINEL-user-email", profile: { name: "Administrator", id: "1" }, status: "active" }] };

type Respond = (seen: Seen) => Response | Promise<Response>;

export class FakeNet {
  seen: Seen[] = [];
  notes: { title: string; text: string; parent: unknown; id: string }[] = [];
  // رقم العميل بصيغة 12 خانة إلى صفوف Zoho
  leads = new Map<string, { id: string; Modified_Time: string }[]>();
  contacts = new Map<string, { id: string; Modified_Time: string }[]>();
  // عناوين ملاحظات موجودة في Zoho ولا يعرفها النظام: كتابة سابقة انقطع ردها
  existingNotes = new Map<string, string>();
  maqsamPages: unknown[][] = [[]];
  maqsamOne = new Map<number, unknown>();
  noteCounter = 1500000000000090000;

  token: Respond = () => tokenOk();
  revoke: Respond = () => new Response("{}", { status: 200 });
  org: Respond = () => jsonReply(ORG_OK);
  user: Respond = () => jsonReply(USER_OK);
  usersCount: Respond = () => jsonReply({ count: 6 });
  usersList: Respond = () => jsonReply({ users: [{}, {}, {}], info: { count: 3, more_records: false } });
  coql: Respond = (seen) => this.defaultCoql(seen);
  note: Respond = (seen) => this.defaultNote(seen);
  maqsam: Respond = (seen) => this.defaultMaqsam(seen);

  fetch = (url: string, init: RequestInit): Promise<Response> => {
    const seen: Seen = {
      url,
      method: init.method ?? "GET",
      headers: (init.headers ?? {}) as Record<string, string>,
      body: typeof init.body === "string" ? init.body : "",
      redirect: init.redirect,
      hasSignal: init.signal instanceof AbortSignal,
    };
    this.seen.push(seen);
    return Promise.resolve(this.route(seen));
  };

  private route(seen: Seen): Response | Promise<Response> {
    const url = new URL(seen.url);
    if (url.hostname === "accounts.zoho.sa" && url.pathname === "/oauth/v2/token") return this.token(seen);
    if (url.hostname === "accounts.zoho.sa" && url.pathname === "/oauth/v2/revoke/token") return this.revoke(seen);
    if (url.hostname === "www.zohoapis.sa" && url.pathname === "/crm/v8/org") return this.org(seen);
    if (url.hostname === "www.zohoapis.sa" && url.pathname === "/crm/v8/users/actions/count") return this.usersCount(seen);
    if (url.hostname === "www.zohoapis.sa" && url.pathname === "/crm/v8/users" && url.searchParams.get("type") === "CurrentUser") return this.user(seen);
    if (url.hostname === "www.zohoapis.sa" && url.pathname === "/crm/v8/users") return this.usersList(seen);
    if (url.hostname === "www.zohoapis.sa" && url.pathname === "/crm/v8/coql") return this.coql(seen);
    if (url.hostname === "www.zohoapis.sa" && url.pathname === "/crm/v8/Notes") return this.note(seen);
    if (url.hostname.endsWith("maqsam.com")) return this.maqsam(seen);
    return new Response("unexpected request", { status: 599 });
  }

  defaultCoql(seen: Seen): Response {
    const query = String(JSON.parse(seen.body).select_query);
    const lookup = /^select id, Modified_Time from (Leads|Contacts) where /.exec(query);
    if (lookup) {
      const table = lookup[1] === "Leads" ? this.leads : this.contacts;
      for (const [number, rows] of table) {
        if (query.includes(`'${number}'`)) return rows.length ? jsonReply({ data: rows, info: { count: rows.length, more_records: false } }) : new Response(null, { status: 204 });
      }
      return new Response(null, { status: 204 });
    }
    const title = /^select id from Notes where Note_Title = '([^']*)'/.exec(query);
    if (title) {
      const known = this.existingNotes.get(title[1]) ?? this.notes.find((note) => note.title === title[1])?.id;
      return known ? jsonReply({ data: [{ id: known }] }) : new Response(null, { status: 204 });
    }
    if (query.startsWith("select Owner, COUNT(id) from Calls")) {
      if (query.includes("What_Id is not null")) return jsonReply({ data: [{ "COUNT(id)": 4, Owner: { name: "alsaiari", id: "1" } }] });
      return jsonReply({ data: [{ "COUNT(id)": 5, Owner: { name: "second", id: "2" } }, { "COUNT(id)": 10, Owner: { name: "alsaiari", id: "1" } }] });
    }
    if (query.includes("Call_Duration_in_seconds >= 30")) return jsonReply({ data: [{ "COUNT(id)": 7 }] });
    if (query.startsWith("select COUNT(id) from Leads")) return jsonReply({ data: [{ "COUNT(id)": 3 }] });
    if (query.startsWith("select COUNT(id) from Contacts")) return jsonReply({ data: [{ "COUNT(id)": 534 }] });
    if (query.startsWith("select COUNT(id) from Notes")) return new Response(null, { status: 204 });
    return jsonReply({ code: "INVALID_QUERY", details: {}, message: "Invalid query formed", status: "error" }, 400);
  }

  defaultNote(seen: Seen): Response {
    const item = JSON.parse(seen.body).data[0];
    const id = String(this.noteCounter++);
    this.notes.push({ title: item.Note_Title, text: item.Note_Content, parent: item.Parent_Id, id });
    return jsonReply({ data: [{ code: "SUCCESS", details: { id, Created_By: { name: "x", id: "1" } }, message: "record added", status: "success" }] }, 201);
  }

  defaultMaqsam(seen: Seen): Response {
    const url = new URL(seen.url);
    const single = /^\/v2\/calls\/(\d+)$/.exec(url.pathname);
    if (single) {
      const call = this.maqsamOne.get(Number(single[1]));
      return call ? jsonReply({ result: "success", message: call }, 200, { "content-type": "text/html; charset=utf-8" }) : jsonReply({ error: true, message: "Not found" }, 404);
    }
    const page = Number(url.searchParams.get("page") ?? "1");
    return jsonReply({ result: "success", message: this.maqsamPages[page - 1] ?? [] }, 200, { "content-type": "text/html; charset=utf-8" });
  }

  // ما ذهب إلى Zoho أو مقسم غير الأسرار في أماكنها
  zohoRequests(): Seen[] {
    return this.seen.filter((seen) => new URL(seen.url).hostname.endsWith("zoho.sa") || new URL(seen.url).hostname.endsWith("zohoapis.sa"));
  }
  apiRequests(): Seen[] {
    return this.seen.filter((seen) => new URL(seen.url).hostname === "www.zohoapis.sa");
  }
  noteRequests(): Seen[] {
    return this.seen.filter((seen) => new URL(seen.url).pathname === "/crm/v8/Notes");
  }
  tokenRequests(grant?: string): Seen[] {
    return this.seen.filter((seen) =>
      new URL(seen.url).pathname === "/oauth/v2/token" && (grant === undefined || new URLSearchParams(seen.body).get("grant_type") === grant)
    );
  }
  revokeRequests(): Seen[] {
    return this.seen.filter((seen) => new URL(seen.url).pathname === "/oauth/v2/revoke/token");
  }
  maqsamRequests(): Seen[] {
    return this.seen.filter((seen) => new URL(seen.url).hostname.endsWith("maqsam.com"));
  }
}

/* ===================== القاعدة ===================== */

export const PROFILES: Record<string, Profile> = {
  "u-admin": { id: "u-admin", role: "admin", is_blocked: false, legacy_id: 7, fullname: "مدير تجريبي", username: "admin.test" },
  "u-staff": { id: "u-staff", role: "callcenter", is_blocked: false, legacy_id: 8, fullname: "موظف", username: "staff.test" },
  "u-field": { id: "u-field", role: "field", is_blocked: false, legacy_id: 9, fullname: "ميداني", username: "field.test" },
  "u-blocked": { id: "u-blocked", role: "admin", is_blocked: true, legacy_id: 10, fullname: "مدير موقوف", username: "blocked.test" },
  "u-noname": { id: "u-noname", role: "admin", is_blocked: false, legacy_id: null, fullname: null, username: "noname.test" },
};

export const TOKENS: Record<string, string> = {
  "admin-token": "u-admin",
  "staff-token": "u-staff",
  "field-token": "u-field",
  "blocked-token": "u-blocked",
  "noname-token": "u-noname",
  "ghost-token": "u-ghost",
};

export const STATS_DEFAULT = {
  window_days: 7 as const,
  calls: 15,
  calls_linked: 4,
  long_enough: 7,
  by_owner: [{ name: "alsaiari", calls: 10 }, { name: "second", calls: 5 }],
  leads_new: 3,
  active_users: 6,
};

export interface FakeCall extends CallRow {
  ambiguous?: boolean;
  attempts: number;
}

export interface WorldStart {
  connected?: boolean;
  maqsam?: boolean;
  row?: Partial<LinkRow>;
  enabled?: boolean;
  needsReconnect?: boolean;
  startFrom?: string;
  scanCursor?: string | null;
}

export interface State {
  enabled: boolean;
  started_at: string | null;
  start_from: string | null;
  started_by: string | null;
  scan_cursor: string | null;
  last_run_at: string | null;
  last_run_code: string | null;
  needs_reconnect: boolean;
  lease: boolean;
}

export class World {
  net = new FakeNet();
  nowMs = NOW;
  row: LinkRow | null;
  vault: Omit<Credentials, "connected_at"> | null;
  maqsamCreds: MaqsamCredentials | null;
  state: State;
  calls = new Map<number, FakeCall>();
  connects: ConnectInput[] = [];
  records: Check[] = [];
  audits: AuditRow[] = [];
  disconnects = 0;
  credentialReads = 0;
  maqsamReads = 0;
  attempts = 0;
  attemptEnds = 0;
  gate: AttemptGate = { allowed: true, reason: "ok", wait_seconds: 0 };
  refreshGate = { allowed: true, wait_seconds: 0 };
  refreshes = 0;
  denied = 0;
  minted = 0;
  revokeFailed = 0;
  runEnds: { code: string; cursor: string | null }[] = [];
  marks: { call_id: number; status: string; next_try_at: string | null }[] = [];
  deps: Deps;

  constructor(start: WorldStart = {}) {
    this.row = start.connected
      ? {
        org_name: "Mulaem",
        user_name: "مدير زوهو",
        user_profile: "Administrator",
        client_hint: "1234",
        connected_at: "2026-10-01T09:00:00+00:00",
        connected_by: "u-admin",
        last_check_at: "2026-10-01T09:00:00+00:00",
        last_check_ok: true,
        last_check_code: "ok",
        last_check_stats: { ...STATS_DEFAULT, calls: 3 },
        ...start.row,
      }
      : null;
    this.vault = start.connected ? { ...OLD_CLIENT } : null;
    this.maqsamCreds = start.maqsam === false ? null : { ...MAQSAM_KEYS, connected_at: "2026-10-01T09:00:00+00:00" };
    this.state = {
      enabled: start.enabled ?? false,
      started_at: start.enabled ? "2026-11-01T00:00:00+00:00" : null,
      start_from: start.startFrom ?? (start.enabled ? new Date(NOW - 7 * 24 * HOUR).toISOString() : null),
      started_by: start.enabled ? "u-admin" : null,
      scan_cursor: start.scanCursor ?? null,
      last_run_at: null,
      last_run_code: null,
      needs_reconnect: start.needsReconnect ?? false,
      lease: false,
    };
    const iso = () => new Date(this.nowMs).toISOString();
    this.deps = {
      getUser: (token) => Promise.resolve(TOKENS[token] ? { id: TOKENS[token] } : null),
      getProfile: (id) => Promise.resolve(PROFILES[id] ?? null),
      readRow: () => Promise.resolve(this.row ? structuredClone(this.row) : null),
      nameOf: (id) => Promise.resolve(PROFILES[id]?.fullname ?? PROFILES[id]?.username ?? null),
      connect: (input) => {
        this.connects.push(input);
        this.vault = { client_id: input.client_id, client_secret: input.client_secret, refresh_token: input.refresh_token };
        this.row = {
          org_name: input.org_name,
          user_name: input.user_name,
          user_profile: input.user_profile,
          client_hint: input.client_hint,
          connected_at: iso(),
          connected_by: input.by,
          last_check_at: iso(),
          last_check_ok: true,
          last_check_code: "ok",
          last_check_stats: input.stats,
        };
        this.state.needs_reconnect = false;
        return Promise.resolve();
      },
      credentials: () => {
        this.credentialReads++;
        return Promise.resolve(this.row && this.vault ? { ...this.vault, connected_at: this.row.connected_at! } : null);
      },
      maqsamCredentials: () => {
        this.maqsamReads++;
        return Promise.resolve(this.maqsamCreds ? { ...this.maqsamCreds } : null);
      },
      recordCheck: (check, connectedAt) => {
        this.records.push(check);
        if (!this.row || this.row.connected_at !== connectedAt) return Promise.resolve(false);
        this.row = { ...this.row, last_check_at: check.at, last_check_ok: check.ok, last_check_code: check.code, last_check_stats: check.stats };
        return Promise.resolve(true);
      },
      disconnect: () => {
        this.disconnects++;
        this.row = null;
        this.vault = null;
        this.state.enabled = false;
        this.state.needs_reconnect = false;
        return Promise.resolve();
      },
      audit: (row) => {
        this.audits.push(row);
        return Promise.resolve();
      },
      attemptBegin: () => {
        this.attempts++;
        return Promise.resolve({ ...this.gate });
      },
      attemptEnd: () => {
        this.attemptEnds++;
        return Promise.resolve();
      },
      noteTokens: (input) => {
        this.minted += input.minted;
        this.revokeFailed += input.revoke_failed;
        return Promise.resolve();
      },
      refreshBegin: () => {
        this.refreshes++;
        return Promise.resolve({ ...this.refreshGate });
      },
      tokenDenied: () => {
        this.denied++;
        return Promise.resolve();
      },
      syncStatus: () => Promise.resolve(this.syncRow()),
      syncStart: (startFrom, by) => {
        if (!this.row || !this.vault || !this.maqsamCreds) return Promise.resolve("not_connected");
        if (this.state.enabled) return Promise.resolve("already");
        if (this.state.needs_reconnect) return Promise.resolve("needs_reconnect");
        Object.assign(this.state, { enabled: true, started_at: iso(), start_from: startFrom, started_by: by, scan_cursor: null, last_run_at: null, last_run_code: null });
        return Promise.resolve("started");
      },
      syncStop: () => {
        const was = this.state.enabled;
        this.state.enabled = false;
        return Promise.resolve(was);
      },
      setReconnect: (connectedAt, needs) => {
        if (!this.row || this.row.connected_at !== connectedAt) return Promise.resolve(false);
        this.state.needs_reconnect = needs;
        return Promise.resolve(true);
      },
      knownCalls: (ids) => {
        const known = new Map<number, CallRow>();
        for (const id of ids) {
          const row = this.calls.get(id);
          if (row) known.set(id, structuredClone(row));
        }
        return Promise.resolve(known);
      },
      openCalls: () => Promise.resolve([...this.calls.values()].filter((row) => row.status === "waiting" || row.status === "claimed").map((row) => structuredClone(row))),
      claim: (input) => Promise.resolve(this.claim(input)),
      written: (input) => {
        const row = this.calls.get(input.call_id);
        if (row?.status === "claimed") {
          Object.assign(row, { status: "written", zoho_note_id: input.note_id, zoho_module: input.module, zoho_record_id: input.record_id, ambiguous: input.ambiguous === true, next_try_at: null, updated_at: iso() });
        }
        return Promise.resolve();
      },
      release: (input) => {
        const row = this.calls.get(input.call_id);
        if (!row || row.status !== "claimed") return Promise.resolve(null);
        const attempts = input.count ? row.attempts : Math.max(row.attempts - 1, 0);
        const status = attempts >= 3 ? "failed" : "waiting";
        Object.assign(row, { status, attempts, next_try_at: status === "waiting" ? new Date(this.nowMs + HOUR).toISOString() : null, updated_at: iso() });
        return Promise.resolve(status);
      },
      mark: (input) => {
        this.marks.push(input);
        const row = this.calls.get(input.call_id);
        if (!row) {
          this.calls.set(input.call_id, { call_id: input.call_id, status: input.status, zoho_module: null, zoho_record_id: null, zoho_note_id: null, next_try_at: input.next_try_at, updated_at: iso(), attempts: 0 });
        } else if (row.status === "waiting") {
          Object.assign(row, { status: input.status, next_try_at: input.next_try_at, updated_at: iso() });
        }
        return Promise.resolve();
      },
      runBegin: (): Promise<RunBegin> => {
        if (!this.state.enabled) return Promise.resolve({ started: false, reason: "off" });
        if (this.state.needs_reconnect) return Promise.resolve({ started: false, reason: "needs_reconnect" });
        if (this.state.lease) return Promise.resolve({ started: false, reason: "busy" });
        this.state.lease = true;
        return Promise.resolve({ started: true, reason: "ok", start_from: this.state.start_from, scan_cursor: this.state.scan_cursor });
      },
      runEnd: (code, cursor) => {
        this.runEnds.push({ code, cursor });
        this.state.last_run_code = code;
        this.state.last_run_at = iso();
        this.state.lease = false;
        if (cursor !== null && (this.state.scan_cursor === null || Date.parse(cursor) > Date.parse(this.state.scan_cursor))) this.state.scan_cursor = cursor;
        return Promise.resolve();
      },
      fetch: this.net.fetch,
      now: () => this.nowMs,
      callTimeoutMs: 50,
      revokeTimeoutMs: 50,
    };
  }

  private claim(input: { call_id: number; module: string; record_id: string; require_enabled: boolean; takeover: boolean }): ClaimRow {
    if (input.require_enabled && !this.state.enabled) return { outcome: "disabled" };
    const iso = new Date(this.nowMs).toISOString();
    const row = this.calls.get(input.call_id);
    if (!row) {
      this.calls.set(input.call_id, { call_id: input.call_id, status: "claimed", zoho_module: input.module, zoho_record_id: input.record_id, zoho_note_id: null, next_try_at: null, updated_at: iso, attempts: 1 });
      return { outcome: "claimed" };
    }
    if (row.status === "written") return { outcome: "written", zoho_module: row.zoho_module, zoho_record_id: row.zoho_record_id, zoho_note_id: row.zoho_note_id };
    if (row.status === "claimed") {
      if (this.nowMs - Date.parse(row.updated_at ?? iso) < 30 * 60_000) return { outcome: "busy" };
      if (!input.takeover) return { outcome: "stale", zoho_module: row.zoho_module, zoho_record_id: row.zoho_record_id };
      if (row.attempts >= 5) {
        Object.assign(row, { status: "failed", next_try_at: null, updated_at: iso });
        return { outcome: "busy" };
      }
    }
    Object.assign(row, { status: "claimed", zoho_module: input.module, zoho_record_id: input.record_id, zoho_note_id: null, attempts: row.attempts + 1, next_try_at: null, updated_at: iso });
    return { outcome: "claimed" };
  }

  syncRow(): SyncRow {
    const rows = [...this.calls.values()];
    const count = (status: string) => rows.filter((row) => row.status === status).length;
    return {
      enabled: this.state.enabled,
      started_at: this.state.started_at,
      start_from: this.state.start_from,
      started_by: this.state.started_by,
      last_run_at: this.state.last_run_at,
      last_run_code: this.state.last_run_code,
      needs_reconnect: this.state.needs_reconnect,
      written_total: count("written"),
      written_7d: rows.filter((row) => row.status === "written" && this.nowMs - Date.parse(row.updated_at ?? "") <= 7 * 24 * HOUR).length,
      no_match_total: count("no_match"),
      ambiguous_total: rows.filter((row) => row.status === "written" && row.ambiguous === true).length,
      waiting: count("waiting"),
      failed_total: count("failed"),
    };
  }

  addCall(id: number, status: string, fields: Partial<FakeCall> = {}) {
    this.calls.set(id, { call_id: id, status, zoho_module: null, zoho_record_id: null, zoho_note_id: null, next_try_at: null, updated_at: new Date(this.nowMs).toISOString(), attempts: 0, ...fields });
  }
}

/* ===================== عميل Supabase مزيّف (للتأكد من وصل الدوال) ===================== */

export interface ClientCall {
  table?: string;
  rpc?: string;
  args?: Record<string, unknown>;
  select?: string;
  eqs?: [string, unknown][];
  ins?: [string, unknown[]][];
  limit?: number;
  update?: Record<string, unknown>;
  insert?: Record<string, unknown>;
  maybeSingle?: boolean;
}

export type DbReply = { data?: unknown; error?: unknown };

export function fakeClient(reply: (call: ClientCall) => DbReply = () => ({})) {
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
      eq: (column: string, value: unknown) => ((entry.eqs ??= []).push([column, value]), self),
      in: (column: string, values: unknown[]) => ((entry.ins ??= []).push([column, values]), self),
      limit: (count: number) => (entry.limit = count, self),
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
  return { calls, client };
}

const MIGRATION = new URL("../../migrations/042_zoho_link.sql", import.meta.url);

export function migrationSql(): string {
  return Deno.readTextFileSync(MIGRATION).replace(/\r\n/g, "\n");
}

// معاملات الدالة كما أُعلنت في 042، بترتيبها
export function declaredParameters(name: string): string[] {
  const match = new RegExp(`create or replace function public\\.${name}\\(([\\s\\S]*?)\\)\\s*(?:returns|language)`).exec(migrationSql());
  if (!match) throw new Error(`function ${name} is not in 042`);
  return [...match[1].matchAll(/\bp_[a-z_]+/g)].map((item) => item[0]);
}
