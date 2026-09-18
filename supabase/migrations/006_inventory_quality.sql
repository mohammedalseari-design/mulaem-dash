-- 006_inventory_quality — عروض جودة المخزون + عمود احتفاظ بالروابط القديمة للصور
-- طُبّقت على المشروع الحي بتاريخ 2026-09-18 (inventory_quality_views)

-- نسخة من روابط الصور الأصلية قبل نقلها إلى مخزن Supabase (للرجوع عند الحاجة)
alter table public.projects add column if not exists images_legacy jsonb;

-- عروض معتمدة تحتاج انتباه المدير: انتهى عرضها أو يوشك، أو بلا رقم ترخيص إعلان، أو حيّها مستنتج، أو بلا صور
create or replace view public.v_inventory_attention with (security_invoker = true) as
select p.id, p.name, p.type, p.district, p.price, p.employee, p.date_added, p.listing_expires_at, p.rega_ad_license,
       array_remove(array[
           case when p.listing_expires_at is not null and p.listing_expires_at < current_date then 'منتهي' end,
           case when p.listing_expires_at is not null and p.listing_expires_at between current_date and current_date + 30 then 'ينتهي خلال 30 يوماً' end,
           case when p.rega_ad_license is null or btrim(p.rega_ad_license) = '' then 'بلا رقم ترخيص إعلان' end,
           case when p.district is null then 'بلا حي' when p.district_inferred then 'الحي مستنتج' end,
           case when jsonb_array_length(p.images) = 0 then 'بلا صور' end,
           case when p.date_added < (now() at time zone 'Asia/Riyadh') - interval '90 days' then 'لم يُحدَّث منذ 90 يوماً' end
       ], null) as issues
from public.projects p
where p.status = 'approved' and p.deleted_at is null
  and (
       (p.listing_expires_at is not null and p.listing_expires_at <= current_date + 30)
    or p.rega_ad_license is null or btrim(p.rega_ad_license) = ''
    or p.district is null or p.district_inferred
    or jsonb_array_length(p.images) = 0
    or p.date_added < (now() at time zone 'Asia/Riyadh') - interval '90 days'
  );
revoke all on public.v_inventory_attention from anon;
grant select on public.v_inventory_attention to authenticated;

-- تكرار محتمل بدرجات ثقة: عالية = نفس الاسم بعد التوحيد، متوسطة = إحداثيات متطابقة (غالباً إحداثيات وهمية)، منخفضة = نفس النوع والحي والسعر
-- (طُبّق التحديث باسم refine_duplicates_view)
drop view if exists public.v_inventory_duplicates;
create view public.v_inventory_duplicates with (security_invoker = true) as
select a.id as project_id, b.id as duplicate_of, a.name, b.name as duplicate_name,
       case when lower(regexp_replace(a.name, '\s+', '', 'g')) = lower(regexp_replace(b.name, '\s+', '', 'g')) then 'عالية'
            when a.latitude is not null and b.latitude is not null
                 and round(a.latitude::numeric, 4) = round(b.latitude::numeric, 4)
                 and round(a.longitude::numeric, 4) = round(b.longitude::numeric, 4) then 'متوسطة'
            else 'منخفضة' end as confidence,
       case when lower(regexp_replace(a.name, '\s+', '', 'g')) = lower(regexp_replace(b.name, '\s+', '', 'g')) then 'نفس الاسم'
            when a.latitude is not null and b.latitude is not null
                 and round(a.latitude::numeric, 4) = round(b.latitude::numeric, 4)
                 and round(a.longitude::numeric, 4) = round(b.longitude::numeric, 4) then 'إحداثيات متطابقة (راجع موقع المشروع على الخريطة)'
            else 'نفس النوع والحي والسعر' end as reason
from public.projects a
join public.projects b on b.id > a.id
where a.deleted_at is null and b.deleted_at is null
  and (lower(regexp_replace(a.name, '\s+', '', 'g')) = lower(regexp_replace(b.name, '\s+', '', 'g'))
    or (a.type = b.type and a.district is not null and a.district = b.district and a.price = b.price and a.price > 0)
    or (a.latitude is not null and b.latitude is not null
        and round(a.latitude::numeric, 4) = round(b.latitude::numeric, 4)
        and round(a.longitude::numeric, 4) = round(b.longitude::numeric, 4)));
revoke all on public.v_inventory_duplicates from anon;
grant select on public.v_inventory_duplicates to authenticated;

-- ملخص العملاء لقائمة الـ CRM: عدد الطلبات المفتوحة، آخر حدث، والمتابعة القادمة (يخضع لصلاحيات المستخدم نفسه)
create or replace view public.v_clients_overview with (security_invoker = true) as
select c.id, c.full_name, c.phone, c.client_type, c.city, c.status, c.owner_id, c.created_by, c.created_at, c.updated_at,
       (select count(*) from public.client_requirements r where r.client_id = c.id and r.status = 'open') as open_requirements,
       (select max(e.created_at) from public.crm_events e where e.client_id = c.id) as last_event_at,
       (select min(f.due_at) from public.follow_ups f where f.client_id = c.id and f.status = 'pending') as next_follow_up_at
from public.clients c;
revoke all on public.v_clients_overview from anon;
grant select on public.v_clients_overview to authenticated;

-- ---------- طُبّق لاحقاً باسم my_work_riyadh_day ----------
-- عملي اليوم: حدود اليوم بتوقيت الرياض لا UTC، ودالتان لمفردات المخزون الفعلية (أنواع الوحدات والأحياء)
create or replace view public.v_my_work with (security_invoker = true) as
select
    (select count(*) from public.follow_ups f where f.status = 'pending'
        and (f.due_at at time zone 'Asia/Riyadh')::date = (now() at time zone 'Asia/Riyadh')::date)   as follow_ups_today,
    (select count(*) from public.follow_ups f where f.status = 'pending'
        and (f.due_at at time zone 'Asia/Riyadh')::date < (now() at time zone 'Asia/Riyadh')::date)   as follow_ups_overdue,
    (select count(*) from public.client_requirements r where r.status = 'open' and r.created_at >= now() - interval '7 days') as new_requirements_7d,
    (select count(*) from public.property_matches m where m.state = 'viewing'
        and (m.updated_at at time zone 'Asia/Riyadh')::date = (now() at time zone 'Asia/Riyadh')::date) as viewings_today,
    (select count(*) from public.clients c where c.status = 'active') as active_clients;

create or replace function public.crm_property_types()
returns table (property_type text, units bigint)
language sql stable security invoker set search_path = public as $$
    select u.unit_type, count(*) from public.v_units u
    where u.unit_type is not null and u.status = 'approved' and u.deleted_at is null
    group by u.unit_type order by count(*) desc
$$;
revoke execute on function public.crm_property_types() from public, anon;
grant  execute on function public.crm_property_types() to authenticated;

create or replace function public.crm_districts()
returns table (district text, projects bigint)
language sql stable security invoker set search_path = public as $$
    select p.district, count(*) from public.projects p
    where p.district is not null and p.status = 'approved' and p.deleted_at is null
    group by p.district order by count(*) desc, p.district
$$;
revoke execute on function public.crm_districts() from public, anon;
grant  execute on function public.crm_districts() to authenticated;
