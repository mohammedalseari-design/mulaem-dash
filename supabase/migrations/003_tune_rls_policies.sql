-- 003_tune_rls_policies — طُبّقت على المشروع الحي بتاريخ 2026-09-18 (20260918013807)
-- تحسينات أداء سياسات RLS بحسب فاحص Supabase

-- 1) profiles_select: تقييم auth.uid() مرة واحدة لكل استعلام بدل كل صف
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
using (id = (select auth.uid()) or public.is_admin());

-- 2) الموقع الرئيسي: سياسة القراءة العامة تكفي للقراءة، وسياسة المدير تقتصر على الكتابة
drop policy if exists site_projects_admin on public.site_projects;
create policy site_projects_insert_admin on public.site_projects for insert to authenticated
with check (public.is_admin());
create policy site_projects_update_admin on public.site_projects for update to authenticated
using (public.is_admin()) with check (public.is_admin());
create policy site_projects_delete_admin on public.site_projects for delete to authenticated
using (public.is_admin());

drop policy if exists site_settings_admin on public.site_settings;
create policy site_settings_insert_admin on public.site_settings for insert to authenticated
with check (public.is_admin());
create policy site_settings_update_admin on public.site_settings for update to authenticated
using (public.is_admin()) with check (public.is_admin());
create policy site_settings_delete_admin on public.site_settings for delete to authenticated
using (public.is_admin());
