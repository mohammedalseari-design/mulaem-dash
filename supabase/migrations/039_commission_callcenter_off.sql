-- 039: العمولة لا تظهر لمركز الاتصال أبداً (قرار المالك 2026-11-04: «مركز الاتصال لا»).
--
-- commission_visible() (037) هي الباب الوحيد: تقرؤها سياسات commission_policy و project_commission و unit_commission_override
-- والعمولات ودفعاتها، ومن هذه الجداول يحسب v_units عمولة الوحدة. كانت تفتح لكل موظف غير المدير حين يشغّل المدير الزر،
-- فصارت: المدير دائماً، والوسيط (field) حين يشغّل المدير الزر، ولا أحد غيرهما. الموقوف دوره فارغ فلا يراها.
--
-- تطبيقه مرة ثانية لا يغيّر شيئاً.

create or replace function public.commission_visible() returns boolean
language sql stable security definer set search_path = public as $$
    select coalesce(public.is_admin(), false)
        or coalesce(public.my_role() = 'field'
                    and (select p.show_to_staff from public.commission_policy p where p.id), false)
$$;
revoke execute on function public.commission_visible() from public, anon;
grant  execute on function public.commission_visible() to authenticated;
