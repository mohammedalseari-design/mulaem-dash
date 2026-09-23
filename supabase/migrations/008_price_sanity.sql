-- 008_price_sanity — الأسعار والمساحات غير الموجبة تُعامل كـ"غير محدد" في عرض الوحدات، وتظهر في جودة المخزون
-- طُبّقت على المشروع الحي بتاريخ 2026-09-18 (price_sanity)
--
-- السبب: 40 وحدة سعرها 0 و25 مشروعاً سعره سالب أو صفر (بقايا النظام القديم). السعر 0 كان:
--   1) يظهر رقماً "0" في صفحة العقارات وفي الوصف المنسوخ،
--   2) يأخذ درجة الميزانية كاملة في match_requirement (0 ≤ أي ميزانية)، فتظهر وحدات بلا سعر في أعلى المطابقات.
-- الحل في العرض نفسه، فيستفيد منه كل من يقرأه (الصفحة، المطابقة، التقارير) بلا تعديل في الواجهة.

create or replace view public.v_units with (security_invoker = true) as
select p.id as project_id, p.name as project_name, p.type as project_type,
       p.purpose, p.city, p.district, p.district_inferred,
       p.status, p.availability, p.deleted_at, p.listing_expires_at, p.latitude, p.longitude,
       p.details->>'construction_status' as construction_status,
       m.ord::int as unit_ord,
       coalesce(nullif(btrim(m.model->>'name'), ''), 'وحدة ' || m.ord) as unit_key,
       coalesce(nullif(m.model->>'type', ''), p.type) as unit_type,
       case when (m.model->>'rooms')     ~ '^\d+$'          then (m.model->>'rooms')::int      else p.rooms end as rooms,
       case when (m.model->>'bathrooms') ~ '^\d+$'          then (m.model->>'bathrooms')::int  end as bathrooms,
       case when (m.model->>'area')      ~ '^\d+(\.\d+)?$'  and (m.model->>'area')::numeric  > 0 then (m.model->>'area')::numeric   end as area,
       case when (m.model->>'price')     ~ '^\d+(\.\d+)?$'  and (m.model->>'price')::numeric > 0 then (m.model->>'price')::numeric  end as price,
       case when (m.model->>'count')     ~ '^\d+$'          then (m.model->>'count')::int      else 1 end as unit_count,
       coalesce(nullif(m.model->>'status', ''), 'available') as unit_status
from public.projects p
cross join lateral jsonb_array_elements(
    case when jsonb_typeof(p.details->'models') = 'array' then p.details->'models' else '[]'::jsonb end
) with ordinality as m(model, ord)
union all
select p.id, p.name, p.type, p.purpose, p.city, p.district, p.district_inferred,
       p.status, p.availability, p.deleted_at, p.listing_expires_at, p.latitude, p.longitude,
       p.details->>'construction_status',
       0, 'كامل العقار', p.type, p.rooms, null::int,
       case when p.area  > 0 then p.area  end,
       case when p.price > 0 then p.price end,
       1, p.availability
from public.projects p
where jsonb_typeof(p.details->'models') is distinct from 'array'
   or jsonb_array_length(p.details->'models') = 0;

-- جودة المخزون: مشروع فيه وحدات متاحة بلا سعر يحتاج انتباه المدير
create or replace view public.v_inventory_attention with (security_invoker = true) as
select p.id, p.name, p.type, p.district, p.price, p.employee, p.date_added, p.listing_expires_at, p.rega_ad_license,
       array_remove(array[
           case when p.listing_expires_at is not null and p.listing_expires_at < current_date then 'منتهي' end,
           case when p.listing_expires_at is not null and p.listing_expires_at between current_date and current_date + 30 then 'ينتهي خلال 30 يوماً' end,
           case when p.rega_ad_license is null or btrim(p.rega_ad_license) = '' then 'بلا رقم ترخيص إعلان' end,
           case when p.district is null then 'بلا حي' when p.district_inferred then 'الحي مستنتج' end,
           case when jsonb_array_length(p.images) = 0 then 'بلا صور' end,
           case when exists (select 1 from public.v_units u where u.project_id = p.id and u.unit_status = 'available' and u.price is null) then 'وحدات بلا سعر' end,
           case when p.date_added < (now() at time zone 'Asia/Riyadh') - interval '90 days' then 'لم يُحدَّث منذ 90 يوماً' end
       ], null) as issues
from public.projects p
where p.status = 'approved' and p.deleted_at is null
  and (
       (p.listing_expires_at is not null and p.listing_expires_at <= current_date + 30)
    or p.rega_ad_license is null or btrim(p.rega_ad_license) = ''
    or p.district is null or p.district_inferred
    or jsonb_array_length(p.images) = 0
    or exists (select 1 from public.v_units u where u.project_id = p.id and u.unit_status = 'available' and u.price is null)
    or p.date_added < (now() at time zone 'Asia/Riyadh') - interval '90 days'
  );

revoke all on public.v_units from anon;
grant select on public.v_units to authenticated;
revoke all on public.v_inventory_attention from anon;
grant select on public.v_inventory_attention to authenticated;
