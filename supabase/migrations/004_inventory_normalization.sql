-- 004_inventory_normalization — المرحلة 1: تهيئة المخزون للمطابقة
-- طُبّقت على المشروع الحي بتاريخ 2026-09-18 (inventory_normalization + fix_normalize_district_search_path)
-- المبدأ: إضافات فقط. اللوحة القديمة تتجاهل الأعمدة الجديدة قراءةً وكتابةً (projectOut/projectIn في الـ shim).

-- 1) إعدادات الـ CRM: مفاتيح قابلة للتعديل من المدير بلا نشر
create table if not exists public.crm_settings (
    key        text primary key,
    value      jsonb not null,
    updated_at timestamptz not null default now()
);
alter table public.crm_settings enable row level security;
revoke all on public.crm_settings from anon;
grant select, insert, update, delete on public.crm_settings to authenticated;
drop policy if exists crm_settings_read on public.crm_settings;
create policy crm_settings_read on public.crm_settings for select to authenticated using (true);
drop policy if exists crm_settings_insert_admin on public.crm_settings;
create policy crm_settings_insert_admin on public.crm_settings for insert to authenticated with check (public.is_admin());
drop policy if exists crm_settings_update_admin on public.crm_settings;
create policy crm_settings_update_admin on public.crm_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists crm_settings_delete_admin on public.crm_settings;
create policy crm_settings_delete_admin on public.crm_settings for delete to authenticated using (public.is_admin());
insert into public.crm_settings (key, value) values ('default_city', '"جدة"') on conflict (key) do nothing;

-- 2) أعمدة إضافية على العقارات. كلها اختيارية
alter table public.projects
    add column if not exists purpose            text check (purpose in ('sale', 'rent')),
    add column if not exists city               text,
    add column if not exists district           text,
    add column if not exists district_inferred  boolean not null default false,  -- الحي مستنتج (من الاسم أو أقرب مشروع) ويحتاج مراجعة
    add column if not exists rooms              integer,
    add column if not exists delivery_date      date,
    add column if not exists rega_ad_license    text,                            -- رقم ترخيص الإعلان العقاري (الهيئة العامة للعقار)
    add column if not exists listing_expires_at date;
create index if not exists projects_purpose_type_city_idx on public.projects (purpose, type, city);
create index if not exists projects_district_idx           on public.projects (district);

-- 3) استخراج اسم الحي من نص العنوان الحر
--    "حي الحمراء شارع الحمراء" → الحمراء | "جدة حي الصفا" → الصفا | "ابحر الجنوبية" → ابحر الجنوبية
create or replace function public.normalize_district(p_address text) returns text
language sql immutable set search_path = public as $$
    select nullif(btrim(regexp_replace(
        case
            when p_address ~ 'حي\s+'
                then substring(p_address from 'حي\s+(.*?)(?:\s+(?:شارع|طريق|مخطط|بجوار|قرب)(?:\s.*)?)?$')
            else regexp_replace(regexp_replace(p_address, '^\s*جدة\s+', ''), '\s+جدة\s*$', '')
        end, '\s+', ' ', 'g')), '')
$$;
revoke execute on function public.normalize_district(text) from public, anon;
grant  execute on function public.normalize_district(text) to authenticated;

-- 4) مشغّل الإثراء: يملأ الحقول الجديدة إن كانت فارغة، ولا يكتب فوق قيمة أدخلها المستخدم
create or replace function public.projects_enrich() returns trigger
language plpgsql security definer set search_path = public as $$
declare
    v_city text;
begin
    -- عند تعديل العنوان من اللوحة القديمة: أعد استخراج الحي إن كان مستخرجاً آلياً أصلاً
    if tg_op = 'UPDATE' and new.address is distinct from old.address
       and new.district is not distinct from old.district
       and (old.district is null or old.district_inferred or old.district = public.normalize_district(old.address)) then
        new.district          := public.normalize_district(new.address);
        new.district_inferred := false;
    end if;

    if new.purpose is null then
        new.purpose := 'sale';
    end if;
    if new.district is null and new.address is not null then
        new.district          := public.normalize_district(new.address);
        new.district_inferred := false;
    end if;
    if new.city is null then
        select value #>> '{}' into v_city from public.crm_settings where key = 'default_city';
        new.city := v_city;
    end if;
    if new.rooms is null and (new.details->>'rooms') ~ '^\d+$' then
        new.rooms := (new.details->>'rooms')::int;
    end if;
    return new;
end
$$;
revoke execute on function public.projects_enrich() from public, anon, authenticated;
drop trigger if exists projects_enrich on public.projects;
create trigger projects_enrich before insert or update on public.projects
for each row execute function public.projects_enrich();

-- 5) تعبئة البيانات الحالية
update public.projects set purpose = 'sale' where purpose is null;
update public.projects set city = 'جدة' where city is null;
update public.projects set district = public.normalize_district(address), district_inferred = false
 where district is null and address is not null;
update public.projects set rooms = (details->>'rooms')::int
 where rooms is null and (details->>'rooms') ~ '^\d+$';

-- المشاريع بلا عنوان: (أ) من اسم المشروع إن ذُكر فيه الحي
update public.projects
   set district = regexp_replace(public.normalize_district(name), '\s*\d+$', ''), district_inferred = true
 where district is null and address is null and name ~ 'حي\s+' and public.normalize_district(name) is not null;

-- (ب) وإلا حي أقرب مشروع معروف الحي ضمن 2 كم، مع وسم القيمة كمستنتجة لمراجعة المدير
with missing as (
    select id, latitude, longitude from public.projects
    where district is null and latitude is not null and longitude is not null
), nearest as (
    select m.id,
        (select q.district from public.projects q
          where q.district is not null and q.district_inferred = false and q.id <> m.id
            and q.latitude is not null and q.longitude is not null
            and sqrt(power((q.latitude - m.latitude) * 111.0, 2)
                   + power((q.longitude - m.longitude) * 111.0 * cos(radians(m.latitude)), 2)) <= 2.0
          order by sqrt(power((q.latitude - m.latitude) * 111.0, 2)
                      + power((q.longitude - m.longitude) * 111.0 * cos(radians(m.latitude)), 2))
          limit 1) as district
    from missing m
)
update public.projects p set district = n.district, district_inferred = true
from nearest n where n.id = p.id and n.district is not null;

-- 6) عرض الوحدات: يفكّ نماذج الشقق من details.models إلى صفوف قابلة للمطابقة، بلا تغيير في الجدول الأصلي.
--    ملاحظة جوهرية: projects.price للشقق هو مجموع أسعار النماذج، فالمطابقة بالميزانية تكون على الوحدة لا المشروع.
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
       case when (m.model->>'area')      ~ '^\d+(\.\d+)?$'  then (m.model->>'area')::numeric   end as area,
       case when (m.model->>'price')     ~ '^\d+(\.\d+)?$'  then (m.model->>'price')::numeric  end as price,
    case when (m.model->>'commission') ~ '^\d+(\.\d+)?$' then (m.model->>'commission')::numeric end as unit_commission,
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
    0, 'كامل العقار', p.type, p.rooms, null::int, p.area, p.price, null::numeric, 1, p.availability
from public.projects p
where jsonb_typeof(p.details->'models') is distinct from 'array'
   or jsonb_array_length(p.details->'models') = 0;
revoke all on public.v_units from anon;
grant select on public.v_units to authenticated;
