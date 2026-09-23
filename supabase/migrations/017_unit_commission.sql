-- عمولة الوحدة: تُقرأ من details.models.commission، ولا تُحذف العمولات التاريخية.

drop view if exists public.v_units;
create view public.v_units with (security_invoker = true) as
select p.id as project_id, p.name as project_name, p.type as project_type,
       p.purpose, p.city, p.district, p.district_inferred,
       p.status, p.availability, p.deleted_at, p.listing_expires_at, p.latitude, p.longitude,
       p.details->>'construction_status' as construction_status,
       m.ord::int as unit_ord,
       coalesce(nullif(btrim(m.model->>'name'), ''), 'وحدة ' || m.ord) as unit_key,
       coalesce(nullif(m.model->>'type', ''), p.type) as unit_type,
       case when (m.model->>'rooms') ~ '^\d+$' then (m.model->>'rooms')::int else p.rooms end as rooms,
       case when (m.model->>'bathrooms') ~ '^\d+$' then (m.model->>'bathrooms')::int end as bathrooms,
       case when (m.model->>'area') ~ '^\d+(\.\d+)?$' then (m.model->>'area')::numeric end as area,
       case when (m.model->>'price') ~ '^\d+(\.\d+)?$' then (m.model->>'price')::numeric end as price,
       case when (m.model->>'commission') ~ '^\d+(\.\d+)?$' then (m.model->>'commission')::numeric end as unit_commission,
       case when (m.model->>'count') ~ '^\d+$' then (m.model->>'count')::int else 1 end as unit_count,
       coalesce(nullif(m.model->>'status', ''), 'available') as unit_status
from public.projects p
cross join lateral jsonb_array_elements(
    case when jsonb_typeof(p.details->'models') = 'array' then p.details->'models' else '[]'::jsonb end
) with ordinality as m(model, ord)
union all
select p.id, p.name, p.type, p.purpose, p.city, p.district, p.district_inferred,
       p.status, p.availability, p.deleted_at, p.listing_expires_at, p.latitude, p.longitude,
       p.details->>'construction_status',
       0, 'كامل العقار', p.type, p.rooms, null::int, p.area, p.price, null::numeric, 1, p.availability
from public.projects p
where jsonb_typeof(p.details->'models') is distinct from 'array'
   or jsonb_array_length(p.details->'models') = 0;
revoke all on public.v_units from anon;
grant select on public.v_units to authenticated;
