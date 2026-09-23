// نظام ملائم العقاري — إدارة حسابات الموظفين (للمدير فقط)
// تعمل بمفتاح الخدمة داخل Supabase، ولا تنفّذ أي شيء قبل التأكد أن المتصل مدير غير معطَّل.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });

const fail = (message: string, status = 400) => json({ status: "error", message }, status);

const EMAIL_DOMAIN = Deno.env.get("AUTH_EMAIL_DOMAIN") ?? "users.mulaem.sa";
const ROLES = ["admin", "callcenter", "field"];
const MIN_PASSWORD = 8;
const BAN_FOREVER = "876000h"; // ~100 سنة

const toEmail = (username: string) => {
  const u = username.trim().toLowerCase();
  return u.includes("@") ? u : `${u}@${EMAIL_DOMAIN}`;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("طلب غير مدعوم", 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    // 1) من المتصل؟
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return fail("غير مصرح", 401);
    const { data: caller, error: callerErr } = await admin.auth.getUser(token);
    if (callerErr || !caller?.user) return fail("غير مصرح", 401);

    const { data: me } = await admin.from("profiles").select("id, role, is_blocked").eq("id", caller.user.id).maybeSingle();
    if (!me || me.role !== "admin" || me.is_blocked) return fail("هذه العملية للمدير فقط", 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    // الواجهة تتعامل بالرقم (legacy_id)، ونحوّله هنا إلى هوية الحساب
    const findTarget = async (legacyId: unknown) => {
      const n = Number(legacyId);
      if (!Number.isInteger(n)) return null;
      const { data } = await admin.from("profiles").select("id, username, role").eq("legacy_id", n).maybeSingle();
      return data;
    };

    if (action === "create") {
      const username = String(body.username ?? "").trim().toLowerCase();
      const fullname = String(body.fullname ?? "").trim();
      const password = String(body.password ?? "");
      const role = String(body.role ?? "");
      if (!username || !fullname) return fail("اسم المستخدم والاسم الكامل مطلوبان");
      if (!ROLES.includes(role)) return fail("الدور غير صحيح");
      if (password.length < MIN_PASSWORD) return fail(`كلمة المرور يجب ألا تقل عن ${MIN_PASSWORD} خانات`);

      const { data: exists } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
      if (exists) return fail("اسم المستخدم مستخدم من قبل");

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: toEmail(username), password, email_confirm: true, user_metadata: { username, fullname },
      });
      if (createErr || !created?.user) return fail("تعذر إنشاء الحساب: " + (createErr?.message ?? ""));

      // إن كان الموظف موجوداً في النظام القديم نحافظ على رقمه
      const { data: legacy } = await admin.from("legacy_users").select("id").eq("username", username).maybeSingle();
      const row: Record<string, unknown> = { id: created.user.id, username, fullname, role };
      if (legacy?.id) row.legacy_id = legacy.id;

      const { error: profErr } = await admin.from("profiles").insert(row);
      if (profErr) {
        await admin.auth.admin.deleteUser(created.user.id);
        return fail("تعذر حفظ ملف الموظف: " + profErr.message);
      }
      return json({ status: "success" });
    }

    if (action === "change_password") {
      const password = String(body.password ?? "");
      if (password.length < MIN_PASSWORD) return fail(`كلمة المرور يجب ألا تقل عن ${MIN_PASSWORD} خانات`);
      const target = await findTarget(body.id);
      if (!target) return fail("المستخدم غير موجود", 404);
      const { error } = await admin.auth.admin.updateUserById(target.id, { password });
      if (error) return fail("تعذر تغيير كلمة المرور: " + error.message);
      return json({ status: "success" });
    }

    if (action === "toggle_block") {
      const target = await findTarget(body.id);
      if (!target) return fail("المستخدم غير موجود", 404);
      if (target.id === me.id) return fail("لا يمكنك تعطيل حسابك");
      const blocked = Boolean(body.is_blocked);
      const { error: upErr } = await admin.from("profiles").update({ is_blocked: blocked }).eq("id", target.id);
      if (upErr) return fail("تعذر تحديث الحالة: " + upErr.message);
      await admin.auth.admin.updateUserById(target.id, { ban_duration: blocked ? BAN_FOREVER : "none" });
      return json({ status: "success" });
    }

    if (action === "delete") {
      const target = await findTarget(body.id);
      if (!target) return fail("المستخدم غير موجود", 404);
      if (target.id === me.id) return fail("لا يمكنك حذف حسابك");
      const { error } = await admin.auth.admin.deleteUser(target.id); // الملف يُحذف تلقائياً (on delete cascade)
      if (error) return fail("تعذر الحذف: " + error.message);
      return json({ status: "success" });
    }

    return fail("إجراء غير معروف");
  } catch (e) {
    console.error(e);
    return fail("خطأ داخلي", 500);
  }
});
