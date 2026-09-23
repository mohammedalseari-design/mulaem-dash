-- 005_crm_core — المراحل 2-4: العملاء، الطلبات، المطابقة، المتابعات، سجل الأحداث
-- طُبّقت على المشروع الحي بتاريخ 2026-09-18 (crm_core + crm_core_fk_indexes)
-- قاعدة الملكية: الوسيط (field) يرى عملاءه فقط، الكول سنتر ينشئ العميل ويسنده، المدير يرى الكل ويعيد الإسناد.
-- المبدأ الثابت: السيرفر يحدد المالك والمنشئ والفاعل من هوية الحساب، ولا يُقبل ما يرسله المتصفح.

-- ---------- دوال مساعدة ----------
create or replace function public.normalize_phone(p text) returns text
language plpgsql immutable set search_path = public as $$
declare d text;
begin
    if p is null then return null; end if;
    d := regexp_replace(p, '[^0-9+]', '', 'g');
    if d like '00%' then d := '+' || substr(d, 3); end if;
    if d like '+%' then return '+' || regexp_replace(d, '[^0-9]', '', 'g'); end if;
    if d ~ '^966\d{9}$' then return '+' || d; end if;
    if d ~ '^05\d{8}$'  then return '+966' || substr(d, 2); end if;
    if d ~ '^5\d{8}$'   then return '+966' || d; end if;
    return nullif(d, '');
end $$;
revoke execute on function public.normalize_phone(text) from public, anon;
grant  execute on function public.normalize_phone(text) to authenticated;

-- ---------- العملاء ----------
create table if not exists public.clients (
    id                uuid primary key default gen_random_uuid(),
    full_name         text not null,
    phone             text not null,
    phone_alt         text,
    email             text,
    source            text,                                   -- إعلان / توصية / اتصال / معرض / موقع / واتساب
    client_type       text check (client_type in ('buy', 'rent', 'sell', 'invest')),
    city              text,
    status            text not null default 'active' check (status in ('active', 'inactive', 'blacklist')),
    owner_id          uuid references public.profiles(id),    -- الوسيط المسؤول (null = غير مسند)
    created_by        uuid references public.profiles(id),
    whatsapp_opt_in   boolean not null default false,          -- محجوز للمستقبل
    preferred_channel text,                                    -- محجوز للمستقبل
    notes             text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);
create unique index if not exists clients_phone_uk on public.clients (phone);
create index if not exists clients_owner_idx      on public.clients (owner_id, status);
create index if not exists clients_created_by_idx on public.clients (created_by);

create or replace function public.crm_can_see_client(p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from public.clients c
        where c.id = p_client
          and (public.is_admin() or c.owner_id = (select auth.uid()) or c.created_by = (select auth.uid()))
    )
$$;
revoke execute on function public.crm_can_see_client(uuid) from public, anon;
grant  execute on function public.crm_can_see_client(uuid) to authenticated;

create or replace function public.clients_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_role text; v_city text;
begin
    new.phone     := public.normalize_phone(new.phone);
    new.phone_alt := public.normalize_phone(new.phone_alt);
    new.full_name := btrim(new.full_name);
    if new.city is null then
        select value #>> '{}' into v_city from public.crm_settings where key = 'default_city';
        new.city := v_city;
    end if;
    if tg_op = 'UPDATE' then
        new.updated_at := now();
        new.created_by := old.created_by;
        new.created_at := old.created_at;
    end if;
    if v_uid is null then
        return new;                                            -- استيراد/صيانة من لوحة Supabase
    end if;
    v_role := public.my_role();
    if v_role is null then raise exception 'غير مصرح'; end if;
    if tg_op = 'INSERT' then
        new.created_by := v_uid;
        if v_role = 'field' then
            new.owner_id := v_uid;                             -- الوسيط يملك ما ينشئه
        end if;
        -- المدير والكول سنتر: يسندان لوسيط أو يتركانه غير مسند
    else
        if v_role = 'field' then
            new.owner_id := old.owner_id;                      -- الوسيط لا يغيّر الإسناد
        elsif v_role = 'callcenter' and old.owner_id is not null and new.owner_id is distinct from old.owner_id then
            raise exception 'إعادة إسناد العميل للمدير فقط';
        end if;
    end if;
    return new;
end $$;
revoke execute on function public.clients_guard() from public, anon, authenticated;
drop trigger if exists clients_guard on public.clients;
create trigger clients_guard before insert or update on public.clients
for each row execute function public.clients_guard();

-- ---------- طلبات العملاء (عميل واحد، طلبات كثيرة عبر الزمن) ----------
create table if not exists public.client_requirements (
    id              uuid primary key default gen_random_uuid(),
    client_id       uuid not null references public.clients(id) on delete cascade,
    purpose         text not null check (purpose in ('sale', 'rent')),
    property_type   text not null,                             -- نفس مفردات projects.type: شقة، فيلا، ...
    city            text,
    districts       text[] not null default '{}',
    budget_min      numeric(14,2),
    budget_max      numeric(14,2),
    area_min        numeric(10,2),
    area_max        numeric(10,2),
    rooms_min       integer,
    delivery_before date,
    financing_type  text,                                      -- نقد / تمويل / مدعوم
    priority        smallint not null default 2 check (priority between 1 and 3),
    status          text not null default 'open' check (status in ('open', 'matched', 'won', 'closed')),
    closed_reason   text,
    notes           text,
    owner_id        uuid references public.profiles(id),
    created_by      uuid references public.profiles(id),
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    constraint requirements_budget_order check (budget_min is null or budget_max is null or budget_min <= budget_max),
    constraint requirements_area_order   check (area_min   is null or area_max   is null or area_min   <= area_max)
);
create index if not exists requirements_client_idx     on public.client_requirements (client_id, status);
create index if not exists requirements_open_idx       on public.client_requirements (purpose, property_type, city) where status = 'open';
create index if not exists requirements_owner_idx      on public.client_requirements (owner_id);
create index if not exists requirements_created_by_idx on public.client_requirements (created_by);

create or replace function public.requirements_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_city text;
begin
    new.property_type := btrim(new.property_type);
    select c.owner_id, coalesce(new.city, c.city) into new.owner_id, v_city from public.clients c where c.id = new.client_id;
    new.city := v_city;
    if new.city is null then
        select value #>> '{}' into new.city from public.crm_settings where key = 'default_city';
    end if;
    if tg_op = 'UPDATE' then
        new.updated_at := now();
        new.created_by := old.created_by;
        new.created_at := old.created_at;
        new.client_id  := old.client_id;
    elsif v_uid is not null then
        new.created_by := v_uid;
    end if;
    return new;
end $$;
revoke execute on function public.requirements_guard() from public, anon, authenticated;
drop trigger if exists requirements_guard on public.client_requirements;
create trigger requirements_guard before insert or update on public.client_requirements
for each row execute function public.requirements_guard();

-- ---------- المطابقات المُتصرَّف فيها فقط (الحساب يتم عند الطلب) ----------
create table if not exists public.property_matches (
    id              uuid primary key default gen_random_uuid(),
    requirement_id  uuid not null references public.client_requirements(id) on delete cascade,
    project_id      integer not null references public.projects(id) on delete cascade,
    unit_key        text,
    score           numeric(5,2),
    score_breakdown jsonb not null default '{}',
    state           text not null default 'shared' check (state in ('shared', 'interested', 'not_interested', 'viewing')),
    note            text,
    created_by      uuid references public.profiles(id),
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);
create unique index if not exists matches_uk           on public.property_matches (requirement_id, project_id, coalesce(unit_key, ''));
create index if not exists matches_project_idx         on public.property_matches (project_id);
create index if not exists matches_created_by_idx      on public.property_matches (created_by);

create or replace function public.matches_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if tg_op = 'UPDATE' then
        new.updated_at := now();
        new.created_by := old.created_by; new.created_at := old.created_at;
        new.requirement_id := old.requirement_id; new.project_id := old.project_id; new.unit_key := old.unit_key;
    elsif auth.uid() is not null then
        new.created_by := auth.uid();
    end if;
    return new;
end $$;
revoke execute on function public.matches_guard() from public, anon, authenticated;
drop trigger if exists matches_guard on public.property_matches;
create trigger matches_guard before insert or update on public.property_matches
for each row execute function public.matches_guard();

-- ---------- المتابعات ----------
create table if not exists public.follow_ups (
    id             uuid primary key default gen_random_uuid(),
    client_id      uuid not null references public.clients(id) on delete cascade,
    requirement_id uuid references public.client_requirements(id) on delete set null,
    assigned_to    uuid references public.profiles(id),
    due_at         timestamptz not null,
    channel        text not null default 'call' check (channel in ('call', 'whatsapp', 'visit', 'other')),
    purpose        text,
    outcome        text,
    status         text not null default 'pending' check (status in ('pending', 'done', 'cancelled')),
    done_at        timestamptz,
    created_by     uuid references public.profiles(id),
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);
create index if not exists follow_ups_assignee_idx    on public.follow_ups (assigned_to, status, due_at);
create index if not exists follow_ups_client_idx      on public.follow_ups (client_id);
create index if not exists follow_ups_requirement_idx on public.follow_ups (requirement_id);
create index if not exists follow_ups_created_by_idx  on public.follow_ups (created_by);

create or replace function public.follow_ups_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_role text; v_owner uuid;
begin
    select owner_id into v_owner from public.clients where id = new.client_id;
    if tg_op = 'UPDATE' then
        new.updated_at := now();
        new.created_by := old.created_by; new.created_at := old.created_at; new.client_id := old.client_id;
        if new.status = 'done' and old.status <> 'done' and new.done_at is null then new.done_at := now(); end if;
        if new.status <> 'done' then new.done_at := null; end if;
    end if;
    if v_uid is not null then
        v_role := public.my_role();
        if v_role is null then raise exception 'غير مصرح'; end if;
        if tg_op = 'INSERT' then new.created_by := v_uid; end if;
        if v_role = 'field' then
            new.assigned_to := v_uid;                          -- الوسيط يتابع بنفسه
        end if;
    end if;
    if new.assigned_to is null then new.assigned_to := coalesce(v_owner, v_uid); end if;
    return new;
end $$;
revoke execute on function public.follow_ups_guard() from public, anon, authenticated;
drop trigger if exists follow_ups_guard on public.follow_ups;
create trigger follow_ups_guard before insert or update on public.follow_ups
for each row execute function public.follow_ups_guard();

-- ---------- سجل الأحداث (إلحاق فقط، مستقل عن سجل activities القديم) ----------
create table if not exists public.crm_events (
    id          bigint generated always as identity primary key,
    client_id   uuid references public.clients(id) on delete cascade,
    entity_type text not null check (entity_type in ('client', 'requirement', 'match', 'follow_up', 'property', 'note')),
    entity_id   text,
    event_type  text not null,
    payload     jsonb not null default '{}',
    actor_id    uuid references public.profiles(id),
    created_at  timestamptz not null default now()
);
create index if not exists crm_events_client_idx on public.crm_events (client_id, created_at desc);
create index if not exists crm_events_entity_idx on public.crm_events (entity_type, entity_id, created_at desc);
create index if not exists crm_events_actor_idx  on public.crm_events (actor_id);

create or replace function public.crm_events_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    new.actor_id   := coalesce(auth.uid(), new.actor_id);
    new.created_at := now();
    return new;
end $$;
revoke execute on function public.crm_events_guard() from public, anon, authenticated;
drop trigger if exists crm_events_guard on public.crm_events;
create trigger crm_events_guard before insert on public.crm_events
for each row execute function public.crm_events_guard();

-- تسجيل تلقائي للأحداث المهمة
create or replace function public.crm_log_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_type text; v_event text; v_payload jsonb := '{}';
begin
    if tg_table_name = 'clients' then
        v_client := new.id; v_type := 'client';
        if tg_op = 'INSERT' then v_event := 'client_created';
        elsif new.owner_id is distinct from old.owner_id then
            v_event := 'client_reassigned'; v_payload := jsonb_build_object('from', old.owner_id, 'to', new.owner_id);
        elsif new.status is distinct from old.status then
            v_event := 'client_status_changed'; v_payload := jsonb_build_object('from', old.status, 'to', new.status);
        else return null; end if;
    elsif tg_table_name = 'client_requirements' then
        v_client := new.client_id; v_type := 'requirement';
        if tg_op = 'INSERT' then
            v_event := 'requirement_created';
            v_payload := jsonb_build_object('purpose', new.purpose, 'property_type', new.property_type,
                                            'districts', new.districts, 'budget_max', new.budget_max);
        elsif new.status is distinct from old.status then
            v_event := 'requirement_status_changed'; v_payload := jsonb_build_object('from', old.status, 'to', new.status, 'reason', new.closed_reason);
        else return null; end if;
    elsif tg_table_name = 'property_matches' then
        select r.client_id into v_client from public.client_requirements r where r.id = new.requirement_id;
        v_type := 'match';
        if tg_op = 'INSERT' or new.state is distinct from old.state then
            v_event := 'match_' || new.state;
            v_payload := jsonb_build_object('project_id', new.project_id, 'unit_key', new.unit_key, 'score', new.score);
        else return null; end if;
    elsif tg_table_name = 'follow_ups' then
        v_client := new.client_id; v_type := 'follow_up';
        if tg_op = 'INSERT' then
            v_event := 'follow_up_scheduled'; v_payload := jsonb_build_object('due_at', new.due_at, 'channel', new.channel, 'purpose', new.purpose);
        elsif new.status is distinct from old.status then
            v_event := 'follow_up_' || new.status; v_payload := jsonb_build_object('outcome', new.outcome);
        else return null; end if;
    else
        return null;
    end if;
    insert into public.crm_events (client_id, entity_type, entity_id, event_type, payload, actor_id)
    values (v_client, v_type, new.id::text, v_event, v_payload, auth.uid());
    return null;
end $$;
revoke execute on function public.crm_log_event() from public, anon, authenticated;
drop trigger if exists clients_log on public.clients;
create trigger clients_log after insert or update on public.clients for each row execute function public.crm_log_event();
drop trigger if exists requirements_log on public.client_requirements;
create trigger requirements_log after insert or update on public.client_requirements for each row execute function public.crm_log_event();
drop trigger if exists matches_log on public.property_matches;
create trigger matches_log after insert or update on public.property_matches for each row execute function public.crm_log_event();
drop trigger if exists follow_ups_log on public.follow_ups;
create trigger follow_ups_log after insert or update on public.follow_ups for each row execute function public.crm_log_event();

-- ---------- الصلاحيات (RLS) ----------
alter table public.clients             enable row level security;
alter table public.client_requirements enable row level security;
alter table public.property_matches    enable row level security;
alter table public.follow_ups          enable row level security;
alter table public.crm_events          enable row level security;

revoke all on public.clients, public.client_requirements, public.property_matches, public.follow_ups, public.crm_events from anon;
grant select, insert, update, delete on public.clients             to authenticated;
grant select, insert, update, delete on public.client_requirements to authenticated;
grant select, insert, update, delete on public.property_matches    to authenticated;
grant select, insert, update, delete on public.follow_ups          to authenticated;
grant select, insert                  on public.crm_events         to authenticated;

-- العملاء
drop policy if exists clients_select on public.clients;
create policy clients_select on public.clients for select to authenticated
using (public.is_admin() or owner_id = (select auth.uid()) or created_by = (select auth.uid()));
drop policy if exists clients_insert on public.clients;
create policy clients_insert on public.clients for insert to authenticated
with check (public.my_role() in ('admin', 'field', 'callcenter'));
drop policy if exists clients_update on public.clients;
create policy clients_update on public.clients for update to authenticated
using (public.is_admin() or owner_id = (select auth.uid()) or (created_by = (select auth.uid()) and owner_id is null))
with check (public.is_admin() or owner_id = (select auth.uid()) or created_by = (select auth.uid()));
drop policy if exists clients_delete on public.clients;
create policy clients_delete on public.clients for delete to authenticated using (public.is_admin());

-- الطلبات: عبر رؤية العميل
drop policy if exists requirements_select on public.client_requirements;
create policy requirements_select on public.client_requirements for select to authenticated using (public.crm_can_see_client(client_id));
drop policy if exists requirements_insert on public.client_requirements;
create policy requirements_insert on public.client_requirements for insert to authenticated with check (public.crm_can_see_client(client_id));
drop policy if exists requirements_update on public.client_requirements;
create policy requirements_update on public.client_requirements for update to authenticated
using (public.crm_can_see_client(client_id)) with check (public.crm_can_see_client(client_id));
drop policy if exists requirements_delete on public.client_requirements;
create policy requirements_delete on public.client_requirements for delete to authenticated using (public.is_admin());

-- المطابقات: عبر رؤية عميل الطلب
create or replace function public.crm_can_see_requirement(p_req uuid) returns boolean
language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.client_requirements r where r.id = p_req and public.crm_can_see_client(r.client_id))
$$;
revoke execute on function public.crm_can_see_requirement(uuid) from public, anon;
grant  execute on function public.crm_can_see_requirement(uuid) to authenticated;

drop policy if exists matches_select on public.property_matches;
create policy matches_select on public.property_matches for select to authenticated using (public.crm_can_see_requirement(requirement_id));
drop policy if exists matches_insert on public.property_matches;
create policy matches_insert on public.property_matches for insert to authenticated with check (public.crm_can_see_requirement(requirement_id));
drop policy if exists matches_update on public.property_matches;
create policy matches_update on public.property_matches for update to authenticated
using (public.crm_can_see_requirement(requirement_id)) with check (public.crm_can_see_requirement(requirement_id));
drop policy if exists matches_delete on public.property_matches;
create policy matches_delete on public.property_matches for delete to authenticated using (public.is_admin());

-- المتابعات
drop policy if exists follow_ups_select on public.follow_ups;
create policy follow_ups_select on public.follow_ups for select to authenticated
using (public.is_admin() or assigned_to = (select auth.uid()) or created_by = (select auth.uid()) or public.crm_can_see_client(client_id));
drop policy if exists follow_ups_insert on public.follow_ups;
create policy follow_ups_insert on public.follow_ups for insert to authenticated with check (public.crm_can_see_client(client_id));
drop policy if exists follow_ups_update on public.follow_ups;
create policy follow_ups_update on public.follow_ups for update to authenticated
using (public.is_admin() or assigned_to = (select auth.uid()) or created_by = (select auth.uid()))
with check (public.is_admin() or assigned_to = (select auth.uid()) or created_by = (select auth.uid()));
drop policy if exists follow_ups_delete on public.follow_ups;
create policy follow_ups_delete on public.follow_ups for delete to authenticated using (public.is_admin());

-- الأحداث: قراءة حسب رؤية العميل، وإضافة يدوية (ملاحظة/مكالمة) بفاعل مفروض من السيرفر
drop policy if exists crm_events_select on public.crm_events;
create policy crm_events_select on public.crm_events for select to authenticated
using (public.is_admin() or actor_id = (select auth.uid()) or (client_id is not null and public.crm_can_see_client(client_id)));
drop policy if exists crm_events_insert on public.crm_events;
create policy crm_events_insert on public.crm_events for insert to authenticated
with check (public.my_role() is not null and (client_id is null or public.crm_can_see_client(client_id)));

-- ---------- المطابقة الحسابية ----------
insert into public.crm_settings (key, value)
values ('match_weights', '{"district": 35, "budget": 30, "area": 20, "rooms": 10, "delivery": 5}')
on conflict (key) do nothing;

-- فلاتر قاطعة: الغرض، نوع العقار، المدينة، معتمد، غير محذوف، متاح، غير منتهٍ. ثم درجة موزونة من 0 إلى 100.
-- تُستدعى من الواجهة: supabase.rpc('match_requirement', { p_requirement: '<uuid>' })
create or replace function public.match_requirement(p_requirement uuid)
returns table (
    project_id int, project_name text, unit_key text, unit_ord int, district text, district_inferred boolean,
    price numeric, area numeric, rooms int, bathrooms int, construction_status text,
    score numeric, breakdown jsonb
)
language plpgsql stable security invoker set search_path = public as $$
declare
    r  public.client_requirements%rowtype;
    w  jsonb;
    w_district numeric; w_budget numeric; w_area numeric; w_rooms numeric; w_delivery numeric; w_total numeric;
begin
    select * into r from public.client_requirements where id = p_requirement;
    if not found then return; end if;
    select value into w from public.crm_settings where key = 'match_weights';
    w_district := coalesce((w->>'district')::numeric, 35);
    w_budget   := coalesce((w->>'budget')::numeric,   30);
    w_area     := coalesce((w->>'area')::numeric,     20);
    w_rooms    := coalesce((w->>'rooms')::numeric,    10);
    w_delivery := coalesce((w->>'delivery')::numeric,  5);
    w_total    := w_district + w_budget + w_area + w_rooms + w_delivery;

    return query
    with cand as (
        select u.*
        from public.v_units u
        where u.purpose = r.purpose
          and u.unit_type = r.property_type
          and u.city = r.city
          and u.status = 'approved' and u.deleted_at is null
          and u.availability = 'available' and u.unit_status = 'available'
          and (u.listing_expires_at is null or u.listing_expires_at >= current_date)
          and not exists (select 1 from public.property_matches m
                           where m.requirement_id = r.id and m.project_id = u.project_id
                             and coalesce(m.unit_key, '') = coalesce(u.unit_key, '') and m.state = 'not_interested')
    ), scored as (
        select c.*,
            case when cardinality(r.districts) = 0 then 1
                 when c.district = any (r.districts) then 1 else 0 end::numeric as s_district,
            case when r.budget_min is null and r.budget_max is null then 1
                 when c.price is null then 0
                 when r.budget_max is not null and c.price > r.budget_max then
                      case when c.price <= r.budget_max * 1.10 then 0.6
                           when c.price <= r.budget_max * 1.20 then 0.3 else 0 end
                 when r.budget_min is not null and c.price < r.budget_min then 0.8
                 else 1 end::numeric as s_budget,
            case when r.area_min is null and r.area_max is null then 1
                 when c.area is null then 0.5
                 when r.area_min is not null and c.area < r.area_min then
                      case when c.area >= r.area_min * 0.90 then 0.7 when c.area >= r.area_min * 0.80 then 0.4 else 0 end
                 when r.area_max is not null and c.area > r.area_max then 0.9
                 else 1 end::numeric as s_area,
            case when r.rooms_min is null then 1
                 when c.rooms is null then 0.5
                 when c.rooms >= r.rooms_min then 1
                 when c.rooms = r.rooms_min - 1 then 0.5 else 0 end::numeric as s_rooms,
            case when r.delivery_before is null then 1
                 when c.construction_status = 'جاهز' then 1
                 else 0.5 end::numeric as s_delivery
        from cand c
    )
    select s.project_id, s.project_name, s.unit_key, s.unit_ord, s.district, s.district_inferred,
           s.price, s.area, s.rooms, s.bathrooms, s.construction_status,
           round((s.s_district * w_district + s.s_budget * w_budget + s.s_area * w_area
                + s.s_rooms * w_rooms + s.s_delivery * w_delivery) / w_total * 100, 1) as score,
           jsonb_build_object('district', s.s_district, 'budget', s.s_budget, 'area', s.s_area,
                              'rooms', s.s_rooms, 'delivery', s.s_delivery) as breakdown
    from scored s
    where (s.s_district * w_district + s.s_budget * w_budget + s.s_area * w_area
         + s.s_rooms * w_rooms + s.s_delivery * w_delivery) / w_total * 100 >= 40
    order by score desc, s.price asc nulls last
    limit 50;
end $$;
revoke execute on function public.match_requirement(uuid) from public, anon;
grant  execute on function public.match_requirement(uuid) to authenticated;

-- ---------- شاشة "عملي اليوم" (الأرقام تُحسب تحت صلاحيات المستخدم نفسه) ----------
create or replace view public.v_my_work with (security_invoker = true) as
select
    (select count(*) from public.follow_ups f where f.status = 'pending' and f.due_at::date = current_date)      as follow_ups_today,
    (select count(*) from public.follow_ups f where f.status = 'pending' and f.due_at < date_trunc('day', now())) as follow_ups_overdue,
    (select count(*) from public.client_requirements r where r.status = 'open' and r.created_at >= now() - interval '7 days') as new_requirements_7d,
    (select count(*) from public.property_matches m where m.state = 'viewing' and m.updated_at::date = current_date) as viewings_today,
    (select count(*) from public.clients c where c.status = 'active') as active_clients;
revoke all on public.v_my_work from anon;
grant select on public.v_my_work to authenticated;
