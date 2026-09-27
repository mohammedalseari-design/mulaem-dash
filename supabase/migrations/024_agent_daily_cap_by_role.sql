-- 024_agent_daily_cap_by_role — حد طلبات المساعد اليومي بحسب الدور.
-- طُبّقت على المشروع الحي باسم agent_daily_cap_by_role.
--
-- قرار المالك (2026-09-27): المدير 100 طلب في اليوم (عروض واتساب تمر عبر المساعد وحده)، والباقون 20 كما كان.
-- سقف الإنفاق اليومي (agent_router_budget: 2 دولار، و10 تصعيدات) لا يتغير، ويبقى الحد الأعلى للتكلفة.
--
-- الدالة تُقرأ في حارس الطلبات (agent_requests_guard) عند الإدراج بهوية المستخدم، وفي صفحة «عروض واتساب»
-- لعرض المتبقي. صارت stable لا immutable لأنها تقرأ دور المستخدم الحالي (is_admin).

create or replace function public.agent_daily_cap() returns int
language sql stable set search_path = public as $$
    select case when public.is_admin() then 100 else 20 end
$$;
revoke execute on function public.agent_daily_cap() from public, anon;
grant  execute on function public.agent_daily_cap() to authenticated, service_role;
