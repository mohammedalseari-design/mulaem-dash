-- 002_harden_function_privileges — طُبّقت على المشروع الحي بتاريخ 2026-09-18 (20260918013703)
-- تشديد صلاحيات تنفيذ الدوال (معالجة تنبيهات الفاحص الأمني)

-- 1) دوال المشغّلات لا تُستدعى عبر الـ API أبداً: نمنع تنفيذها من الجميع
revoke execute on function public.projects_guard()   from public, anon, authenticated;
revoke execute on function public.activities_guard() from public, anon, authenticated;

-- 2) الدوال المساعدة تُستخدم داخل سياسات RLS، فيحتاجها المستخدم المسجَّل فقط
--    (تكشف دور المتصل نفسه لا غير). نمنع المجهول والعموم ونبقي المسجَّل.
revoke execute on function public.my_role()     from public, anon;
revoke execute on function public.my_username() from public, anon;
revoke execute on function public.is_admin()    from public, anon;
grant  execute on function public.my_role(), public.my_username(), public.is_admin() to authenticated;

-- 3) عدّاد أرقام الموظفين يبدأ بعد آخر رقم في النظام القديم (25) حتى لا تتكرر الأرقام
select setval(pg_get_serial_sequence('public.profiles', 'legacy_id'),
              greatest((select coalesce(max(id), 0) from public.legacy_users), 25));
