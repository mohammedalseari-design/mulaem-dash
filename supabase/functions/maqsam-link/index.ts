// نظام ملائم العقاري — الربط مع مقسم (صفحة #/settings/maqsam، للمدير فقط). يربط عميل Supabase الحقيقي بالمعالج.
// الجلسة تُفحص في المنصة (verify_jwt) ثم في المعالج، ومفتاح الخدمة لا يغادر هذه الوظيفة. المنطق في handler.ts وcore.ts.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handle, supabaseDeps } from "./handler.ts";

const deps = supabaseDeps(
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
);

Deno.serve((req) => handle(req, deps));
