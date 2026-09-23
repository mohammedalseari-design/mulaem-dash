-- فجوة الطلب حسب الحي: الطلبات المفتوحة مقابل المعروض المتاح.

drop view if exists public.v_inventory_demand_gap;
create view public.v_inventory_demand_gap
with (security_invoker = true) as
with requested as (
    select district, count(distinct r.id)::int as open_requests
    from public.client_requirements r
    cross join lateral unnest(coalesce(r.districts, '{}'::text[])) as d(district)
    where r.status = 'open' and nullif(btrim(d.district), '') is not null
    group by district
), available as (
    select p.district, count(*)::int as available_properties
    from public.projects p
    where p.status = 'approved'
      and p.deleted_at is null
      and p.availability = 'available'
      and nullif(btrim(p.district), '') is not null
    group by p.district
)
select
    coalesce(r.district, a.district) as district,
    coalesce(r.open_requests, 0) as open_requests,
    coalesce(a.available_properties, 0) as available_properties,
    coalesce(r.open_requests, 0) - coalesce(a.available_properties, 0) as gap,
    case
        when coalesce(r.open_requests, 0) > coalesce(a.available_properties, 0) then 'عجز'
        when coalesce(r.open_requests, 0) < coalesce(a.available_properties, 0) then 'فائض'
        else 'متوازن'
    end as state
from requested r
full join available a on a.district = r.district;

revoke all on public.v_inventory_demand_gap from anon;
grant select on public.v_inventory_demand_gap to authenticated;
