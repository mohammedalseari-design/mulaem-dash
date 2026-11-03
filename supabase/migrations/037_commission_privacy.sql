-- 037: العمولة للمدير وحده، ونسبة عامة ونسبة لكل مشروع.
--
-- طلب المالك (2026-11-03): «ابغا العمولة تصير ظاهرة عند المدير فقط والوسيط اخفيها بزر من عندي، واذا اضيفها بالنسبة
-- اللي اقدر اغيرها ابغا تسهل الطريقة». اختار: إخفاء حقيقي للعمولتين (الوحدة والصفقة)، وزر واحد للمدير، ونسبة عامة
-- ونسبة خاصة لكل مشروع.
--
-- قبل هذا التحديث كانت عمولة الوحدة مبلغاً داخل projects.details.models[i].commission، وكل موظف يقرأ تفاصيل المشروع
-- فيقرؤها ولو أخفتها الشاشة. بعده:
--   commission_policy          صف واحد: النسبة العامة، وهل تظهر العمولة لغير المدير (show_to_staff، مطفأ أولاً).
--   project_commission         نسبة خاصة لمشروع (بلا صف = النسبة العامة).
--   unit_commission_override   «مبلغ محدد» لنموذج بعينه: المبالغ المكتوبة قبل اليوم تنتقل إليه كما هي.
-- الثلاثة لا يقرؤها إلا من commission_visible() عنده صحيحة (المدير دائماً، وغيره حين يشغّل المدير الزر)، ولا يكتبها
-- أحد من المتصفح مباشرة: الكتابة عبر دوال تتحقق أن الكاتب مدير.
--
-- v_units.unit_commission صار محسوباً: المبلغ المحدد إن وُجد، وإلا السعر × (نسبة المشروع أو العامة). العرض
-- security_invoker، فمن لا يرى الجداول الثلاثة يخرج له null. وعمولة الصفقة (commissions) ودفعاتها لا يقرؤها غير
-- المدير إلا والزر مشغّل، وتُنشأ عند «تمت» بنسبة مشروعها بدل 2.5 الثابتة.
--
-- مشغّل projects_commission_strip ينزع مفتاح commission من النماذج في كل كتابة على projects، فلا يعود المبلغ إلى
-- التفاصيل المقروءة من أي طريق (النموذج القديم، المساعد، الاستيراد). ما يكتبه المدير أو المساعد أو عرض جديد يُحفظ
-- «مبلغاً محدداً»؛ وما يرسله غير المدير في تعديل مشروع قائم يُهمَل (التعديل يرجع «بانتظار الاعتماد» أصلاً).
--
-- تطبيقه مرة ثانية لا يغيّر شيئاً.

/* ===================== 1) السياسة ===================== */

create table if not exists public.commission_policy (
    id            boolean primary key default true check (id),
    default_rate  numeric(5,2) not null default 2.5 check (default_rate >= 0 and default_rate <= 100),
    show_to_staff boolean not null default false,
    updated_at    timestamptz not null default now(),
    updated_by    uuid
);
insert into public.commission_policy (id) values (true) on conflict (id) do nothing;

-- المدير دائماً، وغيره حين يشغّل المدير «إظهار العمولة للوسطاء». تستدعيها الواجهة لتعرف هل تعرض العمولة.
create or replace function public.commission_visible() returns boolean
language sql stable security definer set search_path = public as $$
    select public.is_admin() or coalesce((select p.show_to_staff from public.commission_policy p where p.id), false)
$$;
revoke execute on function public.commission_visible() from public, anon;
grant  execute on function public.commission_visible() to authenticated;

/* ===================== 2) نسبة المشروع والمبلغ المحدد ===================== */

create table if not exists public.project_commission (
    project_id integer primary key references public.projects(id) on delete cascade,
    rate       numeric(5,2) not null check (rate >= 0 and rate <= 100),
    updated_at timestamptz not null default now(),
    updated_by uuid
);

-- unit_ord رقم النموذج في details.models (يبدأ من 1)، و unit_name اسمه وقت الحفظ: إن أُعيد ترتيب النماذج أو
-- تغيّر الاسم لا يُنسب المبلغ لنموذج آخر (v_units تطابق الاسم)، بل يرجع النموذج للنسبة.
-- المفتاح الخارجي مؤجَّل لأن المشغّل يكتب هنا قبل أن يُدرج المشروع الجديد نفسه.
create table if not exists public.unit_commission_override (
    project_id integer not null references public.projects(id) on delete cascade deferrable initially deferred,
    unit_ord   integer not null check (unit_ord >= 1),
    unit_name  text,
    amount     numeric(14,2) not null check (amount >= 0 and amount <= 100000000),
    updated_at timestamptz not null default now(),
    updated_by uuid,
    primary key (project_id, unit_ord)
);

alter table public.commission_policy enable row level security;
alter table public.project_commission enable row level security;
alter table public.unit_commission_override enable row level security;
revoke all on public.commission_policy, public.project_commission, public.unit_commission_override from public, anon, authenticated;
grant select on public.commission_policy, public.project_commission, public.unit_commission_override to authenticated;

drop policy if exists commission_policy_read on public.commission_policy;
create policy commission_policy_read on public.commission_policy for select to authenticated using ((select public.commission_visible()));
drop policy if exists project_commission_read on public.project_commission;
create policy project_commission_read on public.project_commission for select to authenticated using ((select public.commission_visible()));
drop policy if exists unit_commission_override_read on public.unit_commission_override;
create policy unit_commission_override_read on public.unit_commission_override for select to authenticated using ((select public.commission_visible()));

/* ===================== 3) نقل المبالغ الحالية ثم نزعها من التفاصيل ===================== */

-- مبلغ مكتوب كما يكتبه الناس: «12000» أو «12,000» أو «١٢٠٠٠ ريال». ما فيه علامة نسبة أو لا يُقرأ رقماً يرجع null
-- (فلا يُحفظ مبلغاً محدداً؛ أصله باقٍ في النسخة الاحتياطية أدناه)
create or replace function public.parse_commission_amount(p_raw text) returns numeric
language plpgsql immutable set search_path = public as $$
declare v text;
begin
    if p_raw is null or p_raw ~ '[%٪]' then return null; end if;
    v := translate(p_raw, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹٫', '01234567890123456789.');
    v := regexp_replace(v, '[^0-9.]', '', 'g');
    v := regexp_replace(v, '^[.]+|[.]+$', '', 'g');
    if v !~ '^[0-9]+([.][0-9]+)?$' then return null; end if;
    if v::numeric <= 0 or v::numeric > 100000000 then return null; end if;
    return round(v::numeric, 2);
end $$;
revoke execute on function public.parse_commission_amount(text) from public, anon;

-- نسخة احتياطية لكل مبلغ كان في التفاصيل قبل نزعه، كما هو حرفاً بحرف. لا يقرؤها أحد من الواجهة (RLS بلا سياسات)
create table if not exists public.commission_backup_037 (
    project_id integer not null,
    unit_ord   integer not null,
    unit_name  text,
    raw        jsonb,
    saved_at   timestamptz not null default now(),
    primary key (project_id, unit_ord)
);
alter table public.commission_backup_037 enable row level security;
revoke all on public.commission_backup_037 from public, anon, authenticated;

insert into public.commission_backup_037 (project_id, unit_ord, unit_name, raw)
select p.id, m.ord::int, nullif(btrim(m.model->>'name'), ''), m.model->'commission'
from public.projects p
cross join lateral jsonb_array_elements(
    case when jsonb_typeof(p.details->'models') = 'array' then p.details->'models' else '[]'::jsonb end
) with ordinality as m(model, ord)
where jsonb_typeof(m.model) = 'object' and m.model ? 'commission'
on conflict (project_id, unit_ord) do nothing;

insert into public.unit_commission_override (project_id, unit_ord, unit_name, amount)
select b.project_id, b.unit_ord, b.unit_name, public.parse_commission_amount(b.raw #>> '{}')
from public.commission_backup_037 b
where public.parse_commission_amount(b.raw #>> '{}') is not null
on conflict (project_id, unit_ord) do nothing;

-- النزع لا يحرّك «آخر تحديث» للمشروع: projects_reporting_guard يكتب updated_at مع كل تعديل، فيُوقف لهذه الخطوة
-- وحدها (وإلا صار كل مشروع فيه عمولة «محدَّثاً اليوم» في جودة المخزون)
alter table public.projects disable trigger projects_reporting_guard;
update public.projects p
   set details = jsonb_set(p.details, '{models}', (
        select coalesce(jsonb_agg(case when jsonb_typeof(x.m) = 'object' then x.m - 'commission' else x.m end order by x.ord), '[]'::jsonb)
        from jsonb_array_elements(p.details->'models') with ordinality as x(m, ord)
   ))
 where jsonb_typeof(p.details->'models') = 'array'
   and exists (select 1 from jsonb_array_elements(p.details->'models') e(m)
               where jsonb_typeof(e.m) = 'object' and e.m ? 'commission');
alter table public.projects enable trigger projects_reporting_guard;

/* ===================== 4) لا يعود المبلغ إلى التفاصيل ===================== */

create or replace function public.projects_commission_strip() returns trigger
language plpgsql security definer set search_path = public as $$
declare
    v_keep  boolean;
    v_out   jsonb := '[]'::jsonb;
    v_found boolean := false;
    v_m     jsonb;
    v_ord   bigint;
    v_amt   numeric;
begin
    if new.details is null or jsonb_typeof(new.details->'models') is distinct from 'array' then
        return new;
    end if;
    -- المدير، أو المساعد والاستيراد (بلا هوية مستخدم)، أو عرض جديد: يُحفظ المبلغ. تعديل غير المدير لمشروع قائم: يُهمَل
    v_keep := auth.uid() is null or public.is_admin() or tg_op = 'INSERT';
    for v_m, v_ord in select e.m, e.ord from jsonb_array_elements(new.details->'models') with ordinality as e(m, ord) loop
        if jsonb_typeof(v_m) = 'object' and v_m ? 'commission' then
            v_found := true;
            v_amt := public.parse_commission_amount(v_m->>'commission');
            if v_keep and v_amt is not null then
                insert into public.unit_commission_override (project_id, unit_ord, unit_name, amount, updated_by)
                values (new.id, v_ord::int, nullif(btrim(v_m->>'name'), ''), v_amt, auth.uid())
                on conflict (project_id, unit_ord) do update
                    set amount = excluded.amount, unit_name = excluded.unit_name, updated_at = now(), updated_by = excluded.updated_by;
            end if;
            v_m := v_m - 'commission';
        end if;
        v_out := v_out || jsonb_build_array(v_m);
    end loop;
    if v_found then
        new.details := jsonb_set(new.details, '{models}', v_out);
    end if;
    return new;
end $$;
revoke execute on function public.projects_commission_strip() from public, anon, authenticated;
drop trigger if exists projects_commission_strip on public.projects;
create trigger projects_commission_strip before insert or update of details on public.projects
for each row execute function public.projects_commission_strip();

/* ===================== 5) كتابة المدير ===================== */

-- «مبلغ محدد» لنموذج: نفس توقيع 021 (صفحة العقارات تستدعيها)، و null يمسحه فيرجع النموذج للنسبة
create or replace function public.set_unit_commission(p_project int, p_unit_ord int, p_commission numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_models jsonb; v_name text;
begin
    if not public.is_admin() then
        return jsonb_build_object('ok', false, 'code', 'forbidden');
    end if;
    if p_commission is not null and (p_commission < 0 or p_commission > 100000000) then
        return jsonb_build_object('ok', false, 'code', 'bad_value');
    end if;
    select details->'models' into v_models from public.projects where id = p_project;
    if v_models is null or jsonb_typeof(v_models) <> 'array'
       or p_unit_ord is null or p_unit_ord < 1 or p_unit_ord > jsonb_array_length(v_models) then
        return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    if p_commission is null then
        delete from public.unit_commission_override where project_id = p_project and unit_ord = p_unit_ord;
    else
        v_name := nullif(btrim(v_models->(p_unit_ord - 1)->>'name'), '');
        insert into public.unit_commission_override (project_id, unit_ord, unit_name, amount, updated_by)
        values (p_project, p_unit_ord, v_name, round(p_commission, 2), auth.uid())
        on conflict (project_id, unit_ord) do update
            set amount = excluded.amount, unit_name = excluded.unit_name, updated_at = now(), updated_by = excluded.updated_by;
    end if;
    return jsonb_build_object('ok', true, 'commission', p_commission);
end $$;
revoke execute on function public.set_unit_commission(int, int, numeric) from public, anon;
grant  execute on function public.set_unit_commission(int, int, numeric) to authenticated;

-- نسبة خاصة لمشروع، و null يرجعه للنسبة العامة
create or replace function public.set_project_commission(p_project int, p_rate numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
    if not public.is_admin() then
        return jsonb_build_object('ok', false, 'code', 'forbidden');
    end if;
    if p_rate is not null and (p_rate < 0 or p_rate > 100) then
        return jsonb_build_object('ok', false, 'code', 'bad_value');
    end if;
    if not exists (select 1 from public.projects where id = p_project) then
        return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    if p_rate is null then
        delete from public.project_commission where project_id = p_project;
    else
        insert into public.project_commission (project_id, rate, updated_by)
        values (p_project, round(p_rate, 2), auth.uid())
        on conflict (project_id) do update set rate = excluded.rate, updated_at = now(), updated_by = excluded.updated_by;
    end if;
    return jsonb_build_object('ok', true, 'rate', p_rate);
end $$;
revoke execute on function public.set_project_commission(int, numeric) from public, anon;
grant  execute on function public.set_project_commission(int, numeric) to authenticated;

-- النسبة العامة والزر؛ null يُبقي القيمة كما هي
create or replace function public.set_commission_policy(p_default_rate numeric, p_show_to_staff boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
    if not public.is_admin() then
        return jsonb_build_object('ok', false, 'code', 'forbidden');
    end if;
    if p_default_rate is not null and (p_default_rate < 0 or p_default_rate > 100) then
        return jsonb_build_object('ok', false, 'code', 'bad_value');
    end if;
    update public.commission_policy
       set default_rate  = coalesce(round(p_default_rate, 2), default_rate),
           show_to_staff = coalesce(p_show_to_staff, show_to_staff),
           updated_at    = now(),
           updated_by    = auth.uid()
     where id;
    return (select jsonb_build_object('ok', true, 'default_rate', default_rate, 'show_to_staff', show_to_staff)
            from public.commission_policy where id);
end $$;
revoke execute on function public.set_commission_policy(numeric, boolean) from public, anon;
grant  execute on function public.set_commission_policy(numeric, boolean) to authenticated;

/* ===================== 6) v_units: العمولة محسوبة ===================== */

-- 030 كما هي، عدا أن unit_commission صار من الجداول أعلاه، وعمودان جديدان في آخرها: النسبة المستعملة ومصدرها
-- (override = مبلغ محدد، project = نسبة المشروع، default = العامة). create or replace لا drop: v_inventory_attention تعتمد عليها.
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
           0, 'كامل العقار', p.type, p.rooms, null::int, p.area, p.price, 1, p.availability
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
       b.unit_ord, b.unit_key, b.unit_type, b.rooms, b.bathrooms, b.area, b.price,
       (case
           when cp.id is null then null
           when o.amount is not null then o.amount
           when b.price > 0 then round(b.price * coalesce(pc.rate, cp.default_rate) / 100, 2)
       end)::numeric as unit_commission,
       b.unit_count,
       case
           when b.unit_status <> 'available' or h.n_held is null or h.n_held < b.unit_count then b.unit_status
           when h.n_sold >= b.unit_count then 'sold'
           else 'reserved'
       end as unit_status,
       greatest(b.unit_count - coalesce(h.n_held, 0), 0)::int as units_left,
       (case when cp.id is null or o.amount is not null then null else coalesce(pc.rate, cp.default_rate) end)::numeric as unit_commission_rate,
       case
           when cp.id is null then null
           when o.amount is not null then 'override'
           when pc.rate is not null then 'project'
           else 'default'
       end as unit_commission_source
from base b
left join held h on h.project_id = b.project_id
               and h.unit_key is not distinct from (case when b.unit_ord = 0 then null else b.unit_key end)
left join public.commission_policy cp on cp.id
left join public.project_commission pc on pc.project_id = b.project_id
left join public.unit_commission_override o on o.project_id = b.project_id and b.unit_ord > 0 and o.unit_ord = b.unit_ord
                                           and (o.unit_name is null or o.unit_name = b.unit_key);
revoke all on public.v_units from anon;
grant select on public.v_units to authenticated;

/* ===================== 7) عمولة الصفقة ===================== */

-- لا يقرأ العمولات ودفعاتها غير المدير، إلا والزر مشغّل (ثم كلٌّ عمولات صفقاته كما كان)
drop policy if exists commissions_select on public.commissions;
create policy commissions_select on public.commissions for select to authenticated
using ((select public.commission_visible()) and public.crm_can_see_deal(deal_id));

drop policy if exists commission_payments_select on public.commission_payments;
create policy commission_payments_select on public.commission_payments for select to authenticated
using ((select public.commission_visible()) and exists (
    select 1 from public.commissions c
    where c.id = commission_id and public.crm_can_see_deal(c.deal_id)
));

-- عند «تمت» تُنشأ العمولة بنسبة مشروع الصفقة (أو العامة) بدل 2.5 الثابتة. يعمل قبل commissions_guard (الترتيب
-- أبجدي)، وعلى الإدراج وحده: تعديل المدير للنسبة بعد ذلك من صفحة الصفقة يبقى كما هو.
create or replace function public.commissions_apply_rate() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_rate numeric;
begin
    select coalesce(pc.rate, cp.default_rate) into v_rate
    from public.commission_policy cp
    left join public.deals d on d.id = new.deal_id
    left join public.project_commission pc on pc.project_id = d.project_id
    where cp.id;
    if v_rate is not null then
        new.rate_percent := v_rate;
    end if;
    return new;
end $$;
revoke execute on function public.commissions_apply_rate() from public, anon, authenticated;
drop trigger if exists commissions_apply_rate on public.commissions;
create trigger commissions_apply_rate before insert on public.commissions
for each row execute function public.commissions_apply_rate();

/* ===================== 8) تحقق قبل الإنهاء ===================== */

-- يظهر في سجل التطبيق: كم مبلغاً حُفظ احتياطياً وكم صار «مبلغاً محدداً». وإن بقي مبلغ في تفاصيل أي مشروع يُلغى التحديث
-- كله (المعاملة واحدة)، فلا تُنشر الواجهة الجديدة على قاعدة نصف منقولة.
do $$
declare v_backup int; v_moved int; v_left int;
begin
    select count(*) into v_backup from public.commission_backup_037;
    select count(*) into v_moved from public.unit_commission_override;
    select count(*) into v_left
    from public.projects p
    cross join lateral jsonb_array_elements(
        case when jsonb_typeof(p.details->'models') = 'array' then p.details->'models' else '[]'::jsonb end
    ) as e(m)
    where jsonb_typeof(e.m) = 'object' and e.m ? 'commission';
    raise notice '037: حُفظ احتياطياً % مبلغاً، وصار % «مبلغاً محدداً»، وبقي في التفاصيل % (المطلوب 0)', v_backup, v_moved, v_left;
    if v_left > 0 then
        raise exception '037: بقي مبلغ عمولة في تفاصيل % نموذجاً، أُلغي التحديث', v_left;
    end if;
end $$;
