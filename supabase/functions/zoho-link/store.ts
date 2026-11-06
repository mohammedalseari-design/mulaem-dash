// نظام ملائم العقاري — قاعدة الربط مع Zoho والنقل: ما تشترك فيه وظيفتا zoho-link وmaqsam-sync، نداءات لدوال 042 وجداوله بلا منطق.
//
// لا يخرج من هنا نص خطأ القاعدة أبداً: رسالتها قد تحمل قيمة مُرِّرت إليها، فلا يبقى منها إلا الرمز (مثل 23514 أو PGRST202).
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { Credentials, SyncRow } from "./core.ts";
import type { ClaimRow, ClaimStore, MaqsamCredentials } from "./notes.ts";

export class StoreError extends Error {
  readonly code: string;
  constructor(stage: string, source: { code?: unknown }) {
    super(`zoho store failure: ${stage}`);
    this.name = "StoreError";
    this.code = typeof source.code === "string" && /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(source.code) ? source.code : "unknown";
  }
}

// رمز الخطأ أو اسم نوعه، لا رسالته
export function safeTag(error: unknown): string {
  if (error instanceof StoreError) return error.code;
  const name = error instanceof Error ? error.name : "";
  return /^[A-Za-z]{1,32}$/.test(name) ? name : "unknown";
}

export interface CallRow {
  call_id: number;
  status: string;
  zoho_module: string | null;
  zoho_record_id: string | null;
  zoho_note_id: string | null;
  next_try_at: string | null;
  updated_at: string | null;
}

export interface RunBegin {
  started: boolean;
  reason: string;
  start_from?: string | null;
  scan_cursor?: string | null;
}

export interface Store extends ClaimStore {
  credentials: () => Promise<Credentials | null>;
  maqsamCredentials: () => Promise<MaqsamCredentials | null>;
  refreshBegin: () => Promise<{ allowed: boolean; wait_seconds: number }>;
  tokenDenied: () => Promise<void>;
  syncStatus: () => Promise<SyncRow | null>;
  // false: لم يعد هذا الربط هو القائم، فلا تُرفع العلامة على ربط أحدث
  setReconnect: (connectedAt: string, needs: boolean) => Promise<boolean>;
  knownCalls: (ids: number[]) => Promise<Map<number, CallRow>>;
  openCalls: (limit: number) => Promise<CallRow[]>;
  mark: (input: { call_id: number; status: "waiting" | "no_match" | "no_summary"; next_try_at: string | null }) => Promise<void>;
  runBegin: (leaseSeconds: number) => Promise<RunBegin>;
  runEnd: (code: string, cursor: string | null) => Promise<void>;
}

const CALL_COLUMNS = "call_id, status, zoho_module, zoho_record_id, zoho_note_id, next_try_at, updated_at";
// عنوان الطلب لا يطول مهما كثرت المكالمات
const IDS_PER_READ = 200;

export function supabaseStore(db: SupabaseClient): Store {
  return {
    credentials: async () => {
      const { data, error } = await db.rpc("zoho_link_credentials");
      if (error) throw new StoreError("credentials", error);
      const row = Array.isArray(data) ? data[0] : null;
      return row ? { client_id: row.client_id, client_secret: row.client_secret, refresh_token: row.refresh_token, connected_at: row.connected_at } : null;
    },
    // الطريق الوحيد إلى مفتاحي مقسم، كما في maqsam-link
    maqsamCredentials: async () => {
      const { data, error } = await db.rpc("maqsam_link_credentials");
      if (error) throw new StoreError("maqsam-credentials", error);
      const row = Array.isArray(data) ? data[0] : null;
      return row ? { host: row.host, key_id: row.key_id, secret: row.secret, connected_at: row.connected_at } : null;
    },
    refreshBegin: async () => {
      const { data, error } = await db.rpc("zoho_token_refresh_begin");
      if (error) throw new StoreError("refresh-begin", error);
      return { allowed: data?.allowed === true, wait_seconds: typeof data?.wait_seconds === "number" ? data.wait_seconds : 0 };
    },
    tokenDenied: async () => {
      const { error } = await db.rpc("zoho_token_denied");
      if (error) throw new StoreError("token-denied", error);
    },
    syncStatus: async () => {
      const { data, error } = await db.rpc("maqsam_sync_status");
      if (error) throw new StoreError("sync-status", error);
      return Array.isArray(data) && data[0] ? data[0] as SyncRow : null;
    },
    setReconnect: async (connectedAt, needs) => {
      const { data, error } = await db.rpc("maqsam_sync_set_reconnect", { p_connected_at: connectedAt, p_needs: needs });
      if (error) throw new StoreError("set-reconnect", error);
      return data === true;
    },
    knownCalls: async (ids) => {
      const known = new Map<number, CallRow>();
      for (let i = 0; i < ids.length; i += IDS_PER_READ) {
        const { data, error } = await db.from("maqsam_sync_calls").select(CALL_COLUMNS).in("call_id", ids.slice(i, i + IDS_PER_READ));
        if (error) throw new StoreError("known-calls", error);
        for (const row of (data ?? []) as CallRow[]) known.set(Number(row.call_id), { ...row, call_id: Number(row.call_id) });
      }
      return known;
    },
    openCalls: async (limit) => {
      const { data, error } = await db.from("maqsam_sync_calls").select(CALL_COLUMNS).in("status", ["waiting", "claimed"]).limit(limit);
      if (error) throw new StoreError("open-calls", error);
      return ((data ?? []) as CallRow[]).map((row) => ({ ...row, call_id: Number(row.call_id) }));
    },
    claim: async (input) => {
      const { data, error } = await db.rpc("maqsam_sync_claim", {
        p_call_id: input.call_id,
        p_module: input.module,
        p_record_id: input.record_id,
        p_require_enabled: input.require_enabled,
        p_takeover: input.takeover,
      });
      if (error) throw new StoreError("claim", error);
      if (typeof data?.outcome !== "string") throw new StoreError("claim", {});
      return data as ClaimRow;
    },
    written: async (input) => {
      const { error } = await db.rpc("maqsam_sync_written", {
        p_call_id: input.call_id,
        p_note_id: input.note_id,
        p_module: input.module,
        p_record_id: input.record_id,
        p_ambiguous: input.ambiguous === true,
      });
      if (error) throw new StoreError("written", error);
    },
    release: async (input) => {
      const { data, error } = await db.rpc("maqsam_sync_release", { p_call_id: input.call_id, p_count: input.count });
      if (error) throw new StoreError("release", error);
      return typeof data === "string" ? data : null;
    },
    mark: async (input) => {
      const { error } = await db.rpc("maqsam_sync_mark", { p_call_id: input.call_id, p_status: input.status, p_next_try_at: input.next_try_at });
      if (error) throw new StoreError("mark", error);
    },
    runBegin: async (leaseSeconds) => {
      const { data, error } = await db.rpc("maqsam_sync_run_begin", { p_lease_seconds: leaseSeconds });
      if (error) throw new StoreError("run-begin", error);
      return { started: data?.started === true, reason: typeof data?.reason === "string" ? data.reason : "unknown", start_from: data?.start_from ?? null, scan_cursor: data?.scan_cursor ?? null };
    },
    runEnd: async (code, cursor) => {
      const { error } = await db.rpc("maqsam_sync_run_end", { p_code: code, p_cursor: cursor });
      if (error) throw new StoreError("run-end", error);
    },
  };
}
