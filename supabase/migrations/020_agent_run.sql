-- 020_agent_run — الجولة B من مهمة وكيل الاستيراد (docs/TASK_AGENT.md): الاستخراج الفعلي.
-- طُبّقت على المشروع الحي باسم agent_run.
--
-- الرقم 020 لا 012 عمداً: في نسخة العمل المحلية ملفات 012–019 لم تُرفع ولم تُطبَّق بعد،
-- وهذا الملف لا يعتمد على أي منها.
--
-- ما يضيفه:
--   * أعمدة التنفيذ على agent_requests: المرحلة (قراءة/استخراج/تحقق)، والمرشّحون حين لا
--     يُعرف السجل المقصود بثقة، والسجل الذي اختاره الموظف.
--   * agent_drafts.suspicious: نص في المصدر يحاول توجيه الوكيل (اعتمد، غيّر مهمتك...) يُقتبس
--     هنا ويُتجاهل. لا يدخل في content_hash ولا يعدّله المستخدم.
--   * سقف يومي لطلبات كل مستخدم، مفروض في القاعدة.
--   * دوال لا يناديها إلا مفتاح الخدمة (وظيفة agent-run): حجز الطلب بعقد إيجار، لقطة السجل
--     الهدف وبصمته، البحث عن المكرّرات، والتحقق من سر المُجدوِل.
--   * agent_pick_target: الموظف يختار المشروع/الوحدة حين لا يستطيع الوكيل الجزم.
--   * agent_apply_draft: تطبيق الوحدة (داخل projects.details.models) وأعمدة مشروع إضافية.
--   * مهمة pg_cron كل خمس دقائق تعيد استدعاء الطلبات العالقة.
--
-- الوكيل لا يكتب في projects / clients / client_requirements أبداً؛ يكتب مسودات فقط،
-- ويبقى agent_apply_draft الطريق الوحيد إلى السجلات.

-- ============================================================
-- (1) أعمدة جديدة
-- ============================================================
alter table public.agent_requests
    add column if not exists stage      text check (stage in ('reading', 'extracting', 'validating')),
    add column if not exists candidates jsonb not null default '[]',
    add column if not exists target_id  text;

alter table public.agent_drafts
    add column if not exists suspicious jsonb not null default '[]';

-- ============================================================
-- (2) حارس الطلبات: السقف اليومي، وأعمدة التنفيذ للخادم وحده
-- ============================================================
-- الحد اليومي في دالة واحدة يقرؤها الحارس ووظيفة الاستخراج معاً.
create or replace function public.agent_daily_cap() returns int
language sql immutable set search_path = public as $$ select 20 $$;
revoke execute on function public.agent_daily_cap() from public, anon;
grant  execute on function public.agent_daily_cap() to authenticated, service_role;

create or replace function public.agent_requests_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_role text; v_today int;
begin
    new.instruction := btrim(new.instruction);
    if new.instruction = '' then raise exception 'التعليمات مطلوبة'; end if;

    if tg_op = 'UPDATE' then
        new.updated_at   := now();
        new.created_at   := old.created_at;
        new.requested_by := old.requested_by;
        new.kind         := old.kind;
    end if;

    -- مفتاح الخدمة (وظيفة الاستخراج) أو صيانة من لوحة Supabase أو agent_pick_target
    if v_uid is null or coalesce(current_setting('mulaem.agent_pick', true), '') = 'on' then
        return new;
    end if;

    v_role := public.my_role();
    if v_role is null then raise exception 'غير مصرح'; end if;

    if tg_op = 'INSERT' then
        new.requested_by := v_uid;
        new.status       := 'queued';
        new.attempts     := 0;
        new.tokens_used  := null;
        new.error_ar     := null;
        new.lease_until  := null;
        new.stage        := null;
        new.candidates   := '[]';
        new.target_id    := null;
        if v_role = 'callcenter' and new.kind <> 'client' then
            raise exception 'مركز الاتصال ينشئ طلبات العملاء فقط';
        end if;
        if new.kind = 'external' and not public.is_admin() then
            raise exception 'الاستيراد من مصدر خارجي للمدير فقط';
        end if;
        -- السقف اليومي بتوقيت الرياض، لكل مستخدم بمن فيهم المدير
        select count(*) into v_today from public.agent_requests r
        where r.requested_by = v_uid
          and r.created_at >= (date_trunc('day', now() at time zone 'Asia/Riyadh') at time zone 'Asia/Riyadh');
        if v_today >= public.agent_daily_cap() then
            raise exception 'بلغت الحد اليومي لطلبات المساعد (% طلباً)', public.agent_daily_cap();
        end if;
        return new;
    end if;

    -- حالة التنفيذ يكتبها الخادم؛ المستخدم لا يملك إلا الإلغاء
    new.attempts    := old.attempts;
    new.tokens_used := old.tokens_used;
    new.lease_until := old.lease_until;
    new.stage       := old.stage;
    new.candidates  := old.candidates;
    new.target_id   := old.target_id;
    if new.status is distinct from old.status then
        if new.status <> 'cancelled' or old.status not in ('queued', 'running') then
            raise exception 'حالة الطلب يحددها الخادم';
        end if;
    end if;
    if new.status <> 'cancelled' then new.error_ar := old.error_ar; end if;
    if old.status <> 'queued' then
        new.instruction := old.instruction;
        new.title       := old.title;
    end if;
    return new;
end $$;
revoke execute on function public.agent_requests_guard() from public, anon, authenticated;

-- ============================================================
-- (3) حارس المسودات: المستخدم يعدّل المقترح وحده
-- ============================================================
-- كما في 011، مع تضييق نصّ المهمة: "يعدّل proposed وهي مسودة أو مُعادة، ولا شيء غيره".
-- الدليل والناقص والتعارضات والمكرّرات والمحتوى المريب يكتبها الخادم ولا تُمحى من المتصفح.
create or replace function public.agent_drafts_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
    v_uid      uuid := auth.uid();
    v_role     text;
    v_applying boolean := coalesce(current_setting('mulaem.applying', true), '') = 'on';
begin
    new.content_hash := md5(new.proposed::text || new.evidence::text);

    if tg_op = 'UPDATE' then
        new.updated_at  := now();
        new.created_at  := old.created_at;
        new.created_by  := old.created_by;
        new.request_id  := old.request_id;
        new.target_kind := old.target_kind;
        new.target_id   := old.target_id;
    end if;

    if v_applying then return new; end if;

    -- مفتاح الخدمة (وظيفة الاستخراج) أو صيانة من لوحة Supabase
    if v_uid is null then return new; end if;

    v_role := public.my_role();
    if v_role is null then raise exception 'غير مصرح'; end if;

    if tg_op = 'INSERT' then
        new.created_by     := v_uid;
        new.status         := 'draft';
        new.applied_record := null;
        return new;
    end if;

    if old.status in ('approved', 'applied', 'rejected', 'stale') then
        raise exception 'لا يمكن تعديل مسودة في هذه الحالة';
    end if;

    if new.status is distinct from old.status then
        if new.status in ('approved', 'applied') then
            raise exception 'الاعتماد يتم عبر دالة الاعتماد وحدها';
        elsif new.status = 'submitted' then
            if not (public.is_admin() or old.created_by = v_uid) then raise exception 'غير مصرح'; end if;
            if old.status not in ('draft', 'returned') then raise exception 'انتقال غير مسموح'; end if;
        elsif new.status in ('rejected', 'returned') then
            if not public.is_admin() then raise exception 'الرفض والإعادة للمدير فقط'; end if;
            if old.status <> 'submitted' then raise exception 'انتقال غير مسموح'; end if;
        elsif new.status = 'draft' then
            if not (public.is_admin() or old.created_by = v_uid) then raise exception 'غير مصرح'; end if;
            if old.status <> 'returned' then raise exception 'انتقال غير مسموح'; end if;
        else
            raise exception 'انتقال غير مسموح';
        end if;
    end if;

    new.evidence      := old.evidence;
    new.missing       := old.missing;
    new.conflicts     := old.conflicts;
    new.duplicates    := old.duplicates;
    new.suspicious    := old.suspicious;
    new.baseline_hash := old.baseline_hash;
    new.applied_record := old.applied_record;

    -- المقترح يُعدَّل وهي مسودة أو مُعادة للموظف، لا بعد إرسالها للاعتماد
    if old.status not in ('draft', 'returned') then
        new.proposed := old.proposed;
    end if;
    new.content_hash := md5(new.proposed::text || new.evidence::text);
    return new;
end $$;
revoke execute on function public.agent_drafts_guard() from public, anon, authenticated;

-- ============================================================
-- (4) دوال الخادم (service_role فقط)
-- ============================================================

-- حجز طلب للتنفيذ: ذرّي، فلا يعمل نداءان على الطلب نفسه. ينجح مع طلب في الانتظار، أو
-- طلب "قيد التنفيذ" انتهى عقده (توقفت الوظيفة في منتصفه)، ما دامت المحاولات دون السقف.
create or replace function public.agent_claim_request(p_request uuid, p_lease_seconds int, p_max_attempts int)
returns setof public.agent_requests
language sql security definer set search_path = public as $$
    update public.agent_requests r
       set status      = 'running',
           stage       = 'reading',
           attempts    = r.attempts + 1,
           lease_until = now() + make_interval(secs => p_lease_seconds),
           error_ar    = null
     where r.id = p_request
       and r.attempts < p_max_attempts
       and (r.status = 'queued' or (r.status = 'running' and r.lease_until < now()))
    returning r.*
$$;
revoke execute on function public.agent_claim_request(uuid, int, int) from public, anon, authenticated;
grant  execute on function public.agent_claim_request(uuid, int, int) to service_role;

-- الطلبات التي تنتظر تنفيذاً، ويُغلق ما استنفد محاولاته برسالة واضحة.
create or replace function public.agent_pending_requests(p_max_attempts int, p_limit int)
returns setof uuid
language plpgsql security definer set search_path = public as $$
begin
    update public.agent_requests
       set status = 'failed', stage = null, lease_until = null,
           error_ar = 'تعذّر التنفيذ بعد ' || p_max_attempts || ' محاولات — أعد إنشاء الطلب أو راجع المدير'
     where status in ('queued', 'running')
       and attempts >= p_max_attempts
       and (lease_until is null or lease_until < now());

    return query
        select id from public.agent_requests
         where status in ('queued', 'running')
           and attempts < p_max_attempts
           and (lease_until is null or lease_until < now())
         order by created_at
         limit p_limit;
end $$;
revoke execute on function public.agent_pending_requests(int, int) from public, anon, authenticated;
grant  execute on function public.agent_pending_requests(int, int) to service_role;

-- لقطة السجل الهدف مع بصمته بنفس صيغة agent_apply_draft، فيُبنى الفرق والبصمة من الصف نفسه.
-- الوحدة تعيش في projects.details.models، وبصمتها بصمة كائن الوحدة نفسه: تعديل المشروع
-- (الذي لا يمسّ الوحدات) لا يُسقط مسودة وحدة، وتعديل الوحدة يُسقطها.
-- معرّف الوحدة: '<رقم المشروع>/<ترتيب الوحدة>' والترتيب يبدأ من 1 كما في v_units.
create or replace function public.agent_target_snapshot(p_kind text, p_id text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uuid uuid; v_int int; v_ord int; r jsonb; h text;
begin
    if p_kind in ('client', 'requirement') then
        begin v_uuid := p_id::uuid; exception when others then return null; end;
        if p_kind = 'client' then
            select to_jsonb(t), md5(t::text) into r, h from public.clients t where t.id = v_uuid;
        else
            select to_jsonb(t), md5(t::text) into r, h from public.client_requirements t where t.id = v_uuid;
        end if;
    elsif p_kind = 'project' then
        begin v_int := p_id::int; exception when others then return null; end;
        select to_jsonb(t), md5(t::text) into r, h from public.projects t where t.id = v_int;
    elsif p_kind = 'unit' then
        begin
            v_int := split_part(p_id, '/', 1)::int;
            v_ord := split_part(p_id, '/', 2)::int;
        exception when others then return null; end;
        if v_ord < 1 then return null; end if;
        select t.details->'models'->(v_ord - 1) into r from public.projects t where t.id = v_int;
        if r is null or jsonb_typeof(r) <> 'object' then return null; end if;
        h := md5(r::text);
    else
        return null;
    end if;
    if h is null then return null; end if;
    return jsonb_build_object('row', r, 'hash', h);
end $$;
revoke execute on function public.agent_target_snapshot(text, text) from public, anon, authenticated;
grant  execute on function public.agent_target_snapshot(text, text) to service_role;

-- تطبيع الاسم للمقارنة: الهمزات والتاء المربوطة والألف المقصورة والتشكيل والمسافات
-- والكلمات العامة ("مشروع"، "أبراج") لا تفرّق بين مشروعين.
create or replace function public.agent_norm_name(p text) returns text
language sql immutable set search_path = public as $$
    select nullif(regexp_replace(
        regexp_replace(
            translate(lower(coalesce(p, '')), 'أإآٱةى٠١٢٣٤٥٦٧٨٩', 'ااااهي0123456789'),
            '[ً-ْـ]', '', 'g'),
        '(^|\s)(مشروع|مشاريع|ابراج|برج|مجمع|سكني|عمارة|عمائر)(?=\s|$)|[^a-z0-9ء-ي]+', '', 'g'), '')
$$;
revoke execute on function public.agent_norm_name(text) from public, anon;
grant  execute on function public.agent_norm_name(text) to authenticated, service_role;

-- مرشّحو التكرار. للمشروع: الاسم المطبَّع، ثم الإحداثيات (≈300 م)، ثم الحي مع النوع.
-- للعميل: الجوال المطبَّع وحده — الاسم وحده ليس دليلاً على أن الشخصين واحد.
-- للتحديث: نفس بحث المشروع لكنه يعيد اسم الحي وعدد الوحدات لعرضه على الموظف عند الاختيار.
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

        -- مرشّح واحد لكل مشروع بأقوى سبب، ثم أقوى عشرة: الحي والنوع وحدهما قد يطابقان
        -- عشرات المشاريع، فلا يُزاحمان تطابق الاسم أو الموقع.
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
                           and public.agent_norm_name(j.district) = public.agent_norm_name(p->>'district')
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

-- سر المُجدوِل: قيمة عشوائية في Vault، لا في المستودع ولا في إعدادات الوظيفة.
-- مهمة pg_cron ترسلها، والوظيفة تتحقق منها هنا بمفتاح الخدمة.
do $$
begin
    if not exists (select 1 from vault.secrets where name = 'agent_cron_secret') then
        perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'agent_cron_secret',
                                    'يرسله pg_cron إلى وظيفة agent-run لإعادة استدعاء الطلبات العالقة');
    end if;
end $$;

create or replace function public.agent_cron_secret_ok(p_secret text) returns boolean
language sql stable security definer set search_path = public as $$
    select coalesce(p_secret is not null and length(p_secret) >= 32 and exists (
        select 1 from vault.decrypted_secrets s where s.name = 'agent_cron_secret' and s.decrypted_secret = p_secret
    ), false)
$$;
revoke execute on function public.agent_cron_secret_ok(text) from public, anon, authenticated;
grant  execute on function public.agent_cron_secret_ok(text) to service_role;

-- ============================================================
-- (5) اختيار السجل الهدف من المستخدم
-- ============================================================
-- حين لا يجزم الوكيل بالمشروع أو الوحدة المقصودة، يكتب المرشّحين على الطلب ويتوقف.
-- الموظف يختار واحداً منهم (لا غيرهم)، فيعود الطلب إلى الانتظار ويُعاد تنفيذه.
create or replace function public.agent_pick_target(p_request uuid, p_target text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.agent_requests%rowtype;
begin
    if public.my_role() is null then return jsonb_build_object('ok', false, 'code', 'forbidden'); end if;
    select * into r from public.agent_requests where id = p_request for update;
    if not found or not (public.is_admin() or r.requested_by = auth.uid()) then
        return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    if r.status <> 'ready' or jsonb_array_length(r.candidates) = 0 then
        return jsonb_build_object('ok', false, 'code', 'not_waiting');
    end if;
    if not exists (select 1 from jsonb_array_elements(r.candidates) c where c->>'id' = p_target) then
        return jsonb_build_object('ok', false, 'code', 'not_a_candidate');
    end if;

    perform set_config('mulaem.agent_pick', 'on', true);
    update public.agent_requests
       set target_id = p_target, candidates = '[]', status = 'queued', stage = null,
           lease_until = null, error_ar = null
     where id = p_request;
    perform set_config('mulaem.agent_pick', 'off', true);
    return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.agent_pick_target(uuid, text) from public, anon;
grant  execute on function public.agent_pick_target(uuid, text) to authenticated;

-- ============================================================
-- (6) الاعتماد: الوحدة، وأعمدة مشروع إضافية
-- ============================================================
-- نفس ترتيب 011 حرفياً (القفل، الصلاحية، الحالة، بصمة المسودة، بصمة الهدف، الكتابة، الأثر).
-- الجديد:
--   * الوحدة: target_id = '<مشروع>/<ترتيب>' لتعديل وحدة قائمة، أو فارغ مع proposed.project_id
--     لإضافة وحدة إلى مشروع قائم. تُكتب داخل projects.details.models، والقيمة الغائبة لا تمحو.
--   * المشروع: city, district, purpose, availability, rooms, delivery_date.
--   * تعديل مشروع لا يستبدل details.models أبداً: الوحدات تُعدَّل بمسودات وحدات.
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
    -- 1) قفل المسودة. التطبيق مرة واحدة: النداء الثاني يعيد السجل نفسه ولا يكتب.
    select * into d from public.agent_drafts where id = p_draft for update;
    if not found then
        return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    if d.status = 'applied' then
        return jsonb_build_object('ok', true, 'code', 'already_applied',
                                  'record_kind', case when d.target_kind = 'unit' then 'project' else d.target_kind end,
                                  'record_id', d.applied_record);
    end if;

    -- 2) المدير وحده (و my_role() تستثني الحساب الموقوف أصلاً)
    if not public.is_admin() then
        return jsonb_build_object('ok', false, 'code', 'forbidden');
    end if;

    -- 3) لا يُعتمد إلا ما أُرسل للاعتماد
    if d.status <> 'submitted' then
        return jsonb_build_object('ok', false, 'code', 'not_submitted', 'status', d.status);
    end if;

    -- 4) بصمة ما كان المدير ينظر إليه
    if p_content_hash is null or p_content_hash <> d.content_hash then
        return jsonb_build_object('ok', false, 'code', 'stale_draft');
    end if;

    p := d.proposed;
    perform set_config('mulaem.applying', 'on', true);

    -- 5) تعديل على سجل قائم: الصف الهدف لم يتغيّر بعد بناء الفرق
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
            -- لا يُكتب شيء غير حالة المسودة نفسها: التعديل الأحدث لا يُداس عليه
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

    -- 6) الكتابة: أعمدة محدّدة لا غير، والقيمة الغائبة لا تمحو قيمة قائمة
    begin
        if d.target_kind = 'client' then
            -- الطلب العقاري المرفق بالعميل يُكتب معه في المعاملة نفسها؛ يُفحص قبل أي كتابة
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
                        nullif(btrim(coalesce(p->>'district', '')), ''),
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
                    -- الدمج لا الاستبدال، والوحدات لا تُستبدل من مسودة مشروع
                    details       = case when jsonb_typeof(p->'details') = 'object'
                                         then j.details || jsonb_strip_nulls((p->'details') - 'models')
                                         else j.details end
                where j.id = v_int;
            end if;
            v_record := v_int::text;
            v_kind   := 'project';

        elsif d.target_kind = 'unit' then
            -- حقول الوحدة المسموحة فقط، والقيم الفارغة تُسقط فلا تمحو قيمة قائمة
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
            -- السجل الناتج هو المشروع (صفحة الوحدة جزء منه)، والوحدة بترتيبها في الأثر
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

    -- 7) الأثر: قرار الاعتماد، وحالة المسودة، وسطر في سجل الأحداث
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
-- (7) إعادة الاستدعاء في الخلفية
-- ============================================================
-- كل خمس دقائق: إن وُجد طلب ينتظر أو توقف في منتصفه، يُنادى agent-run بسر المُجدوِل.
-- لا نداء إن لم يوجد شيء، فالمهمة لا تكلّف شيئاً وقت الهدوء.
-- الرابط ليس سراً (منشور في js/config.js وفي keepalive.yml).
create or replace function public.agent_cron_tick() returns void
language plpgsql security definer set search_path = public as $$
declare v_secret text;
begin
    if not exists (
        select 1 from public.agent_requests
         where status in ('queued', 'running') and (lease_until is null or lease_until < now())
    ) then
        return;
    end if;
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'agent_cron_secret';
    perform net.http_post(
        url     := 'https://niykzsspdehexphewlxa.supabase.co/functions/v1/agent-run',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-agent-cron', v_secret),
        body    := jsonb_build_object('action', 'sweep'),
        timeout_milliseconds := 5000
    );
end $$;
revoke execute on function public.agent_cron_tick() from public, anon, authenticated;

do $$
begin
    perform cron.unschedule(jobid) from cron.job where jobname = 'agent-run-sweep';
    perform cron.schedule('agent-run-sweep', '*/5 * * * *', 'select public.agent_cron_tick()');
end $$;
