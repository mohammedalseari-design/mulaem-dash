-- 007_deals_commissions — المراحل 5-7: مسار الصفقات، العمولات، وتقارير الإدارة
-- طُبّقت على المشروع الحي بتاريخ 2026-09-18 باسم deals_and_commissions (+ project_images_update_policy + crm_staff_directory المسجلتان هنا)
-- الكول سنتر لا يرى الصفقات ولا العمولات. الوسيط يرى صفقاته وعمولاته (قراءة فقط للعمولات). المدير يرى ويكتب الكل.

-- ---------- (مسجلة هنا) دليل الموظفين النشطين للواجهة: crm_staff_directory ----------
create or replace function public.crm_staff()
returns table (id uuid, legacy_id int, username text, fullname text, role text)
language sql stable security definer set search_path = public as $$
    select p.id, p.legacy_id, p.username, coalesce(p.fullname, p.username), p.role
    from public.profiles p
    where not p.is_blocked and public.my_role() is not null
    order by p.role, p.fullname
$$;
revoke execute on function public.crm_staff() from public, anon;
grant  execute on function public.crm_staff() to authenticated;

-- ---------- (مسجلة هنا) سياسات مخزن الصور: project_images_update_policy ----------
-- رفع الصور بوضع upsert يحتاج سياسة تحديث إلى جانب سياسة الإدراج، وإلا رفضه المخزن بخطأ 400
drop policy if exists project_images_update on storage.objects;
create policy project_images_update on storage.objects for update to authenticated
using (bucket_id = 'project-images' and public.is_admin())
with check (bucket_id = 'project-images' and public.is_admin());
drop policy if exists project_images_select on storage.objects;
create policy project_images_select on storage.objects for select to authenticated
using (bucket_id = 'project-images');

-- ---------- مراجع ----------
create table if not exists public.deal_stages (
    id          smallint primary key,
    key         text not null unique,
    name_ar     text not null,
    sort_order  smallint not null,
    is_terminal boolean not null default false,
    is_won      boolean not null default false
);
insert into public.deal_stages (id, key, name_ar, sort_order, is_terminal, is_won) values
    (1, 'new',         'اهتمام جدي', 1, false, false),
    (2, 'viewing',     'معاينة',     2, false, false),
    (3, 'negotiation', 'تفاوض',      3, false, false),
    (4, 'deposit',     'عربون',      4, false, false),
    (5, 'contract',    'عقد وإفراغ', 5, false, false),
    (6, 'closed_won',  'تمت',        6, true,  true),
    (7, 'closed_lost', 'خسرت',       7, true,  false)
on conflict (id) do nothing;

create table if not exists public.lost_reasons (
    id        smallint generated always as identity primary key,
    key       text not null unique,
    name_ar   text not null,
    is_active boolean not null default true
);
insert into public.lost_reasons (key, name_ar) values
    ('price', 'السعر'), ('financing', 'التمويل'), ('location', 'الموقع'), ('seller', 'البائع'),
    ('client_disappeared', 'انقطع العميل'), ('bought_elsewhere', 'اشترى من مكان آخر'), ('other', 'أخرى')
on conflict (key) do nothing;

-- ---------- الصفقات ----------
create table if not exists public.deals (
    id                  uuid primary key default gen_random_uuid(),
    client_id           uuid not null references public.clients(id),
    requirement_id      uuid references public.client_requirements(id) on delete set null,
    project_id          integer references public.projects(id) on delete set null,
    unit_key            text,
    broker_id           uuid references public.profiles(id),
    stage_id            smallint not null default 1 references public.deal_stages(id),
    amount              numeric(14,2),
    expected_close_date date,
    lost_reason_id      smallint references public.lost_reasons(id),
    lost_note           text,
    opened_at           timestamptz not null default now(),
    closed_at           timestamptz,
    created_by          uuid references public.profiles(id),
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    constraint deals_lost_reason_required check (stage_id <> 7 or lost_reason_id is not null)
);
create index if not exists deals_broker_stage_idx on public.deals (broker_id, stage_id);
create index if not exists deals_client_idx       on public.deals (client_id);
create index if not exists deals_project_idx      on public.deals (project_id);
create index if not exists deals_requirement_idx  on public.deals (requirement_id);
create index if not exists deals_created_by_idx   on public.deals (created_by);

create table if not exists public.deal_stage_history (
    id         bigint generated always as identity primary key,
    deal_id    uuid not null references public.deals(id) on delete cascade,
    from_stage smallint,
    to_stage   smallint not null,
    note       text,
    changed_by uuid references public.profiles(id),
    changed_at timestamptz not null default now()
);
create index if not exists deal_history_deal_idx on public.deal_stage_history (deal_id, changed_at desc);
create index if not exists deal_history_by_idx   on public.deal_stage_history (changed_by);

-- ---------- العمولات ----------
create table if not exists public.commissions (
    id               uuid primary key default gen_random_uuid(),
    deal_id          uuid not null unique references public.deals(id) on delete restrict,
    base_amount      numeric(14,2) not null,                               -- قيمة الصفقة
    rate_percent     numeric(5,2)  not null default 2.5,
    vat_rate         numeric(5,2)  not null default 15,
    gross_amount     numeric(14,2) generated always as (round(base_amount * rate_percent / 100, 2)) stored,
    vat_amount       numeric(14,2) generated always as (round(base_amount * rate_percent / 100 * vat_rate / 100, 2)) stored,
    company_share    numeric(14,2) not null default 0,
    broker_share     numeric(14,2) not null default 0,
    external_share   numeric(14,2) not null default 0,
    external_party   text,
    status           text not null default 'due' check (status in ('due', 'invoiced', 'partial', 'collected', 'waived')),
    collected_amount numeric(14,2) not null default 0,
    collected_at     date,
    invoice_no       text,
    notes            text,
    created_by       uuid references public.profiles(id),
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    constraint commissions_shares_balance check (company_share + broker_share + external_share <= round(base_amount * rate_percent / 100, 2) + 0.01),
    constraint commissions_collected_range check (collected_amount >= 0 and collected_amount <= round(base_amount * rate_percent / 100, 2) + 0.01)
);
create index if not exists commissions_created_by_idx on public.commissions (created_by);

-- ---------- دوال مساعدة ----------
create or replace function public.crm_can_see_deal(p_deal uuid) returns boolean
language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from public.deals d
        where d.id = p_deal
          and (public.is_admin() or d.broker_id = (select auth.uid()) or d.created_by = (select auth.uid()))
    )
$$;
revoke execute on function public.crm_can_see_deal(uuid) from public, anon;
grant  execute on function public.crm_can_see_deal(uuid) to authenticated;

-- ---------- مشغّلات الصفقات ----------
create or replace function public.deals_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_role text; v_owner uuid; v_terminal boolean;
begin
    select owner_id into v_owner from public.clients where id = new.client_id;
    select is_terminal into v_terminal from public.deal_stages where id = new.stage_id;
    if tg_op = 'UPDATE' then
        new.updated_at := now();
        new.created_by := old.created_by; new.created_at := old.created_at; new.client_id := old.client_id;
        if new.stage_id is distinct from old.stage_id then
            new.closed_at := case when v_terminal then now() else null end;
            if new.stage_id <> 7 then new.lost_reason_id := null; new.lost_note := null; end if;
        end if;
    else
        if v_terminal then new.closed_at := now(); end if;
    end if;
    if v_uid is not null then
        v_role := public.my_role();
        if v_role is null then raise exception 'غير مصرح'; end if;
        if tg_op = 'INSERT' then new.created_by := v_uid; end if;
        if v_role = 'field' then
            new.broker_id := case when tg_op = 'INSERT' then v_uid else old.broker_id end;   -- الوسيط لا يغيّر مالك الصفقة
        end if;
    end if;
    if new.broker_id is null then new.broker_id := coalesce(v_owner, v_uid); end if;
    return new;
end $$;
revoke execute on function public.deals_guard() from public, anon, authenticated;
drop trigger if exists deals_guard on public.deals;
create trigger deals_guard before insert or update on public.deals
for each row execute function public.deals_guard();

-- سجل المراحل + الحدث + إنشاء العمولة تلقائياً عند الإتمام
create or replace function public.deals_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_stage_name text; v_won boolean;
begin
    select name_ar, is_won into v_stage_name, v_won from public.deal_stages where id = new.stage_id;
    if tg_op = 'INSERT' then
        insert into public.deal_stage_history (deal_id, from_stage, to_stage, changed_by) values (new.id, null, new.stage_id, auth.uid());
        insert into public.crm_events (client_id, entity_type, entity_id, event_type, payload, actor_id)
        values (new.client_id, 'deal', new.id::text, 'deal_opened',
                jsonb_build_object('project_id', new.project_id, 'unit_key', new.unit_key, 'amount', new.amount, 'stage', v_stage_name), auth.uid());
    elsif new.stage_id is distinct from old.stage_id then
        insert into public.deal_stage_history (deal_id, from_stage, to_stage, note, changed_by)
        values (new.id, old.stage_id, new.stage_id, new.lost_note, auth.uid());
        insert into public.crm_events (client_id, entity_type, entity_id, event_type, payload, actor_id)
        values (new.client_id, 'deal', new.id::text, 'deal_stage_changed',
                jsonb_build_object('from', old.stage_id, 'to', new.stage_id, 'stage', v_stage_name,
                                   'lost_reason_id', new.lost_reason_id, 'amount', new.amount), auth.uid());
        if v_won and new.amount is not null then
            insert into public.commissions (deal_id, base_amount, created_by)
            values (new.id, new.amount, auth.uid())
            on conflict (deal_id) do nothing;
            -- تنبيه للمدير: العقار أصبح مباعاً فعلياً، ويقرر هو تحديث حالته في اللوحة
            if new.project_id is not null then
                insert into public.crm_events (client_id, entity_type, entity_id, event_type, payload, actor_id)
                values (new.client_id, 'property', new.project_id::text, 'property_sold_flag',
                        jsonb_build_object('deal_id', new.id, 'unit_key', new.unit_key), auth.uid());
            end if;
        end if;
    end if;
    return null;
end $$;
revoke execute on function public.deals_after() from public, anon, authenticated;
drop trigger if exists deals_after on public.deals;
create trigger deals_after after insert or update on public.deals
for each row execute function public.deals_after();

-- ---------- مشغّلات العمولات ----------
create or replace function public.commissions_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_gross numeric;
begin
    v_gross := round(new.base_amount * new.rate_percent / 100, 2);
    if tg_op = 'UPDATE' then
        new.updated_at := now();
        new.created_by := old.created_by; new.created_at := old.created_at; new.deal_id := old.deal_id;
    elsif auth.uid() is not null then
        new.created_by := auth.uid();
    end if;
    -- الحالة تُشتق من التحصيل ما لم تكن معفاة
    if new.status <> 'waived' then
        if new.collected_amount >= v_gross - 0.01 and v_gross > 0 then new.status := 'collected';
        elsif new.collected_amount > 0 then new.status := 'partial';
        elsif new.status in ('collected', 'partial') then new.status := 'due';
        end if;
    end if;
    if new.status = 'collected' and new.collected_at is null then new.collected_at := current_date; end if;
    return new;
end $$;
revoke execute on function public.commissions_guard() from public, anon, authenticated;
drop trigger if exists commissions_guard on public.commissions;
create trigger commissions_guard before insert or update on public.commissions
for each row execute function public.commissions_guard();

create or replace function public.commissions_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_client uuid;
begin
    select client_id into v_client from public.deals where id = new.deal_id;
    if tg_op = 'INSERT' then
        insert into public.crm_events (client_id, entity_type, entity_id, event_type, payload, actor_id)
        values (v_client, 'commission', new.id::text, 'commission_recorded',
                jsonb_build_object('gross', new.gross_amount, 'vat', new.vat_amount), auth.uid());
    elsif new.status is distinct from old.status or new.collected_amount is distinct from old.collected_amount then
        insert into public.crm_events (client_id, entity_type, entity_id, event_type, payload, actor_id)
        values (v_client, 'commission', new.id::text, 'commission_' || new.status,
                jsonb_build_object('collected', new.collected_amount, 'gross', new.gross_amount), auth.uid());
    end if;
    return null;
end $$;
revoke execute on function public.commissions_after() from public, anon, authenticated;
drop trigger if exists commissions_after on public.commissions;
create trigger commissions_after after insert or update on public.commissions
for each row execute function public.commissions_after();

-- ---------- الصلاحيات ----------
alter table public.deal_stages        enable row level security;
alter table public.lost_reasons       enable row level security;
alter table public.deals              enable row level security;
alter table public.deal_stage_history enable row level security;
alter table public.commissions        enable row level security;

revoke all on public.deal_stages, public.lost_reasons, public.deals, public.deal_stage_history, public.commissions from anon;
grant select                         on public.deal_stages, public.lost_reasons to authenticated;
grant insert, update, delete         on public.deal_stages, public.lost_reasons to authenticated;
grant select, insert, update, delete on public.deals              to authenticated;
grant select                         on public.deal_stage_history to authenticated;
grant select, insert, update, delete on public.commissions        to authenticated;

drop policy if exists deal_stages_read on public.deal_stages;
create policy deal_stages_read on public.deal_stages for select to authenticated using (public.my_role() is not null);
drop policy if exists deal_stages_admin_write on public.deal_stages;
create policy deal_stages_admin_write on public.deal_stages for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists lost_reasons_read on public.lost_reasons;
create policy lost_reasons_read on public.lost_reasons for select to authenticated using (public.my_role() is not null);
drop policy if exists lost_reasons_admin_write on public.lost_reasons;
create policy lost_reasons_admin_write on public.lost_reasons for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- الصفقات: المدير الكل؛ الوسيط صفقاته؛ الكول سنتر لا شيء
drop policy if exists deals_select on public.deals;
create policy deals_select on public.deals for select to authenticated
using (public.is_admin() or broker_id = (select auth.uid()) or created_by = (select auth.uid()));
drop policy if exists deals_insert on public.deals;
create policy deals_insert on public.deals for insert to authenticated
with check (public.my_role() in ('admin', 'field') and public.crm_can_see_client(client_id));
drop policy if exists deals_update on public.deals;
create policy deals_update on public.deals for update to authenticated
using (public.is_admin() or broker_id = (select auth.uid()))
with check (public.is_admin() or broker_id = (select auth.uid()));
drop policy if exists deals_delete on public.deals;
create policy deals_delete on public.deals for delete to authenticated using (public.is_admin());

drop policy if exists deal_history_select on public.deal_stage_history;
create policy deal_history_select on public.deal_stage_history for select to authenticated using (public.crm_can_see_deal(deal_id));

-- العمولات: المدير يكتب، الوسيط يقرأ عمولات صفقاته فقط
drop policy if exists commissions_select on public.commissions;
create policy commissions_select on public.commissions for select to authenticated using (public.crm_can_see_deal(deal_id));
drop policy if exists commissions_insert on public.commissions;
create policy commissions_insert on public.commissions for insert to authenticated with check (public.is_admin());
drop policy if exists commissions_update on public.commissions;
create policy commissions_update on public.commissions for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists commissions_delete on public.commissions;
create policy commissions_delete on public.commissions for delete to authenticated using (public.is_admin());

-- crm_events: توسيع أنواع الكيانات لتشمل الصفقة والعمولة
alter table public.crm_events drop constraint if exists crm_events_entity_type_check;
alter table public.crm_events add constraint crm_events_entity_type_check
    check (entity_type in ('client', 'requirement', 'match', 'follow_up', 'property', 'note', 'deal', 'commission'));

-- ---------- تقارير الإدارة (تُحسب تحت صلاحيات المستخدم نفسه) ----------
create or replace view public.v_funnel_monthly with (security_invoker = true) as
with months as (
    select date_trunc('month', (now() at time zone 'Asia/Riyadh')) - (n || ' month')::interval as m from generate_series(0, 11) n
)
select to_char(m.m, 'YYYY-MM') as month,
    (select count(*) from public.clients c where date_trunc('month', c.created_at at time zone 'Asia/Riyadh') = m.m) as new_clients,
    (select count(*) from public.client_requirements r where date_trunc('month', r.created_at at time zone 'Asia/Riyadh') = m.m) as new_requirements,
    (select count(distinct pm.requirement_id) from public.property_matches pm where date_trunc('month', pm.created_at at time zone 'Asia/Riyadh') = m.m) as requirements_matched,
    (select count(*) from public.property_matches pm where pm.state = 'viewing' and date_trunc('month', pm.updated_at at time zone 'Asia/Riyadh') = m.m)
      + (select count(*) from public.deal_stage_history h where h.to_stage = 2 and date_trunc('month', h.changed_at at time zone 'Asia/Riyadh') = m.m) as viewings,
    (select count(*) from public.deal_stage_history h where h.to_stage in (3, 4, 5) and date_trunc('month', h.changed_at at time zone 'Asia/Riyadh') = m.m) as negotiations,
    (select count(*) from public.deals d where d.stage_id = 6 and date_trunc('month', d.closed_at at time zone 'Asia/Riyadh') = m.m) as won,
    (select count(*) from public.deals d where d.stage_id = 7 and date_trunc('month', d.closed_at at time zone 'Asia/Riyadh') = m.m) as lost,
    (select coalesce(sum(cm.gross_amount), 0) from public.commissions cm join public.deals d on d.id = cm.deal_id where date_trunc('month', d.closed_at at time zone 'Asia/Riyadh') = m.m) as commission_gross,
    (select coalesce(sum(cm.collected_amount), 0) from public.commissions cm where cm.collected_at is not null and date_trunc('month', cm.collected_at::timestamp) = m.m) as commission_collected
from months m order by m.m desc;
revoke all on public.v_funnel_monthly from anon;
grant select on public.v_funnel_monthly to authenticated;

create or replace view public.v_broker_performance with (security_invoker = true) as
select s.id as broker_id, s.fullname, s.role,
    (select count(*) from public.clients c where c.owner_id = s.id and c.status = 'active') as active_clients,
    (select count(*) from public.client_requirements r where r.owner_id = s.id and r.status = 'open') as open_requirements,
    (select count(*) from public.follow_ups f where f.assigned_to = s.id and f.status = 'done' and f.done_at >= now() - interval '30 days') as follow_ups_done_30d,
    (select count(*) from public.follow_ups f where f.assigned_to = s.id and f.status = 'pending' and f.due_at < date_trunc('day', now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh') as follow_ups_overdue,
    (select count(*) from public.property_matches pm join public.client_requirements r on r.id = pm.requirement_id where r.owner_id = s.id and pm.state = 'shared' and pm.created_at >= now() - interval '30 days') as shared_30d,
    (select count(*) from public.deals d where d.broker_id = s.id and d.stage_id between 1 and 5) as deals_open,
    (select count(*) from public.deals d where d.broker_id = s.id and d.stage_id = 6 and d.closed_at >= now() - interval '90 days') as won_90d,
    (select count(*) from public.deals d where d.broker_id = s.id and d.stage_id = 7 and d.closed_at >= now() - interval '90 days') as lost_90d,
    (select coalesce(sum(cm.gross_amount), 0) from public.commissions cm join public.deals d on d.id = cm.deal_id where d.broker_id = s.id and d.closed_at >= now() - interval '90 days') as commission_gross_90d,
    (select coalesce(sum(cm.broker_share), 0) from public.commissions cm join public.deals d on d.id = cm.deal_id where d.broker_id = s.id and d.closed_at >= now() - interval '90 days') as broker_share_90d
from public.crm_staff() s
where s.role in ('field', 'admin');
revoke all on public.v_broker_performance from anon;
grant select on public.v_broker_performance to authenticated;

-- أسباب الخسارة (لماذا تخسر ملائم الصفقات)
create or replace view public.v_lost_reasons_90d with (security_invoker = true) as
select lr.name_ar as reason, count(d.id) as deals
from public.lost_reasons lr
left join public.deals d on d.lost_reason_id = lr.id and d.stage_id = 7 and d.closed_at >= now() - interval '90 days'
group by lr.id, lr.name_ar, lr.is_active
having lr.is_active
order by count(d.id) desc, lr.name_ar;
revoke all on public.v_lost_reasons_90d from anon;
grant select on public.v_lost_reasons_90d to authenticated;
