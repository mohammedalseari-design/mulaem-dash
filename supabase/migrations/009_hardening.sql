-- 009_hardening — المرحلة 1 من خارطة التطوير: إصلاح الأساس (ملف المهمة docs/TASK_HARDENING.md)
-- طُبّقت على المشروع الحي بتاريخ 2026-09-18 باسم hardening
--
-- ثلاث مجموعات في ملف واحد لأنها تُطبَّق معاً:
--   (2) سلامة سجل الأحداث: الإضافة المباشرة محصورة في الملاحظة، ومبالغ العمولات لا تُقرأ من السجل إلا للمدير.
--   (3) دورة حياة العمولة: تُنشأ من الصف الحالي لا من تغيّر المرحلة وحده، وتعديل الأساس بعد التحصيل يُعلَّم للمراجعة.
--   (4) سجل الدفعات: المحصَّل وتاريخه صارا مشتقّين من commission_payments، فالتقرير الشهري ينسب كل دفعة لشهرها.

-- ============================================================
-- (2) سلامة سجل الأحداث
-- ============================================================
-- الإدراج المباشر الوحيد في الواجهة هو الملاحظة اليدوية (crm/js/timeline.js)، وكل ما عداه
-- تكتبه مشغّلات security definer يملكها postgres والجدول ليس force row level security،
-- فحصر السياسة على الملاحظة لا يمنع المشغّلات من الكتابة.
drop policy if exists crm_events_insert on public.crm_events;
create policy crm_events_insert on public.crm_events for insert to authenticated
with check (
    public.my_role() is not null
    and entity_type = 'note' and event_type = 'note'
    and client_id is not null and public.crm_can_see_client(client_id)
);

-- القراءة: مبالغ العمولات لا تظهر في سجل العميل إلا للمدير، والموقوف (my_role() = null)
-- لا يقرأ حتى الأحداث التي أنشأها هو.
drop policy if exists crm_events_select on public.crm_events;
create policy crm_events_select on public.crm_events for select to authenticated
using (
    public.is_admin()
    or (
        public.my_role() is not null
        and (actor_id = (select auth.uid()) or (client_id is not null and public.crm_can_see_client(client_id)))
        and event_type not like 'commission%'
    )
);

-- ============================================================
-- (3) دورة حياة العمولة
-- ============================================================
-- علم المراجعة: تعديل قيمة صفقة لها عمولة عليها مال محصَّل لا يغيّر السجل المالي بصمت
alter table public.commissions add column if not exists needs_review boolean not null default false;

-- كان إنشاء العمولة معلّقاً على *تغيّر* المرحلة إلى "تمت" مع قيمة معلومة، فثلاثة مسارات
-- تُنتج صفقة مكتملة بلا عمولة أو عمولة على أساس قديم:
--   1) صفقة تُنشأ مباشرة في المرحلة 6،
--   2) صفقة وصلت المرحلة 6 بقيمة null ثم أُدخلت قيمتها،
--   3) صفقة مكتملة عُدِّلت قيمتها بعد إنشاء العمولة.
-- المنطق أدناه يقرأ الصف الحالي في الإدراج والتعديل معاً، فيغطي الثلاثة.
create or replace function public.deals_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare
    v_stage_name  text;
    v_won         boolean;
    v_commission  uuid;
    v_created     boolean := false;
    v_old_base    numeric;
    v_collected   numeric;
    v_status      text;
begin
    select name_ar, is_won into v_stage_name, v_won from public.deal_stages where id = new.stage_id;

    -- سجل المراحل وأحداثها: كما كانت حرفاً بحرف
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
    end if;

    -- إنشاء العمولة: الحالة الراهنة للصف هي المعيار، لا الانتقال
    if v_won and new.amount is not null then
        insert into public.commissions (deal_id, base_amount, created_by)
        values (new.id, new.amount, auth.uid())
        on conflict (deal_id) do nothing
        returning id into v_commission;
        v_created := v_commission is not null;

        -- تنبيه للمدير مرة واحدة فقط: عند إنشاء صف العمولة فعلاً، لا مع كل تعديل
        if v_created and new.project_id is not null then
            insert into public.crm_events (client_id, entity_type, entity_id, event_type, payload, actor_id)
            values (new.client_id, 'property', new.project_id::text, 'property_sold_flag',
                    jsonb_build_object('deal_id', new.id, 'unit_key', new.unit_key), auth.uid());
        end if;
    end if;

    -- تعديل قيمة صفقة لها عمولة قائمة
    if tg_op = 'UPDATE' and not v_created and new.amount is distinct from old.amount then
        select c.id, c.base_amount, c.collected_amount, c.status
          into v_commission, v_old_base, v_collected, v_status
          from public.commissions c where c.deal_id = new.id;

        if v_commission is not null then
            if new.amount is not null and v_collected = 0 and v_status in ('due', 'invoiced') then
                -- لا مال عليها بعد: الأساس يتبع القيمة الجديدة
                update public.commissions set base_amount = new.amount where id = v_commission;
                insert into public.crm_events (client_id, entity_type, entity_id, event_type, payload, actor_id)
                values (new.client_id, 'commission', v_commission::text, 'commission_base_updated',
                        jsonb_build_object('old', v_old_base, 'new', new.amount), auth.uid());
            else
                -- محصَّلة أو جزئية أو معفاة (أو أُفرغت القيمة): السجل المالي لا يُمسّ، ويُعلَّم للمراجعة
                update public.commissions set needs_review = true where id = v_commission;
                insert into public.crm_events (client_id, entity_type, entity_id, event_type, payload, actor_id)
                values (new.client_id, 'commission', v_commission::text, 'commission_base_mismatch',
                        jsonb_build_object('old', v_old_base, 'new', new.amount, 'deal_id', new.id), auth.uid());
            end if;
        end if;
    end if;

    return null;
end $$;
revoke execute on function public.deals_after() from public, anon, authenticated;
drop trigger if exists deals_after on public.deals;
create trigger deals_after after insert or update on public.deals
for each row execute function public.deals_after();

-- ============================================================
-- (4) سجل دفعات العمولة
-- ============================================================
-- كان collected_amount رقماً واحداً بتاريخ واحد، فدفعتان في شهرين تُنسبان معاً لشهر
-- اكتمال التحصيل، و v_funnel_monthly.commission_collected تخرج خاطئة.
create table if not exists public.commission_payments (
    id            uuid primary key default gen_random_uuid(),
    commission_id uuid not null references public.commissions(id) on delete cascade,
    amount        numeric(14,2) not null check (amount > 0),
    paid_on       date not null default current_date,
    method        text check (method is null or method in ('bank','cash','cheque','other')),
    note          text,
    created_by    uuid references public.profiles(id),
    created_at    timestamptz not null default now()
);
create index if not exists commission_payments_idx on public.commission_payments (commission_id, paid_on);

-- ترحيل الأرصدة القائمة *قبل* أن يصير الاشتقاق سارياً، وإلا صُفّرت المبالغ المسجّلة
insert into public.commission_payments (commission_id, amount, paid_on, note, created_by)
select c.id, c.collected_amount, coalesce(c.collected_at, current_date), 'ترحيل رصيد سابق', c.created_by
from public.commissions c
where c.collected_amount > 0
  and not exists (select 1 from public.commission_payments p where p.commission_id = c.id);

create or replace function public.commission_payments_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if tg_op = 'UPDATE' then
        new.created_by    := old.created_by;
        new.created_at    := old.created_at;
        new.commission_id := old.commission_id;
    elsif auth.uid() is not null then
        new.created_by := auth.uid();
    end if;
    return new;
end $$;
revoke execute on function public.commission_payments_guard() from public, anon, authenticated;
drop trigger if exists commission_payments_guard on public.commission_payments;
create trigger commission_payments_guard before insert or update on public.commission_payments
for each row execute function public.commission_payments_guard();

-- لمس العمولة الأم بعد كل حركة على السجل حتى يعيد commissions_guard الاشتقاق،
-- وتسجيل الدفعة في سجل الأحداث (النوع يبدأ بـ commission فلا يراه إلا المدير).
create or replace function public.commission_payments_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_commission uuid; v_client uuid;
begin
    v_commission := case when tg_op = 'DELETE' then old.commission_id else new.commission_id end;
    update public.commissions set updated_at = now() where id = v_commission;

    if tg_op = 'INSERT' then
        select d.client_id into v_client
        from public.commissions c join public.deals d on d.id = c.deal_id
        where c.id = v_commission;
        insert into public.crm_events (client_id, entity_type, entity_id, event_type, payload, actor_id)
        values (v_client, 'commission', v_commission::text, 'commission_payment_added',
                jsonb_build_object('amount', new.amount, 'paid_on', new.paid_on), auth.uid());
    end if;
    return null;
end $$;
revoke execute on function public.commission_payments_after() from public, anon, authenticated;
drop trigger if exists commission_payments_after on public.commission_payments;
create trigger commission_payments_after after insert or update or delete on public.commission_payments
for each row execute function public.commission_payments_after();

-- المحصَّل وتاريخه صارا مشتقّين: ما يرسله العميل في العمودين يُهمل، فالكتابة المباشرة
-- لا تستطيع تزوير تحصيل. اشتقاق الحالة يبقى كما كان.
create or replace function public.commissions_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_gross numeric; v_paid numeric; v_last date;
begin
    v_gross := round(new.base_amount * new.rate_percent / 100, 2);
    if tg_op = 'UPDATE' then
        new.updated_at := now();
        new.created_by := old.created_by; new.created_at := old.created_at; new.deal_id := old.deal_id;
    elsif auth.uid() is not null then
        new.created_by := auth.uid();
    end if;

    select coalesce(sum(p.amount), 0), max(p.paid_on) into v_paid, v_last
    from public.commission_payments p where p.commission_id = new.id;
    new.collected_amount := v_paid;
    new.collected_at     := v_last;

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

-- الصلاحيات: المدير يكتب، والوسيط يقرأ دفعات عمولة يراها أصلاً
alter table public.commission_payments enable row level security;
revoke all on public.commission_payments from anon;
grant select, insert, update, delete on public.commission_payments to authenticated;

drop policy if exists commission_payments_select on public.commission_payments;
create policy commission_payments_select on public.commission_payments for select to authenticated
using (exists (
    select 1 from public.commissions c
    where c.id = commission_id and public.crm_can_see_deal(c.deal_id)
));
drop policy if exists commission_payments_admin_write on public.commission_payments;
create policy commission_payments_admin_write on public.commission_payments for all to authenticated
using (public.is_admin()) with check (public.is_admin());

-- التقرير الشهري: كل دفعة تُنسب لشهرها هي، لا لشهر اكتمال التحصيل
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
    (select coalesce(sum(cp.amount), 0) from public.commission_payments cp where date_trunc('month', cp.paid_on::timestamp) = m.m) as commission_collected
from months m order by m.m desc;
revoke all on public.v_funnel_monthly from anon;
grant select on public.v_funnel_monthly to authenticated;
