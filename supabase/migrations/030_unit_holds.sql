-- 030: الوحدة المحجوزة أو المبيعة تظهر كذلك وحدها، من مرحلة صفقتها.
--
-- «عربون» أو «عقد وإفراغ» → «محجوزة»، و«تمت» → «مباعة». والرجوع إلى مرحلة قبلها، أو «خسرت»، أو حذف
-- الصفقة، أو تغيير وحدتها → تعود الوحدة كما كانت.
-- لا يُكتب شيء في projects: projects_guard (019) يعيد المشروع «بانتظار الاعتماد» لأي تعديل من غير المدير،
-- والوسيط هو من ينقل صفقته. فالحجوزات في جدول unit_holds يكتبه مشغّل على deals، و v_units تحسب منها
-- حالة الوحدة. الحالة المخزّنة يدوياً تبقى الحكم إن لم تكن «متاحة».
-- النموذج الذي له عدد (count > 1) يبقى «متاحاً» حتى تُحجز أو تُباع كل وحداته، والباقي في العمود الجديد units_left.
-- صفقة «كامل العقار» (بلا وحدة) تحجز صف العقار الكامل فقط، أي المشروع الذي لا نماذج له.
--
-- v_units تُستبدل بـ create or replace (لا drop): v_inventory_attention (008) تعتمد عليها. الأعمدة القديمة
-- بترتيبها وأنواعها، و units_left في آخرها. تطبيقها مرة ثانية لا يغيّر شيئاً.

create table if not exists public.unit_holds (
    deal_id    uuid primary key references public.deals(id) on delete cascade,
    project_id integer not null references public.projects(id) on delete cascade,
    unit_key   text,
    status     text not null check (status in ('reserved', 'sold')),
    updated_at timestamptz not null default now()
);
create index if not exists unit_holds_unit_idx on public.unit_holds (project_id, unit_key);

-- قراءة فقط للجميع (حالة الوحدة يجب أن يراها كل موظف، ولو كانت الصفقة لزميل)؛ الكتابة للمشغّل وحده
alter table public.unit_holds enable row level security;
revoke all on public.unit_holds from public, anon, authenticated;
grant select on public.unit_holds to authenticated;
drop policy if exists unit_holds_read on public.unit_holds;
create policy unit_holds_read on public.unit_holds for select to authenticated using (true);

create or replace function public.deals_unit_hold() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_key text; v_won boolean; v_status text;
begin
    select s.key, s.is_won into v_key, v_won from public.deal_stages s where s.id = new.stage_id;
    v_status := case when v_won then 'sold' when v_key in ('deposit', 'contract') then 'reserved' end;
    if v_status is null or new.project_id is null then
        delete from public.unit_holds where deal_id = new.id;
    else
        insert into public.unit_holds (deal_id, project_id, unit_key, status, updated_at)
        values (new.id, new.project_id, nullif(btrim(new.unit_key), ''), v_status, now())
        on conflict (deal_id) do update
            set project_id = excluded.project_id, unit_key = excluded.unit_key,
                status = excluded.status, updated_at = now();
    end if;
    return null;
end $$;
revoke execute on function public.deals_unit_hold() from public, anon, authenticated;
drop trigger if exists deals_unit_hold on public.deals;
create trigger deals_unit_hold after insert or update of stage_id, project_id, unit_key on public.deals
for each row execute function public.deals_unit_hold();

-- الصفقات القائمة اليوم في «عربون» أو «عقد وإفراغ» أو «تمت»
insert into public.unit_holds (deal_id, project_id, unit_key, status)
select d.id, d.project_id, nullif(btrim(d.unit_key), ''), case when s.is_won then 'sold' else 'reserved' end
from public.deals d
join public.deal_stages s on s.id = d.stage_id
where d.project_id is not null and (s.is_won or s.key in ('deposit', 'contract'))
on conflict (deal_id) do nothing;

create or replace view public.v_units with (security_invoker = true) as
with base as (
    select p.id as project_id, p.name as project_name, p.type as project_type,
           p.purpose, p.city, p.district, p.district_inferred,
           p.status, p.availability, p.deleted_at, p.listing_expires_at, p.latitude, p.longitude,
           case when jsonb_typeof(p.images) = 'array' then p.images->>0 end as project_image,
           coalesce(nullif(p.details->>'developer', ''), nullif(p.details->>'developer_name', ''), nullif(p.details->>'developerName', '')) as developer,
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
           case when jsonb_typeof(p.images) = 'array' then p.images->>0 end,
           coalesce(nullif(p.details->>'developer', ''), nullif(p.details->>'developer_name', ''), nullif(p.details->>'developerName', '')),
           p.details->>'construction_status',
           0, 'كامل العقار', p.type, p.rooms, null::int, p.area, p.price, null::numeric, 1, p.availability
    from public.projects p
    where jsonb_typeof(p.details->'models') is distinct from 'array'
       or jsonb_array_length(p.details->'models') = 0
), held as (
    select h.project_id, h.unit_key,
           count(*) filter (where h.status = 'sold') as n_sold,
           count(*) as n_held
    from public.unit_holds h
    group by h.project_id, h.unit_key
)
select b.project_id, b.project_name, b.project_type, b.purpose, b.city, b.district, b.district_inferred,
       b.status, b.availability, b.deleted_at, b.listing_expires_at, b.latitude, b.longitude,
       b.project_image, b.developer, b.construction_status,
       b.unit_ord, b.unit_key, b.unit_type, b.rooms, b.bathrooms, b.area, b.price, b.unit_commission, b.unit_count,
       case
           when b.unit_status <> 'available' or h.n_held is null or h.n_held < b.unit_count then b.unit_status
           when h.n_sold >= b.unit_count then 'sold'
           else 'reserved'
       end as unit_status,
       greatest(b.unit_count - coalesce(h.n_held, 0), 0)::int as units_left
from base b
left join held h on h.project_id = b.project_id
               and h.unit_key is not distinct from (case when b.unit_ord = 0 then null else b.unit_key end);
revoke all on public.v_units from anon;
grant select on public.v_units to authenticated;
