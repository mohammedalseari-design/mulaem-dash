-- 011_agent_core — الجولة A من مهمة وكيل الاستيراد (ملف المهمة docs/TASK_AGENT.md)
-- طُبّقت على المشروع الحي بتاريخ 2026-09-18 باسم agent_core
--
-- الفكرة: الوكيل يقترح، والمدير يعتمد، وقاعدة البيانات وحدها تكتب.
--   * لا أحد يكتب في projects / clients / client_requirements انطلاقاً من مسودة إلا
--     public.agent_apply_draft — دالة security definer في معاملة واحدة.
--   * content_hash يحسبه مشغّل قبل الحفظ ولا يُقبل من المتصفح، فأي تعديل على المقترح
--     يُبطل اعتماداً سابقاً بحكم البناء لا بحكم النية.
--   * baseline_hash يمنع الكتابة فوق تعديل أحدث: إن تغيّر الصف الهدف بعد بناء الفرق
--     تُعاد الحالة record_changed ولا يُكتب شيء.
--   * المرفقات في مخزن خاص (agent-sources) لا عام، والقراءة بروابط موقّعة قصيرة العمر.
--
-- في هذه الجولة لا يوجد استخراج آلي بعد: الجدولة (pg_cron) تُفعَّل هنا، ووظيفة
-- agent-run ومهمّة إعادة الاستدعاء تأتيان في الجولة B مع مفتاح Anthropic.

-- ============================================================
-- (0) الامتدادات المطلوبة للعمل في الخلفية
-- ============================================================
-- pg_net: استدعاء HTTP غير متزامن من داخل القاعدة. pg_cron: جدولة إعادة استدعاء
-- الطلبات المعلّقة. الاثنان متاحان على المشروع وغير مثبّتين، وتثبيتهما هنا حتى لا
-- تنتظر الجولة B تغييراً في البنية.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- ============================================================
-- (1) الجداول
-- ============================================================

-- طلب واحد من الموظف: تعليمات بالعربية + مصادر. الحالة يحددها الخادم لا المتصفح.
create table if not exists public.agent_requests (
    id           uuid primary key default gen_random_uuid(),
    kind         text not null check (kind in ('client', 'project', 'update', 'external')),
    title        text,
    instruction  text not null,
    status       text not null default 'queued'
                 check (status in ('queued', 'running', 'ready', 'failed', 'cancelled')),
    error_ar     text,
    requested_by uuid references public.profiles(id),
    lease_until  timestamptz,
    attempts     int not null default 0,
    tokens_used  int,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);
create index if not exists agent_requests_owner_idx on public.agent_requests (requested_by, created_at desc);

-- المصادر: نص ملصوق أو ملف في المخزن الخاص أو رابط. النص الملصوق يُرفع ملفاً
-- نصياً في نفس المخزن، فلا يوجد مسار ثانٍ لقراءة المصدر ولا صلاحية ثانية تُضبط.
create table if not exists public.agent_sources (
    id           uuid primary key default gen_random_uuid(),
    request_id   uuid not null references public.agent_requests(id) on delete cascade,
    kind         text not null check (kind in ('text', 'pdf', 'image', 'sheet', 'url')),
    storage_path text,
    url          text,
    bytes        int,
    pages        int,
    sha256       text,
    created_at   timestamptz not null default now()
);
create index if not exists agent_sources_request_idx on public.agent_sources (request_id, created_at);

-- المسودة: السجل المقترح كاملاً + دليل كل حقل + ما لم يذكره المصدر + التعارضات + المكرّرات.
create table if not exists public.agent_drafts (
    id             uuid primary key default gen_random_uuid(),
    request_id     uuid not null references public.agent_requests(id) on delete cascade,
    target_kind    text not null check (target_kind in ('project', 'unit', 'client', 'requirement')),
    target_id      text,                                  -- فارغ = سجل جديد
    proposed       jsonb not null,
    evidence       jsonb not null default '{}',           -- حقل -> {quote, page, source_id}
    missing        text[] not null default '{}',
    conflicts      jsonb not null default '[]',
    duplicates     jsonb not null default '[]',
    baseline_hash  text,                                  -- md5 للصف الهدف لحظة بناء الفرق
    content_hash   text not null default '',              -- يحسبه المشغّل، ولا يُقبل من المتصفح
    status         text not null default 'draft'
                   check (status in ('draft', 'submitted', 'approved', 'rejected', 'returned', 'applied', 'stale')),
    applied_record text,
    created_by     uuid references public.profiles(id),
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);
create index if not exists agent_drafts_request_idx on public.agent_drafts (request_id);
create index if not exists agent_drafts_status_idx  on public.agent_drafts (status);
create index if not exists agent_drafts_creator_idx on public.agent_drafts (created_by);

-- القرارات: إلحاق فقط. content_hash هو ما كان الفاعل ينظر إليه لحظة قراره.
create table if not exists public.agent_decisions (
    id           uuid primary key default gen_random_uuid(),
    draft_id     uuid not null references public.agent_drafts(id) on delete cascade,
    decision     text not null check (decision in ('submit', 'approve', 'reject', 'return', 'edit')),
    reason       text,
    content_hash text not null,
    actor_id     uuid references public.profiles(id),
    created_at   timestamptz not null default now()
);
create index if not exists agent_decisions_draft_idx on public.agent_decisions (draft_id, created_at);
create index if not exists agent_decisions_actor_idx on public.agent_decisions (actor_id);

-- crm_events: نوع كيان جديد للوكيل (السجل المالي والملاحظات لا تصلح لهذا)
alter table public.crm_events drop constraint if exists crm_events_entity_type_check;
alter table public.crm_events add constraint crm_events_entity_type_check
    check (entity_type in ('client', 'requirement', 'match', 'follow_up', 'property', 'note',
                           'deal', 'commission', 'agent'));

-- ============================================================
-- (2) المشغّلات: الخادم يحدد المالك والحالة والبصمة
-- ============================================================

create or replace function public.agent_requests_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_role text;
begin
    new.instruction := btrim(new.instruction);
    if new.instruction = '' then raise exception 'التعليمات مطلوبة'; end if;

    if tg_op = 'UPDATE' then
        new.updated_at   := now();
        new.created_at   := old.created_at;
        new.requested_by := old.requested_by;
        new.kind         := old.kind;
    end if;

    -- مفتاح الخدمة (وظيفة الاستخراج) أو صيانة من لوحة Supabase: لا هوية مستخدم
    if v_uid is null then return new; end if;

    v_role := public.my_role();
    if v_role is null then raise exception 'غير مصرح'; end if;

    if tg_op = 'INSERT' then
        new.requested_by := v_uid;
        new.status       := 'queued';
        new.attempts     := 0;
        new.tokens_used  := null;
        new.error_ar     := null;
        new.lease_until  := null;
        if v_role = 'callcenter' and new.kind <> 'client' then
            raise exception 'مركز الاتصال ينشئ طلبات العملاء فقط';
        end if;
        if new.kind = 'external' and not public.is_admin() then
            raise exception 'الاستيراد من مصدر خارجي للمدير فقط';
        end if;
        return new;
    end if;

    -- حالة التنفيذ يكتبها الخادم؛ المستخدم لا يملك إلا الإلغاء
    new.attempts    := old.attempts;
    new.tokens_used := old.tokens_used;
    new.lease_until := old.lease_until;
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
drop trigger if exists agent_requests_guard on public.agent_requests;
create trigger agent_requests_guard before insert or update on public.agent_requests
for each row execute function public.agent_requests_guard();

-- حدود المرفقات مفروضة هنا أيضاً لا في المتصفح وحده:
-- عشرة ملفات للطلب، عشرة ميغابايت للملف، عشرون صفحة للـPDF.
-- (عدد الصفحات في هذه الجولة رقم يصرّح به المتصفح؛ التحقق الفعلي منه يقع عند
--  قراءة الملف في وظيفة الاستخراج — الجولة B.)
create or replace function public.agent_sources_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_status text; v_count int;
begin
    if tg_op = 'UPDATE' then
        new.request_id := old.request_id;
        new.created_at := old.created_at;
    end if;

    select status into v_status from public.agent_requests where id = new.request_id;
    if v_status is null then raise exception 'الطلب غير موجود'; end if;

    if tg_op = 'INSERT' then
        select count(*) into v_count from public.agent_sources where request_id = new.request_id;
        if v_count >= 10 then raise exception 'حد المرفقات عشرة ملفات للطلب الواحد'; end if;
        if auth.uid() is not null and v_status <> 'queued' then
            raise exception 'لا تُضاف مرفقات بعد بدء تنفيذ الطلب';
        end if;
    end if;

    if new.bytes is not null and new.bytes > 10485760 then
        raise exception 'حجم الملف يتجاوز عشرة ميغابايت';
    end if;
    if new.pages is not null and new.pages > 20 then
        raise exception 'عدد صفحات الملف يتجاوز عشرين صفحة';
    end if;

    if new.kind = 'url' then
        if new.url is null or new.url !~ '^https?://' then raise exception 'رابط غير صالح'; end if;
        new.storage_path := null;
    else
        if new.storage_path is null then raise exception 'مسار الملف مطلوب'; end if;
        -- المسار داخل المخزن يبدأ دائماً بمعرّف الطلب، وهو ما تعتمد عليه سياسات المخزن
        if new.storage_path !~ ('^' || new.request_id::text || '/') then
            raise exception 'مسار الملف لا يخص هذا الطلب';
        end if;
    end if;
    return new;
end $$;
revoke execute on function public.agent_sources_guard() from public, anon, authenticated;
drop trigger if exists agent_sources_guard on public.agent_sources;
create trigger agent_sources_guard before insert or update on public.agent_sources
for each row execute function public.agent_sources_guard();

-- بصمة المحتوى ودورة حياة المسودة.
-- الاعتماد والتطبيق لا يمرّان من هنا إلا بعلَم mulaem.applying الذي لا تضعه إلا
-- دالة agent_apply_draft، فلا يوجد طريق من PostgREST إلى الحالتين.
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

    -- المحتوى يُعدَّل وهي مسودة أو مُعادة للموظف، لا بعد إرسالها للاعتماد
    if old.status not in ('draft', 'returned') then
        new.proposed      := old.proposed;
        new.evidence      := old.evidence;
        new.missing       := old.missing;
        new.conflicts     := old.conflicts;
        new.duplicates    := old.duplicates;
        new.baseline_hash := old.baseline_hash;
        new.content_hash  := old.content_hash;
    end if;
    new.applied_record := old.applied_record;
    return new;
end $$;
revoke execute on function public.agent_drafts_guard() from public, anon, authenticated;
drop trigger if exists agent_drafts_guard on public.agent_drafts;
create trigger agent_drafts_guard before insert or update on public.agent_drafts
for each row execute function public.agent_drafts_guard();

create or replace function public.agent_decisions_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    new.actor_id   := coalesce(auth.uid(), new.actor_id);
    new.created_at := now();
    return new;
end $$;
revoke execute on function public.agent_decisions_guard() from public, anon, authenticated;
drop trigger if exists agent_decisions_guard on public.agent_decisions;
create trigger agent_decisions_guard before insert on public.agent_decisions
for each row execute function public.agent_decisions_guard();

-- ============================================================
-- (3) الرؤية
-- ============================================================
-- دالة security definer حتى لا تتكرر سياسة agent_requests داخل سياسات الجداول
-- التابعة (ولا تُقرأ صفوف الطلبات مرتين لكل صف تابع).
create or replace function public.agent_can_see_request(p_request uuid) returns boolean
language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from public.agent_requests r
        where r.id = p_request
          and (public.is_admin() or r.requested_by = (select auth.uid()))
    )
$$;
revoke execute on function public.agent_can_see_request(uuid) from public, anon;
grant  execute on function public.agent_can_see_request(uuid) to authenticated;

create or replace function public.agent_can_see_draft(p_draft uuid) returns boolean
language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from public.agent_drafts d
        where d.id = p_draft
          and (public.is_admin() or d.created_by = (select auth.uid())
               or public.agent_can_see_request(d.request_id))
    )
$$;
revoke execute on function public.agent_can_see_draft(uuid) from public, anon;
grant  execute on function public.agent_can_see_draft(uuid) to authenticated;

-- سياسات المخزن تتعامل مع أول جزء من المسار كنص؛ التحويل إلى uuid قد يفشل،
-- وفشله يجب أن يعني "لا" لا خطأ يوقف الاستعلام.
create or replace function public.agent_request_key_visible(p_key text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
    begin v := p_key::uuid; exception when others then return false; end;
    return public.agent_can_see_request(v);
end $$;
revoke execute on function public.agent_request_key_visible(text) from public, anon;
grant  execute on function public.agent_request_key_visible(text) to authenticated;

create or replace function public.agent_request_key_owned(p_key text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
    begin v := p_key::uuid; exception when others then return false; end;
    return exists (
        select 1 from public.agent_requests r
        where r.id = v and r.requested_by = auth.uid() and r.status = 'queued'
    );
end $$;
revoke execute on function public.agent_request_key_owned(text) from public, anon;
grant  execute on function public.agent_request_key_owned(text) to authenticated;

-- ============================================================
-- (4) الصلاحيات (RLS)
-- ============================================================

alter table public.agent_requests  enable row level security;
alter table public.agent_sources   enable row level security;
alter table public.agent_drafts    enable row level security;
alter table public.agent_decisions enable row level security;

revoke all on public.agent_requests, public.agent_sources, public.agent_drafts, public.agent_decisions from anon;
grant select, insert, update, delete on public.agent_requests  to authenticated;
grant select, insert, delete         on public.agent_sources   to authenticated;
grant select, insert, update         on public.agent_drafts    to authenticated;
grant select, insert                 on public.agent_decisions to authenticated;

-- الطلبات
drop policy if exists agent_requests_select on public.agent_requests;
create policy agent_requests_select on public.agent_requests for select to authenticated
using (public.is_admin() or requested_by = (select auth.uid()));

drop policy if exists agent_requests_insert on public.agent_requests;
create policy agent_requests_insert on public.agent_requests for insert to authenticated
with check (public.my_role() is not null);

drop policy if exists agent_requests_update on public.agent_requests;
create policy agent_requests_update on public.agent_requests for update to authenticated
using (public.is_admin() or requested_by = (select auth.uid()))
with check (public.is_admin() or requested_by = (select auth.uid()));

-- الحذف لا يمحو أثراً: صاحب الطلب يحذفه ما دام في الانتظار ولا مسودة عليه، وما عدا ذلك للمدير.
drop policy if exists agent_requests_delete on public.agent_requests;
create policy agent_requests_delete on public.agent_requests for delete to authenticated
using (
    public.is_admin()
    or (
        requested_by = (select auth.uid()) and status = 'queued'
        and not exists (select 1 from public.agent_drafts d where d.request_id = public.agent_requests.id)
    )
);

-- المصادر: عبر رؤية الطلب
drop policy if exists agent_sources_select on public.agent_sources;
create policy agent_sources_select on public.agent_sources for select to authenticated
using (public.agent_can_see_request(request_id));

drop policy if exists agent_sources_insert on public.agent_sources;
create policy agent_sources_insert on public.agent_sources for insert to authenticated
with check (public.my_role() is not null and public.agent_can_see_request(request_id));

drop policy if exists agent_sources_delete on public.agent_sources;
create policy agent_sources_delete on public.agent_sources for delete to authenticated
using (public.agent_can_see_request(request_id));

-- المسودات: المنشئ وصاحب الطلب والمدير. الحالات والحقول يحرسها المشغّل أعلاه.
drop policy if exists agent_drafts_select on public.agent_drafts;
create policy agent_drafts_select on public.agent_drafts for select to authenticated
using (public.is_admin() or created_by = (select auth.uid()) or public.agent_can_see_request(request_id));

drop policy if exists agent_drafts_insert on public.agent_drafts;
create policy agent_drafts_insert on public.agent_drafts for insert to authenticated
with check (public.my_role() is not null and public.agent_can_see_request(request_id));

drop policy if exists agent_drafts_update on public.agent_drafts;
create policy agent_drafts_update on public.agent_drafts for update to authenticated
using (public.is_admin() or created_by = (select auth.uid()) or public.agent_can_see_request(request_id))
with check (public.is_admin() or created_by = (select auth.uid()) or public.agent_can_see_request(request_id));

-- القرارات: إلحاق فقط، والاعتماد والرفض والإعادة للمدير وحده
drop policy if exists agent_decisions_select on public.agent_decisions;
create policy agent_decisions_select on public.agent_decisions for select to authenticated
using (public.agent_can_see_draft(draft_id));

drop policy if exists agent_decisions_insert on public.agent_decisions;
create policy agent_decisions_insert on public.agent_decisions for insert to authenticated
with check (
    public.my_role() is not null
    and public.agent_can_see_draft(draft_id)
    and (decision in ('submit', 'edit') or public.is_admin())
);

-- ============================================================
-- (5) المخزن الخاص agent-sources
-- ============================================================
-- ليس project-images: هذا مخزن غير عام، ولا يُقرأ إلا برابط موقّع قصير العمر
-- يصدره المخزن لمن تسمح له سياسة القراءة أدناه.
-- الواجهة ترسل نوع المحتوى صراحةً مشتقاً من الامتداد، فلا يرفض المخزن ملفاً سليماً
-- لأن نظام التشغيل سمّاه application/octet-stream.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('agent-sources', 'agent-sources', false, 10485760, array[
    'application/pdf',
    'image/png', 'image/jpeg', 'image/webp',
    'text/plain', 'text/plain;charset=utf-8', 'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists agent_sources_upload on storage.objects;
create policy agent_sources_upload on storage.objects for insert to authenticated
with check (
    bucket_id = 'agent-sources'
    and public.my_role() is not null
    and public.agent_request_key_owned((storage.foldername(name))[1])
);

drop policy if exists agent_sources_read on storage.objects;
create policy agent_sources_read on storage.objects for select to authenticated
using (
    bucket_id = 'agent-sources'
    and public.agent_request_key_visible((storage.foldername(name))[1])
);

drop policy if exists agent_sources_remove on storage.objects;
create policy agent_sources_remove on storage.objects for delete to authenticated
using (
    bucket_id = 'agent-sources'
    and (public.is_admin() or public.agent_request_key_owned((storage.foldername(name))[1]))
);

-- ============================================================
-- (6) الاعتماد: الطريق الوحيد من مسودة إلى سجل
-- ============================================================
-- ترتيب التحققات مقصود: القفل، ثم الصلاحية، ثم الحالة، ثم بصمة ما رآه المعتمِد،
-- ثم بصمة الصف الهدف. الأخطاء ترجع برمز ثابت تترجمه الواجهة، ولا يخرج منها نص SQL.
create or replace function public.agent_apply_draft(p_draft uuid, p_content_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    d           public.agent_drafts%rowtype;
    p           jsonb;
    v_now_hash  text;
    v_record    text;
    v_client    uuid;
    v_uuid      uuid;
    v_int       int;
    v_districts text[];
begin
    -- 1) قفل المسودة. التطبيق مرة واحدة: النداء الثاني يعيد السجل نفسه ولا يكتب.
    select * into d from public.agent_drafts where id = p_draft for update;
    if not found then
        return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    if d.status = 'applied' then
        return jsonb_build_object('ok', true, 'code', 'already_applied',
                                  'record_kind', d.target_kind, 'record_id', d.applied_record);
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
                    else (select to_jsonb(t) from public.projects t where t.id = v_int)
                end);
        end if;
    elsif d.target_kind = 'unit' then
        -- الوحدة تعيش داخل projects.details وليست جدولاً؛ تطبيقها يأتي مع الجولة B
        perform set_config('mulaem.applying', 'off', true);
        return jsonb_build_object('ok', false, 'code', 'unsupported_target', 'target_kind', d.target_kind);
    end if;

    -- 6) الكتابة: أعمدة محدّدة لا غير، والقيمة الغائبة لا تمحو قيمة قائمة
    begin
        if d.target_kind = 'client' then
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

        elsif d.target_kind = 'project' then
            if d.target_id is null then
                if coalesce(btrim(p->>'name'), '') = '' then
                    perform set_config('mulaem.applying', 'off', true);
                    return jsonb_build_object('ok', false, 'code', 'missing_required');
                end if;
                insert into public.projects (name, type, price, area, address, latitude, longitude, notes, details)
                values (btrim(p->>'name'), nullif(btrim(coalesce(p->>'type', '')), ''),
                        (p->>'price')::numeric, (p->>'area')::numeric,
                        nullif(btrim(coalesce(p->>'address', '')), ''),
                        (p->>'latitude')::double precision, (p->>'longitude')::double precision,
                        nullif(btrim(coalesce(p->>'notes', '')), ''),
                        case when jsonb_typeof(p->'details') = 'object' then p->'details' else '{}'::jsonb end)
                returning id into v_int;
            else
                update public.projects j set
                    name      = coalesce(nullif(btrim(coalesce(p->>'name', '')), ''), j.name),
                    type      = coalesce(nullif(btrim(coalesce(p->>'type', '')), ''), j.type),
                    price     = coalesce((p->>'price')::numeric, j.price),
                    area      = coalesce((p->>'area')::numeric, j.area),
                    address   = coalesce(nullif(btrim(coalesce(p->>'address', '')), ''), j.address),
                    latitude  = coalesce((p->>'latitude')::double precision, j.latitude),
                    longitude = coalesce((p->>'longitude')::double precision, j.longitude),
                    notes     = coalesce(nullif(btrim(coalesce(p->>'notes', '')), ''), j.notes),
                    -- الدمج لا الاستبدال: ما لم يذكره المصدر يبقى كما هو
                    details   = case when jsonb_typeof(p->'details') = 'object' then j.details || (p->'details') else j.details end
                where j.id = v_int;
            end if;
            v_record := v_int::text;

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
       set status = 'applied', applied_record = v_record
     where id = d.id;

    insert into public.crm_events (client_id, entity_type, entity_id, event_type, payload, actor_id)
    values (v_client, 'agent', d.id::text, 'agent_draft_applied',
            jsonb_build_object(
                'request_id',   d.request_id,
                'target_kind',  d.target_kind,
                'record_id',    v_record,
                'is_new',       d.target_id is null,
                'created_by',   d.created_by,
                'content_hash', d.content_hash,
                'fields',       (select coalesce(jsonb_agg(k order by k), '[]'::jsonb) from jsonb_object_keys(p) k)),
            auth.uid());

    perform set_config('mulaem.applying', 'off', true);
    return jsonb_build_object('ok', true, 'code', 'applied', 'record_kind', d.target_kind, 'record_id', v_record);
end $$;
revoke execute on function public.agent_apply_draft(uuid, text) from public, anon;
grant  execute on function public.agent_apply_draft(uuid, text) to authenticated;
