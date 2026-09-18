-- 010_keepalive — المرحلة 0 من خارطة التطوير: منع توقف قاعدة البيانات (ملف المهمة docs/TASK_PHASE0.md)
-- طُبّقت على المشروع الحي بتاريخ 2026-09-18 باسم keepalive
--
-- Supabase يوقف المشروع على الخطة المجانية بعد سبعة أيام بلا نشاط، وتوقّفه يعني انقطاع اللوحة والـCRM
-- حتى يستعيده أحد يدوياً. هذه الدالة نبضة يومية يستدعيها GitHub Action (.github/workflows/keepalive.yml).
-- ترجع وقت الخادم ولا تقرأ أي جدول، فمنحها لـ anon لا يكشف شيئاً — ولا يُمنح المجهول أي شيء آخر.
create or replace function public.keepalive() returns timestamptz
language sql stable security invoker set search_path = public as $$ select now() $$;
revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;
