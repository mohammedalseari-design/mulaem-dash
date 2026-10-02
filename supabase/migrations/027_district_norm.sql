-- 027_district_norm — كشف المكرّرات يطابق الحي بعد تطبيعه («حي المروة» هو «المروة»)، والاعتماد يحفظه بلا «حي».
--
-- العطل (ثبت على القاعدة الحية في 2 أكتوبر 2026): وظيفة الاستخراج تنقل الحي إلى المسودة كما ورد في العرض («حي المروة»)،
-- والمشاريع تحفظه بلا «حي» («المروة»). قاعدة «نفس الحي ونفس النوع» في agent_find_duplicates تقارن بـ agent_norm_name،
-- وهي تحذف المسافات ولا تحذف «حي»: «حيالمروه» لا تساوي «المروه»، فوجدت مسودة «شقة – حي المروة» صفر مكرّرات وفي
-- المروة تسعة مشاريع شقق. واعتماد مسودة كهذه يكتب «حي المروة» قيمةً جديدة في projects.district بجانب «المروة».
--
-- ما يضيفه:
--   * agent_norm_district: مفتاح مقارنة للحي، لا يُعرض ولا يُحفظ.
--   * agent_find_duplicates: قاعدة الحي والنوع تقارن بـ agent_norm_district على الطرفين. لا تغيير غيره.
--   * agent_apply_draft: حيّ المشروع الجديد يُحفظ بلا «حي »/«مخطط » في أوله. لا تغيير غيره.
--
-- جسما الدالتين منسوخان من تعريفهما الحي (pg_get_functiondef) لا من 020: طُبّقت 020 بلا أسطر التعليق التي داخل
-- الجسمين، وما سواها مطابق لها حرفاً بحرف. في كل جسم سطر واحد تغيّر، مكتوب قبل الدالة. التواقيع و security definer
-- والصلاحيات كما هي حية، فلا تحتاج agent-run (تنادي agent_find_duplicates) ولا «طلبات الاعتماد» (تنادي agent_apply_draft)
-- أي تغيير أو إعادة نشر.
-- للتراجع: أعد تعريف الدالتين كما في 020 (القسمان 4 و6)، ثم drop function public.agent_norm_district(text).

-- ============================================================
-- (1) تطبيع الحي للمقارنة
-- ============================================================
-- بالترتيب: الهمزات (أإآٱ) ألفاً والتاء المربوطة هاءً والألف المقصورة ياءً والأرقام لاتينية، كما في agent_norm_name؛
-- ثم يُحذف التشكيل والتطويل وعلامات الاتجاه الخفية؛ وكل مسافات متتالية (ومنها غير الفاصلة) مسافة واحدة؛ ثم يُحذف ما في
-- الأول من ترقيم وشرطات ورموز («- درب الحرمين»)، ثم «حي» أو «مخطط» في الأول مع ما بعدها من فواصل، ثم ما في الآخر من
-- ترقيم، ثم كل ما بقي داخل الاسم من مسافات وترقيم ورموز كما تحذفه agent_norm_name: «الواحة-سندس» و«الواحة - سندس»
-- و«الواحة سندس» و«الواحةسندس» مفتاح واحد. ما يبقى فارغاً («حي» وحدها، أو نص فارغ) يعود null فلا يطابق شيئاً.
-- و«ال» لا تُحذف («سندس» و«السندس» اثنان): الربط بين اسمين عمل قائمة أحياء.
-- قُورن بـ agent_norm_name على أحياء المشاريع والمسودات الحية (71 قيمة مختلفة، SELECT فقط، 2 أكتوبر): لم تفترق قيمتان كانتا
-- تتطابقان، وأُضيف «حي المروة» = «المروة»، «حي السامر» = «السامر»، «مخطط سندس» = «سندس»، «مخطط شمس العروس» = «شمس العروس».
-- وذلك في تلك القيم لا في كل نص، ومما يفترق: «حي» أو «مخطط» ملتصقة بالاسم بلا فاصل («حيالمروة» تبقى و«حي المروة» تصير
-- «المروه»)، والاسم الذي فيه كلمة عامة تحذفها agent_norm_name ولا تحذفها هذه («برج»، «مجمع»…).
create or replace function public.agent_norm_district(p text) returns text
language plpgsql immutable set search_path = public as $$
declare s text;
begin
    s := translate(lower(coalesce(p, '')), 'أإآٱةى٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', 'ااااهي01234567890123456789');
    s := regexp_replace(s, '[\u064B-\u065F\u0670\u0640\u061C\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]', '', 'g');
    s := regexp_replace(s, '[\s\u00A0\u2000-\u200A\u202F\u205F\u3000]+', ' ', 'g');
    s := regexp_replace(s, '^[^a-z0-9\u0621-\u064A]+', '');
    s := regexp_replace(s, '^(حي|مخطط)([^a-z0-9\u0621-\u064A]+|$)', '');
    s := regexp_replace(s, '[^a-z0-9\u0621-\u064A]+$', '');
    s := regexp_replace(s, '[^a-z0-9\u0621-\u064A]+', '', 'g');
    return nullif(s, '');
end $$;
revoke execute on function public.agent_norm_district(text) from public, anon;
grant  execute on function public.agent_norm_district(text) to authenticated, service_role;

-- ============================================================
-- (2) مرشّحو التكرار: الحي المطبَّع على الطرفين
-- ============================================================
-- كما هي حية، وتغيّر سطر واحد في قاعدة الرتبة 4 («نفس الحي ونفس النوع»):
--   قبل:  and public.agent_norm_name(j.district) = public.agent_norm_name(p->>'district')
--   بعد:  and public.agent_norm_district(j.district) = public.agent_norm_district(p->>'district')
-- ما سواه كما هو: الحي والنوع غير فارغين، والنوع مطابق حرفياً، وأقوى عشرة مرشّحين. طلب التحديث (p_kind = 'update')
-- يرسل الاسم والحي بلا نوع، فلا تبلغه هذه القاعدة أصلاً.
create or replace function public.agent_find_duplicates(p_kind text, p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
    v_out   jsonb := '[]';
    v_name  text  := public.agent_norm_name(p->>'name');
    v_lat   double precision;
    v_lng   double precision;
    v_phone text;
    v_phones text[];
begin
    if p_kind in ('project', 'update') then
        begin
            v_lat := (p->>'latitude')::double precision;
            v_lng := (p->>'longitude')::double precision;
        exception when others then v_lat := null; v_lng := null; end;

        select coalesce(jsonb_agg(c order by c->>'rank', (c->>'id')::int), '[]') into v_out
        from (
          select c from (
            select distinct on (j.id) jsonb_build_object(
                'kind', 'project', 'id', j.id::text, 'name', j.name, 'district', j.district,
                'type', j.type, 'status', j.status,
                'units', case when jsonb_typeof(j.details->'models') = 'array'
                              then jsonb_array_length(j.details->'models') else 0 end,
                'reason', m.reason, 'rank', m.rank) c
            from public.projects j
            cross join lateral (values
                (case when v_name is not null and public.agent_norm_name(j.name) = v_name
                      then 'الاسم مطابق بعد التطبيع' end, '1'),
                (case when v_name is not null and length(v_name) >= 4
                           and public.agent_norm_name(j.name) <> v_name
                           and (public.agent_norm_name(j.name) like '%' || v_name || '%'
                                or v_name like '%' || public.agent_norm_name(j.name) || '%')
                      then 'الاسم متقارب' end, '2'),
                (case when v_lat is not null and v_lng is not null and j.latitude is not null and j.longitude is not null
                           and abs(j.latitude - v_lat) < 0.003 and abs(j.longitude - v_lng) < 0.003
                      then 'الموقع على بعد أقل من 300 متر تقريباً' end, '3'),
                (case when nullif(btrim(p->>'district'), '') is not null and nullif(btrim(p->>'type'), '') is not null
                           and public.agent_norm_district(j.district) = public.agent_norm_district(p->>'district')
                           and j.type = btrim(p->>'type')
                      then 'نفس الحي ونفس النوع' end, '4')
            ) as m(reason, rank)
            where j.deleted_at is null and m.reason is not null
            order by j.id, m.rank
          ) best
          order by c->>'rank', (c->>'id')::int
          limit 10
        ) s;
        return v_out;
    end if;

    if p_kind = 'client' then
        select array_agg(distinct x) into v_phones
        from unnest(array[public.normalize_phone(p->>'phone'), public.normalize_phone(p->>'phone_alt')]) x
        where x is not null;
        if v_phones is null then return '[]'; end if;
        select coalesce(jsonb_agg(jsonb_build_object(
                   'kind', 'client', 'id', c.id::text, 'name', c.full_name, 'phone', c.phone,
                   'reason', 'رقم الجوال مطابق بعد التطبيع')), '[]')
          into v_out
          from public.clients c
         where c.phone = any(v_phones) or c.phone_alt = any(v_phones);
        return v_out;
    end if;

    return '[]';
end $$;
revoke execute on function public.agent_find_duplicates(text, jsonb) from public, anon, authenticated;
grant  execute on function public.agent_find_duplicates(text, jsonb) to service_role;

-- ============================================================
-- (3) الاعتماد: حيّ المشروع الجديد بلا «حي »/«مخطط »
-- ============================================================
-- كما هي حية، وتغيّر سطر واحد: قيمة district عند إدراج مشروع جديد.
--   قبل:  nullif(btrim(coalesce(p->>'district', '')), ''),
--   بعد:  nullif(btrim(regexp_replace(coalesce(p->>'district', ''), '^\s*(ح[يى]|مخطط)\s+(?=[\u0621-\u064A])', '')), ''),
-- الكلمة تُحذف حين يليها اسم (حرف عربي)، فيبقى «مخطط ٧» كما هو ولا يصير رقماً وحده. القيمة المحفوظة للعرض، فلا تُطبَّع
-- فيها الهمزات ولا التاء المربوطة (ذاك عمل agent_norm_district).
-- تعديل مشروع قائم لم يتغير ولا يحتاج: مسودة التحديث لا تحمل district (PROJECT_RULES في agent-run/validate.ts بلا حي)،
-- ومحرّر المسودة في «طلبات الاعتماد» يعدّل المفاتيح الموجودة في المقترح ولا يضيف غيرها (crm/js/approvals.js).
create or replace function public.agent_apply_draft(p_draft uuid, p_content_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    d           public.agent_drafts%rowtype;
    p           jsonb;
    v_now_hash  text;
    v_record    text;
    v_kind      text;
    v_client    uuid;
    v_uuid      uuid;
    v_int       int;
    v_ord       int;
    v_models    jsonb;
    v_unit      jsonb;
    v_districts text[];
    v_req       jsonb;
begin
    select * into d from public.agent_drafts where id = p_draft for update;
    if not found then
        return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    if d.status = 'applied' then
        return jsonb_build_object('ok', true, 'code', 'already_applied',
                                  'record_kind', case when d.target_kind = 'unit' then 'project' else d.target_kind end,
                                  'record_id', d.applied_record);
    end if;

    if not public.is_admin() then
        return jsonb_build_object('ok', false, 'code', 'forbidden');
    end if;

    if d.status <> 'submitted' then
        return jsonb_build_object('ok', false, 'code', 'not_submitted', 'status', d.status);
    end if;

    if p_content_hash is null or p_content_hash <> d.content_hash then
        return jsonb_build_object('ok', false, 'code', 'stale_draft');
    end if;

    p := d.proposed;
    perform set_config('mulaem.applying', 'on', true);

    if d.target_id is not null then
        if d.target_kind = 'client' then
            begin v_uuid := d.target_id::uuid; exception when others then v_uuid := null; end;
            select md5(t::text) into v_now_hash from public.clients t where t.id = v_uuid;
        elsif d.target_kind = 'requirement' then
            begin v_uuid := d.target_id::uuid; exception when others then v_uuid := null; end;
            select md5(t::text) into v_now_hash from public.client_requirements t where t.id = v_uuid;
        elsif d.target_kind = 'project' then
            begin v_int := d.target_id::int; exception when others then v_int := null; end;
            select md5(t::text) into v_now_hash from public.projects t where t.id = v_int;
        elsif d.target_kind = 'unit' then
            begin
                v_int := split_part(d.target_id, '/', 1)::int;
                v_ord := split_part(d.target_id, '/', 2)::int;
            exception when others then v_int := null; v_ord := null; end;
            select md5((t.details->'models'->(v_ord - 1))::text) into v_now_hash from public.projects t
             where t.id = v_int and jsonb_typeof(t.details->'models') = 'array'
               and v_ord between 1 and jsonb_array_length(t.details->'models')
             for update;
        else
            perform set_config('mulaem.applying', 'off', true);
            return jsonb_build_object('ok', false, 'code', 'unsupported_target', 'target_kind', d.target_kind);
        end if;

        if v_now_hash is null then
            perform set_config('mulaem.applying', 'off', true);
            return jsonb_build_object('ok', false, 'code', 'target_missing');
        end if;

        if d.baseline_hash is not null and d.baseline_hash <> v_now_hash then
            update public.agent_drafts set status = 'stale' where id = d.id;
            perform set_config('mulaem.applying', 'off', true);
            return jsonb_build_object(
                'ok', false, 'code', 'record_changed',
                'current', case
                    when d.target_kind = 'client'      then (select to_jsonb(t) from public.clients t where t.id = v_uuid)
                    when d.target_kind = 'requirement' then (select to_jsonb(t) from public.client_requirements t where t.id = v_uuid)
                    when d.target_kind = 'unit'        then (select t.details->'models'->(v_ord - 1) from public.projects t where t.id = v_int)
                    else (select to_jsonb(t) from public.projects t where t.id = v_int)
                end);
        end if;
    end if;

    begin
        if d.target_kind = 'client' then
            v_req := case when jsonb_typeof(p->'requirement') = 'object' then p->'requirement' end;
            if v_req is not null and (coalesce(btrim(v_req->>'purpose'), '') = ''
                                      or coalesce(btrim(v_req->>'property_type'), '') = '') then
                perform set_config('mulaem.applying', 'off', true);
                return jsonb_build_object('ok', false, 'code', 'missing_required');
            end if;
            if d.target_id is null then
                if coalesce(btrim(p->>'full_name'), '') = '' or coalesce(btrim(p->>'phone'), '') = '' then
                    perform set_config('mulaem.applying', 'off', true);
                    return jsonb_build_object('ok', false, 'code', 'missing_required');
                end if;
                insert into public.clients (full_name, phone, phone_alt, email, source, client_type, city, notes)
                values (btrim(p->>'full_name'), btrim(p->>'phone'), nullif(btrim(coalesce(p->>'phone_alt', '')), ''),
                        nullif(btrim(coalesce(p->>'email', '')), ''), nullif(btrim(coalesce(p->>'source', '')), ''),
                        nullif(btrim(coalesce(p->>'client_type', '')), ''), nullif(btrim(coalesce(p->>'city', '')), ''),
                        nullif(btrim(coalesce(p->>'notes', '')), ''))
                returning id into v_uuid;
            else
                update public.clients c set
                    full_name   = coalesce(nullif(btrim(coalesce(p->>'full_name', '')), ''), c.full_name),
                    phone       = coalesce(nullif(btrim(coalesce(p->>'phone', '')), ''), c.phone),
                    phone_alt   = coalesce(nullif(btrim(coalesce(p->>'phone_alt', '')), ''), c.phone_alt),
                    email       = coalesce(nullif(btrim(coalesce(p->>'email', '')), ''), c.email),
                    source      = coalesce(nullif(btrim(coalesce(p->>'source', '')), ''), c.source),
                    client_type = coalesce(nullif(btrim(coalesce(p->>'client_type', '')), ''), c.client_type),
                    city        = coalesce(nullif(btrim(coalesce(p->>'city', '')), ''), c.city),
                    notes       = coalesce(nullif(btrim(coalesce(p->>'notes', '')), ''), c.notes)
                where c.id = v_uuid;
            end if;
            v_record := v_uuid::text;
            v_client := v_uuid;
            v_kind   := 'client';

            if v_req is not null then
                if jsonb_typeof(v_req->'districts') = 'array' then
                    select array_agg(x #>> '{}') into v_districts from jsonb_array_elements(v_req->'districts') x;
                end if;
                insert into public.client_requirements
                    (client_id, purpose, property_type, city, districts, budget_min, budget_max,
                     area_min, area_max, rooms_min, delivery_before, financing_type, notes)
                values (v_uuid, btrim(v_req->>'purpose'), btrim(v_req->>'property_type'),
                        nullif(btrim(coalesce(v_req->>'city', '')), ''), coalesce(v_districts, '{}'),
                        (v_req->>'budget_min')::numeric, (v_req->>'budget_max')::numeric,
                        (v_req->>'area_min')::numeric, (v_req->>'area_max')::numeric, (v_req->>'rooms_min')::int,
                        (v_req->>'delivery_before')::date, nullif(btrim(coalesce(v_req->>'financing_type', '')), ''),
                        nullif(btrim(coalesce(v_req->>'notes', '')), ''));
            end if;

        elsif d.target_kind = 'requirement' then
            if jsonb_typeof(p->'districts') = 'array' then
                select array_agg(x #>> '{}') into v_districts from jsonb_array_elements(p->'districts') x;
            else
                v_districts := null;
            end if;
            if d.target_id is null then
                begin v_client := (p->>'client_id')::uuid; exception when others then v_client := null; end;
                if v_client is null or coalesce(btrim(p->>'purpose'), '') = ''
                   or coalesce(btrim(p->>'property_type'), '') = '' then
                    perform set_config('mulaem.applying', 'off', true);
                    return jsonb_build_object('ok', false, 'code', 'missing_required');
                end if;
                insert into public.client_requirements
                    (client_id, purpose, property_type, city, districts, budget_min, budget_max,
                     area_min, area_max, rooms_min, delivery_before, financing_type, notes)
                values (v_client, btrim(p->>'purpose'), btrim(p->>'property_type'),
                        nullif(btrim(coalesce(p->>'city', '')), ''), coalesce(v_districts, '{}'),
                        (p->>'budget_min')::numeric, (p->>'budget_max')::numeric,
                        (p->>'area_min')::numeric, (p->>'area_max')::numeric, (p->>'rooms_min')::int,
                        (p->>'delivery_before')::date, nullif(btrim(coalesce(p->>'financing_type', '')), ''),
                        nullif(btrim(coalesce(p->>'notes', '')), ''))
                returning id into v_uuid;
            else
                update public.client_requirements r set
                    purpose         = coalesce(nullif(btrim(coalesce(p->>'purpose', '')), ''), r.purpose),
                    property_type   = coalesce(nullif(btrim(coalesce(p->>'property_type', '')), ''), r.property_type),
                    city            = coalesce(nullif(btrim(coalesce(p->>'city', '')), ''), r.city),
                    districts       = coalesce(v_districts, r.districts),
                    budget_min      = coalesce((p->>'budget_min')::numeric, r.budget_min),
                    budget_max      = coalesce((p->>'budget_max')::numeric, r.budget_max),
                    area_min        = coalesce((p->>'area_min')::numeric, r.area_min),
                    area_max        = coalesce((p->>'area_max')::numeric, r.area_max),
                    rooms_min       = coalesce((p->>'rooms_min')::int, r.rooms_min),
                    delivery_before = coalesce((p->>'delivery_before')::date, r.delivery_before),
                    financing_type  = coalesce(nullif(btrim(coalesce(p->>'financing_type', '')), ''), r.financing_type),
                    notes           = coalesce(nullif(btrim(coalesce(p->>'notes', '')), ''), r.notes)
                where r.id = v_uuid
                returning r.client_id into v_client;
            end if;
            v_record := v_uuid::text;
            v_kind   := 'requirement';

        elsif d.target_kind = 'project' then
            if d.target_id is null then
                if coalesce(btrim(p->>'name'), '') = '' then
                    perform set_config('mulaem.applying', 'off', true);
                    return jsonb_build_object('ok', false, 'code', 'missing_required');
                end if;
                insert into public.projects (name, type, price, area, address, latitude, longitude, notes, details,
                                             city, district, district_inferred, purpose, availability, rooms, delivery_date)
                values (btrim(p->>'name'), nullif(btrim(coalesce(p->>'type', '')), ''),
                        (p->>'price')::numeric, (p->>'area')::numeric,
                        nullif(btrim(coalesce(p->>'address', '')), ''),
                        (p->>'latitude')::double precision, (p->>'longitude')::double precision,
                        nullif(btrim(coalesce(p->>'notes', '')), ''),
                        case when jsonb_typeof(p->'details') = 'object' then p->'details' else '{}'::jsonb end,
                        nullif(btrim(coalesce(p->>'city', '')), ''),
                        nullif(btrim(regexp_replace(coalesce(p->>'district', ''), '^\s*(ح[يى]|مخطط)\s+(?=[\u0621-\u064A])', '')), ''),
                        false,
                        nullif(btrim(coalesce(p->>'purpose', '')), ''),
                        coalesce(nullif(btrim(coalesce(p->>'availability', '')), ''), 'available'),
                        (p->>'rooms')::int, (p->>'delivery_date')::date)
                returning id into v_int;
            else
                update public.projects j set
                    name          = coalesce(nullif(btrim(coalesce(p->>'name', '')), ''), j.name),
                    type          = coalesce(nullif(btrim(coalesce(p->>'type', '')), ''), j.type),
                    price         = coalesce((p->>'price')::numeric, j.price),
                    area          = coalesce((p->>'area')::numeric, j.area),
                    address       = coalesce(nullif(btrim(coalesce(p->>'address', '')), ''), j.address),
                    latitude      = coalesce((p->>'latitude')::double precision, j.latitude),
                    longitude     = coalesce((p->>'longitude')::double precision, j.longitude),
                    notes         = coalesce(nullif(btrim(coalesce(p->>'notes', '')), ''), j.notes),
                    city          = coalesce(nullif(btrim(coalesce(p->>'city', '')), ''), j.city),
                    district      = coalesce(nullif(btrim(coalesce(p->>'district', '')), ''), j.district),
                    purpose       = coalesce(nullif(btrim(coalesce(p->>'purpose', '')), ''), j.purpose),
                    availability  = coalesce(nullif(btrim(coalesce(p->>'availability', '')), ''), j.availability),
                    rooms         = coalesce((p->>'rooms')::int, j.rooms),
                    delivery_date = coalesce((p->>'delivery_date')::date, j.delivery_date),
                    details       = case when jsonb_typeof(p->'details') = 'object'
                                         then j.details || jsonb_strip_nulls((p->'details') - 'models')
                                         else j.details end
                where j.id = v_int;
            end if;
            v_record := v_int::text;
            v_kind   := 'project';

        elsif d.target_kind = 'unit' then
            select coalesce(jsonb_object_agg(e.key, e.value), '{}') into v_unit
              from jsonb_each(p) e
             where e.key in ('name', 'type', 'rooms', 'bathrooms', 'area', 'price', 'count', 'status')
               and e.value <> 'null'::jsonb and e.value <> '""'::jsonb;

            if d.target_id is null then
                begin v_int := (p->>'project_id')::int; exception when others then v_int := null; end;
                if v_int is null or coalesce(btrim(v_unit->>'name'), '') = '' then
                    perform set_config('mulaem.applying', 'off', true);
                    return jsonb_build_object('ok', false, 'code', 'missing_required');
                end if;
                select case when jsonb_typeof(t.details->'models') = 'array' then t.details->'models' else '[]' end
                  into v_models from public.projects t where t.id = v_int for update;
                if not found then
                    perform set_config('mulaem.applying', 'off', true);
                    return jsonb_build_object('ok', false, 'code', 'target_missing');
                end if;
                update public.projects t
                   set details = jsonb_set(coalesce(t.details, '{}'), '{models}', v_models || jsonb_build_array(v_unit))
                 where t.id = v_int;
                v_ord := jsonb_array_length(v_models) + 1;
            else
                update public.projects t
                   set details = jsonb_set(t.details, array['models', (v_ord - 1)::text],
                                           (t.details->'models'->(v_ord - 1)) || v_unit)
                 where t.id = v_int;
            end if;
            v_record := v_int::text;
            v_kind   := 'project';

        else
            perform set_config('mulaem.applying', 'off', true);
            return jsonb_build_object('ok', false, 'code', 'unsupported_target', 'target_kind', d.target_kind);
        end if;
    exception when others then
        perform set_config('mulaem.applying', 'off', true);
        return jsonb_build_object('ok', false, 'code', 'apply_failed');
    end;

    if v_record is null then
        perform set_config('mulaem.applying', 'off', true);
        return jsonb_build_object('ok', false, 'code', 'target_missing');
    end if;

    insert into public.agent_decisions (draft_id, decision, reason, content_hash, actor_id)
    values (d.id, 'approve', null, d.content_hash, auth.uid());

    update public.agent_drafts
       set status = 'applied',
           applied_record = case when d.target_kind = 'unit' then v_record || '/' || v_ord else v_record end
     where id = d.id;

    insert into public.crm_events (client_id, entity_type, entity_id, event_type, payload, actor_id)
    values (v_client, 'agent', d.id::text, 'agent_draft_applied',
            jsonb_build_object(
                'request_id',   d.request_id,
                'target_kind',  d.target_kind,
                'record_id',    v_record,
                'unit_ord',     case when d.target_kind = 'unit' then v_ord end,
                'is_new',       d.target_id is null,
                'created_by',   d.created_by,
                'content_hash', d.content_hash,
                'sources',      (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind,
                                        'path', s.storage_path, 'url', s.url, 'sha256', s.sha256)
                                        order by s.created_at), '[]'::jsonb)
                                   from public.agent_sources s where s.request_id = d.request_id),
                'fields',       (select coalesce(jsonb_agg(k2 order by k2), '[]'::jsonb) from jsonb_object_keys(p) k2)),
            auth.uid());

    perform set_config('mulaem.applying', 'off', true);
    return jsonb_build_object('ok', true, 'code', 'applied', 'record_kind', v_kind, 'record_id', v_record);
end $$;
revoke execute on function public.agent_apply_draft(uuid, text) from public, anon;
grant  execute on function public.agent_apply_draft(uuid, text) to authenticated;

-- ============================================================
-- كيف تُختبر
-- ============================================================
-- بعد التطبيق، من محرّر SQL في لوحة Supabase (دور postgres)، كتلةً كتلة بعد نزع «-- » من أول كل سطر. كل كتلة تنتهي
-- بـ raise exception فتُلغى معاملتها كلها: «RESULT ok …» نجاح و«FAIL …» فشل. لا يبقى من (د) شيء غير تقدّم عدّادات
-- المعرّفات (projects و crm_events وسجل حالات المشاريع): التسلسلات لا ترجع مع الإلغاء.
--
-- (أ) التطبيع:
-- do $$
-- declare r record; bad text := '';
-- begin
--     for r in select * from (values
--         ('حي المروة', 'المروه'), ('المروة', 'المروه'), ('  -  حيّ  المروة ', 'المروه'), ('حى المروة', 'المروه'),
--         ('مخطط شمس العروس', 'شمسالعروس'), ('أبحر الجنوبية', 'ابحرالجنوبيه'), ('ابحرالجنوبية', 'ابحرالجنوبيه'),
--         ('الواحة-سندس', 'الواحهسندس'), ('الواحة سندس', 'الواحهسندس'), ('الواحة - سندس', 'الواحهسندس'),
--         ('حيفا', 'حيفا'), ('حي', null), ('مخطط', null), ('  ', null), ('', null), (null, null)
--     ) as t(input, expected)
--     loop
--         if public.agent_norm_district(r.input) is distinct from r.expected then
--             bad := bad || format(' [%s: %s، المتوقع %s]', r.input, public.agent_norm_district(r.input), r.expected);
--         end if;
--     end loop;
--     if bad <> '' then raise exception 'FAIL agent_norm_district:%', bad; end if;
--     raise exception 'RESULT ok: agent_norm_district';
-- end $$;
--
-- (ب) «حي المروة» يجد ما يجده «المروة»، و«حي» وحدها لا تجد شيئاً:
-- do $$
-- declare a jsonb; b jsonb;
-- begin
--     a := public.agent_find_duplicates('project', '{"district": "حي المروة", "type": "شقة"}');
--     b := public.agent_find_duplicates('project', '{"district": "المروة", "type": "شقة"}');
--     if jsonb_array_length(b) = 0 then raise exception 'FAIL: لا شقة في المروة للمقارنة'; end if;
--     if (select array_agg(x->>'id' order by x->>'id') from jsonb_array_elements(a) x)
--        is distinct from (select array_agg(x->>'id' order by x->>'id') from jsonb_array_elements(b) x) then
--         raise exception 'FAIL: «حي المروة» % مرشّحاً و«المروة» %', jsonb_array_length(a), jsonb_array_length(b);
--     end if;
--     if jsonb_array_length(public.agent_find_duplicates('project', '{"district": "حي", "type": "شقة"}')) > 0 then
--         raise exception 'FAIL: «حي» وحدها وجدت مرشّحين';
--     end if;
--     raise exception 'RESULT ok: % مرشّحاً للصيغتين (قبل 027: صفر لـ «حي المروة»)', jsonb_array_length(a);
-- end $$;
--
-- (ج) الجسمان كما في هذا الملف، و security definer والصلاحيات كما كانت حية:
-- do $$
-- declare bad text;
-- begin
--     if (select md5(prosrc) from pg_proc where oid = 'public.agent_find_duplicates(text,jsonb)'::regprocedure) <> '0e66213614ade3a0961d03efca004d72'
--        or (select md5(prosrc) from pg_proc where oid = 'public.agent_apply_draft(uuid,text)'::regprocedure) <> '76281dde448591a3237f9d89dd4011d6' then
--         raise exception 'FAIL: الجسم المطبَّق غير ما في الملف (نهايات أسطر CRLF؟)';
--     end if;
--     if not (select prosecdef from pg_proc where oid = 'public.agent_find_duplicates(text,jsonb)'::regprocedure)
--        or not (select prosecdef from pg_proc where oid = 'public.agent_apply_draft(uuid,text)'::regprocedure)
--        or (select prosecdef or provolatile <> 'i' from pg_proc where oid = 'public.agent_norm_district(text)'::regprocedure) then
--         raise exception 'FAIL: security definer أو immutable';
--     end if;
--     select string_agg(v.r || ' ' || v.f, '، ') into bad
--       from (values ('public.agent_norm_district(text)', 'anon', false),
--                    ('public.agent_norm_district(text)', 'authenticated', true),
--                    ('public.agent_norm_district(text)', 'service_role', true),
--                    ('public.agent_find_duplicates(text,jsonb)', 'anon', false),
--                    ('public.agent_find_duplicates(text,jsonb)', 'authenticated', false),
--                    ('public.agent_find_duplicates(text,jsonb)', 'service_role', true),
--                    ('public.agent_apply_draft(uuid,text)', 'anon', false),
--                    ('public.agent_apply_draft(uuid,text)', 'authenticated', true),
--                    ('public.agent_apply_draft(uuid,text)', 'service_role', true)) as v(f, r, want)
--      where has_function_privilege(v.r::name, v.f, 'execute') <> v.want;
--     if bad is not null then raise exception 'FAIL: صلاحية التنفيذ على غير المتوقع: %', bad; end if;
--     raise exception 'RESULT ok: الجسمان كما في الملف، والصلاحيات كما كانت';
-- end $$;
--
-- (د) اعتماد مسودة مشروع جديد بحي « حي  المروة » يحفظ «المروة» (بهوية أول مدير، ثم يُلغى كل شيء):
-- do $$
-- declare v_admin uuid; v_req uuid; v_draft uuid; v_hash text; r jsonb; v_district text;
-- begin
--     select id into v_admin from public.profiles where role = 'admin' and not is_blocked order by created_at limit 1;
--     if v_admin is null then raise exception 'FAIL: لا مدير'; end if;
--     -- auth.uid() تُقرأ من ادعاءات JWT، والقيمة لهذه المعاملة وحدها
--     perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
--     insert into public.agent_requests (kind, instruction) values ('project', 'فحص 027 — يُلغى') returning id into v_req;
--     insert into public.agent_drafts (request_id, target_kind, proposed)
--     values (v_req, 'project', '{"name": "فحص 027 — يُلغى", "type": "شقة", "city": "جدة", "district": " حي  المروة "}')
--     returning id into v_draft;
--     update public.agent_drafts set status = 'submitted' where id = v_draft returning content_hash into v_hash;
--     r := public.agent_apply_draft(v_draft, v_hash);
--     if r->>'code' is distinct from 'applied' then raise exception 'FAIL: %', r; end if;
--     select district into v_district from public.projects where id = (r->>'record_id')::int;
--     if v_district is distinct from 'المروة' then raise exception 'FAIL: حُفظ الحي «%»', v_district; end if;
--     raise exception 'RESULT ok: حُفظ «%» ثم أُلغي كل شيء', v_district;
-- end $$;
--
-- (هـ) لا حيّ كان يطابق نظيره بـ agent_norm_name افترق عنه الآن (أحياء المشاريع وقت التشغيل):
-- do $$
-- declare n int;
-- begin
--     select count(*) into n from (
--         select 1 from public.projects where deleted_at is null and district is not null
--          group by public.agent_norm_name(district)
--         having count(distinct coalesce(public.agent_norm_district(district), '')) > 1) x;
--     if n > 0 then raise exception 'FAIL: % مجموعة أحياء افترقت', n; end if;
--     raise exception 'RESULT ok: لا مجموعة افترقت';
-- end $$;
