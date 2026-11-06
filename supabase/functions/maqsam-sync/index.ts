// نظام ملائم العقاري — نقل ملخصات مقسم إلى Zoho. يناديها pg_cron وحده كل خمس دقائق بسر من Vault، فتُنشر بـ --no-verify-jwt:
// فحص JWT في المنصة يرفض المُجدوِل قبل أن يصل إلى الكود. لا يوجد نداء من متصفح، فلا CORS هنا. المنطق في tick.ts.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handle, supabaseDeps } from "./tick.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const deps = supabaseDeps(
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
  (work) => EdgeRuntime.waitUntil(work),
);

Deno.serve((req) => handle(req, deps));
