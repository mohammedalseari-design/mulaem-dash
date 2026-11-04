-- 040: تصحيح مشاركة المشروع بعد تطبيق 038. لا جدول جديد: دوال 038 نفسها بأجسامها الصحيحة.
--
-- قرارات المالك (2026-11-04) والمراجعة المستقلة:
--   * اسم المطور لا يصل العميل أصلاً.
--   * النص الحر الذي يصل العميل (الوصف والمميزات) قد يكون منسوخاً من إعلان واتساب: ما يذكر العمولة أو فيه رقم يشبه الجوال لا
--     يمر (project_share_public_text)، فالرقم الوحيد للتواصل رقم ملائم.
--   * رخصة إعلان منتهية (listing_expires_at قبل اليوم بتوقيت الرياض، القاعدة نفسها في المطابقة 005 وفي v_inventory_attention):
--     لا يُشارك المشروع، ورابطه السابق لا يفتح حتى تُجدَّد.
--   * النماذج كلها تصل (حد 500 بدل 60)، فلا تُحسب الأرقام و«يبدأ من» من قائمة مقطوعة، و«مشاركاتي» حدها 2000.
--   * حد 500 زائر في اليوم للزائر الجديد وحده، فمن حُسب اليوم يتحدّث وقت فتحه.
--   * الصور والمميزات والرخصة بالصيغ نفسها التي تقرؤها صفحة المشروع للموظف.
--
-- وقت كتابته لا رابط مشاركة عند أحد: الموقع لم يبدأ يستدعي هذه الدوال بعد. تطبيقه مرة ثانية لا يغيّر شيئاً.

/* ===================== المشاركة ===================== */

-- يجلب رابط المتصل لهذا المشروع أو ينشئه. p_format (link | card | pdf) يسجّل الإرسال: آخر صيغة ووقته؛ وبلا صيغة يعيد
-- الرمز وحده (نافذة المشاركة تحتاجه قبل الإرسال لترسم الرمز في البطاقة) ولا يُحسب إرسالاً: «مشاركاتي» لا تعرض ما لم يُرسل.
-- المشروع معتمد وغير محذوف. رابط أُبطل (revoked_at) يأخذ رمزاً جديداً.
create or replace function public.share_project(p_project integer, p_format text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    v_uid  uuid := auth.uid();
    v_code text;
    v_try  integer := 0;
begin
    if v_uid is null or public.my_role() is null then
        return jsonb_build_object('ok', false, 'code', 'forbidden');
    end if;
    if p_format is not null and p_format not in ('link', 'card', 'pdf') then
        return jsonb_build_object('ok', false, 'code', 'bad_format');
    end if;
    if not exists (select 1 from public.projects p
                    where p.id = p_project and p.status = 'approved' and p.deleted_at is null) then
        return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    if exists (select 1 from public.projects p
                where p.id = p_project and p.listing_expires_at < (now() at time zone 'Asia/Riyadh')::date) then
        return jsonb_build_object('ok', false, 'code', 'expired');
    end if;
    loop
        begin
            insert into public.project_shares as s (project_id, broker_id, last_format, last_shared_at)
            values (p_project, v_uid, p_format, case when p_format is null then null else now() end)
            on conflict (project_id, broker_id) do update
               set code           = case when s.revoked_at is null then s.code else public.project_share_code() end,
                   revoked_at     = null,
                   last_format    = coalesce(excluded.last_format, s.last_format),
                   last_shared_at = case when excluded.last_format is null then s.last_shared_at else now() end
            returning s.code into v_code;
            exit;
        exception when unique_violation then
            -- تصادم رمزين عشوائيين (احتماله لا يكاد يُذكر): رمز آخر
            v_try := v_try + 1;
            if v_try >= 3 then
                raise;
            end if;
        end;
    end loop;
    return jsonb_build_object('ok', true, 'code', v_code);
end $$;
revoke execute on function public.share_project(integer, text) from public, anon;
grant  execute on function public.share_project(integer, text) to authenticated;

/* ===================== صفحة العميل ===================== */

-- نص من قيمة حرة في التفاصيل: نص أو رقم، مقصوص، والفراغ لا شيء
create or replace function public.project_share_text(p_value jsonb, p_max integer) returns text
language sql immutable set search_path = public as $$
    select case when jsonb_typeof(p_value) in ('string', 'number')
                then nullif(left(btrim(p_value #>> '{}'), p_max), '') end
$$;
revoke execute on function public.project_share_text(jsonb, integer) from public, anon, authenticated;

-- نص حر يصل العميل: ما يذكر العمولة أو السعي، أو فيه 9 أرقام متتالية فأكثر (جوال، ولو بمسافات أو شرطات)، لا يمر. احتياط لا
-- يحسم كل صيغة، والسعر والمساحة والسنة تمر
create or replace function public.project_share_public_text(p_text text) returns text
language sql immutable set search_path = public as $$
    select case when p_text ~ '(عمول|السعي|سعي الوسيط|سعي [0-9٠-٩۰-۹]|[0-9٠-٩۰-۹]([ -]?[0-9٠-٩۰-۹]){8,})' then null else p_text end
$$;
revoke execute on function public.project_share_public_text(text) from public, anon, authenticated;

-- ما يراه العميل بالرمز، أو null (رمز مجهول أو مُبطل، أو مشروع لم يعد معتمداً أو حُذف أو انتهت رخصة إعلانه). p_visitor معرّف الزائر من
-- متصفحه: يُسجَّل الفتح للزائر غير المسجّل دخوله فقط
create or replace function public.get_project_share(p_code text, p_visitor text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    v_share    public.project_shares%rowtype;
    v_project  public.projects%rowtype;
    v_name     text;
    v_office   text;
    v_details  jsonb;
    v_images   jsonb;
    v_features jsonb;
    v_raw      jsonb;
    v_units    jsonb;
    v_day      date;
begin
    if p_code is null or p_code !~ '^[A-Za-z0-9_-]{16,64}$' then
        return null;
    end if;
    select * into v_share from public.project_shares s where s.code = p_code and s.revoked_at is null;
    if not found then
        return null;
    end if;
    select * into v_project from public.projects p
     where p.id = v_share.project_id and p.status = 'approved' and p.deleted_at is null
       and (p.listing_expires_at is null or p.listing_expires_at >= (now() at time zone 'Asia/Riyadh')::date);
    if not found then
        return null;
    end if;

    if auth.uid() is null and p_visitor is not null and p_visitor ~ '^[A-Za-z0-9_-]{8,64}$' then
        v_day := (now() at time zone 'Asia/Riyadh')::date;
        insert into public.project_share_views as w (share_id, visitor, view_day)
        select v_share.id, p_visitor, v_day
         where (select count(*) from public.project_share_views c
                 where c.share_id = v_share.id and c.view_day = v_day) < 500
            or exists (select 1 from public.project_share_views c
                        where c.share_id = v_share.id and c.view_day = v_day and c.visitor = p_visitor)
        on conflict (share_id, view_day, visitor) do update set viewed_at = now()
            where w.viewed_at < now() - interval '10 minutes';
    end if;

    v_details := case when jsonb_typeof(v_project.details) = 'object' then v_project.details else '{}'::jsonb end;

    -- الصور بالصيغتين اللتين تقرؤهما صفحة المشروع (project-profile.js): رابط نصي أو كائن { url, caption }
    select coalesce(jsonb_agg(to_jsonb(x.u) order by x.ord), '[]'::jsonb) into v_images
      from (select i.u, i.ord
              from (select case jsonb_typeof(e.value) when 'string' then e.value #>> '{}'
                                                      when 'object' then e.value ->> 'url' end as u, e.ord
                      from jsonb_array_elements(case when jsonb_typeof(v_project.images) = 'array' then v_project.images else '[]'::jsonb end)
                           with ordinality as e(value, ord)) i
             where left(i.u, 8) = 'https://' and length(i.u) <= 2000
             order by i.ord
             limit 24) x;

    -- المميزات كما تقرؤها صفحة المشروع: amenities ثم features، قائمة أو نص بسطر لكل ميزة
    v_raw := case when jsonb_typeof(v_details->'amenities') in ('array', 'string') then v_details->'amenities' else v_details->'features' end;
    select coalesce(jsonb_agg(to_jsonb(x.t) order by x.ord), '[]'::jsonb) into v_features
      from (select left(btrim(f.t), 120) as t, f.ord
              from (select a.value #>> '{}' as t, a.ord
                      from jsonb_array_elements(case when jsonb_typeof(v_raw) = 'array' then v_raw else '[]'::jsonb end)
                           with ordinality as a(value, ord)
                     where jsonb_typeof(a.value) = 'string'
                    union all
                    select l.t, l.ord
                      from regexp_split_to_table(case when jsonb_typeof(v_raw) = 'string' then v_raw #>> '{}' else '' end, '\r?\n')
                           with ordinality as l(t, ord)) f
             where btrim(f.t) <> '' and public.project_share_public_text(f.t) is not null
             order by f.ord
             limit 16) x;

    -- النماذج من v_units (قاعدة المتاح نفسها في «العقارات» ولوحة الوحدات، 030): المتاح ما بقي من نموذج «متاح» في مشروع
    -- «متاح»، وإلا صفر. لا يُقرأ unit_commission ولا الحالة اليدوية
    select coalesce(jsonb_agg(jsonb_build_object(
               'ord', u.unit_ord,
               'name', case when u.unit_ord = 0 then null else u.unit_key end,
               'type', u.unit_type,
               'rooms', u.rooms,
               'bathrooms', u.bathrooms,
               'area', u.area,
               'price', u.price,
               'plan', case when left(u.plan, 8) = 'https://' and length(u.plan) <= 2000 then u.plan end,
               'total', u.unit_count,
               'available', case when v_project.availability = 'available' and u.unit_status = 'available'
                                 then greatest(coalesce(u.units_left, 0), 0) else 0 end
           ) order by u.unit_ord), '[]'::jsonb)
      into v_units
      from (select vu.unit_ord, vu.unit_key, vu.unit_type, vu.rooms, vu.bathrooms, vu.area, vu.price,
                   vu.unit_count, vu.unit_status, vu.units_left,
                   case when vu.unit_ord > 0 then v_details->'models'->(vu.unit_ord - 1)::integer->>'plan' end as plan
              from public.v_units vu
             where vu.project_id = v_project.id
             order by vu.unit_ord
             limit 500) u;

    -- اسم صاحب الرابط (الموقوف لا يظهر اسمه)، ورقم التواصل واتساب المكتب دائماً
    select nullif(btrim(b.fullname), '') into v_name
      from public.profiles b
     where b.id = v_share.broker_id and not b.is_blocked;
    select nullif(btrim(st.value #>> '{}'), '') into v_office
      from public.crm_settings st
     where st.key = 'office_whatsapp' and jsonb_typeof(st.value) = 'string';

    return jsonb_build_object(
        'project', jsonb_build_object(
            'name', v_project.name,
            'type', v_project.type,
            'purpose', v_project.purpose,
            'city', v_project.city,
            'district', v_project.district,
            'construction_status', public.project_share_text(v_details->'construction_status', 60),
            'delivery_time', public.project_share_text(v_details->'delivery_time', 60),
            'delivery_date', v_project.delivery_date,
            'description', public.project_share_public_text(public.project_share_text(v_details->'description', 3000)),
            'features', v_features,
            'images', v_images,
            'latitude', case when v_project.latitude between -90 and 90 and v_project.longitude between -180 and 180
                              and not (v_project.latitude = 0 and v_project.longitude = 0) then v_project.latitude end,
            'longitude', case when v_project.latitude between -90 and 90 and v_project.longitude between -180 and 180
                               and not (v_project.latitude = 0 and v_project.longitude = 0) then v_project.longitude end,
            'ad_license', coalesce(nullif(btrim(v_project.rega_ad_license), ''),
                                   public.project_share_text(v_details->'license', 60),
                                   public.project_share_text(v_details->'rega_license', 60)),
            'sold_out', v_project.availability is distinct from 'available'
        ),
        'units', v_units,
        'consultant', jsonb_build_object('name', v_name, 'phone', v_office)
    );
end $$;
revoke execute on function public.get_project_share(text, text) from public;
grant  execute on function public.get_project_share(text, text) to anon, authenticated;

/* ===================== «مشاركاتي» ===================== */

-- مشاركات المتصل (والمدير: الكل مع p_all) بما أُرسل فعلاً، وكم شخصاً فتح كل رابط: الأشخاص زوار مختلفون، فمن فتحه مراراً
-- يُحسب مرة؛ و«هذا الأسبوع» آخر 7 أيام. project_live: المشروع ما زال معتمداً غير محذوف ورخصته غير منتهية (يُشارك مجدداً)
create or replace function public.my_project_shares(p_all boolean default false)
returns table (
    share_id       uuid,
    code           text,
    project_id     integer,
    project_name   text,
    district       text,
    city           text,
    broker_id      uuid,
    broker_name    text,
    last_format    text,
    last_shared_at timestamptz,
    opens_total    integer,
    opens_week     integer,
    last_opened_at timestamptz,
    project_live   boolean
)
language sql stable security definer set search_path = public as $$
    select s.id, s.code, s.project_id, p.name, p.district, p.city,
           s.broker_id, coalesce(nullif(btrim(b.fullname), ''), b.username),
           s.last_format, s.last_shared_at,
           coalesce(v.people, 0)::integer, coalesce(v.people_week, 0)::integer, v.last_at,
           (p.status = 'approved' and p.deleted_at is null
            and (p.listing_expires_at is null or p.listing_expires_at >= (now() at time zone 'Asia/Riyadh')::date))
      from public.project_shares s
      join public.projects p on p.id = s.project_id
      left join public.profiles b on b.id = s.broker_id
      left join lateral (
            select count(distinct w.visitor) as people,
                   count(distinct w.visitor) filter (where w.viewed_at >= now() - interval '7 days') as people_week,
                   max(w.viewed_at) as last_at
              from public.project_share_views w
             where w.share_id = s.id
      ) v on true
     where (select public.my_role()) is not null
       and s.last_shared_at is not null
       and (s.broker_id = (select auth.uid()) or (coalesce(p_all, false) and (select public.is_admin())))
     order by v.last_at desc nulls last, s.last_shared_at desc
     limit 2000
$$;
revoke execute on function public.my_project_shares(boolean) from public, anon;
grant  execute on function public.my_project_shares(boolean) to authenticated;
