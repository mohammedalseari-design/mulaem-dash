-- 036: «استوديو البروشورات» — طلب «بروشور» للمساعد: المدير يرفع بروشور المطوّر صفحاتٍ صوراً، فيقرؤها المساعد بالرؤية
-- (المشروع والنماذج ودور كل صفحة والتناقضات) ويكتب قراءته في agent_requests.result، لا مسودات ولا طابور اعتماد:
-- البروشور تصميم لا سجلٌ يدخل المخزون.
--
-- (1) نوع الطلب «brochure» مسموح، للمدير وحده (في الحارس).
-- (2) عمود result: يكتبه الخادم (مفتاح الخدمة) وحده؛ المتصفح لا يكتبه عند الإنشاء ولا بعده.
-- (3) حد المصادر: أربعون صفحة لطلب البروشور، وعشرة ملفات لغيره كما كان.
-- الحارسان كما في 035 و028 حرفاً بحرف إلا هذه المواضع. لا يتغير أي سجل قائم، وتطبيقها مرة ثانية لا يغيّر شيئاً.

alter table public.agent_requests drop constraint if exists agent_requests_kind_check;
alter table public.agent_requests add constraint agent_requests_kind_check
    check (kind in ('client', 'project', 'update', 'external', 'brochure'));

alter table public.agent_requests add column if not exists result jsonb;

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
        new.cost_usd     := null;
        new.error_ar     := null;
        new.lease_until  := null;
        new.stage        := null;
        new.candidates   := '[]';
        -- (أ) 035: هدف طلب «تحديث» من المدير يبقى إن كان مشروعاً قائماً غير محذوف. case لا and: الترتيب مضمون، فلا يصل
        -- ‎::int‎ إلى نص ليس رقماً
        if not coalesce(case when new.kind = 'update' and public.is_admin()
                                  and new.target_id ~ '^[0-9]{1,9}(/[0-9]{1,4})?$'
                             then exists (select 1 from public.projects p
                                          where p.id = split_part(new.target_id, '/', 1)::int and p.deleted_at is null)
                        end, false) then
            new.target_id := null;
        end if;
        new.ladder       := null;
        if v_role = 'callcenter' and new.kind not in ('client', 'project') then
            raise exception 'مركز الاتصال ينشئ طلبات العملاء والعروض فقط';
        end if;
        if new.kind = 'external' and not public.is_admin() then
            raise exception 'الاستيراد من مصدر خارجي للمدير فقط';
        end if;
        -- (أ) 036: قراءة بروشور المطوّر للمدير وحده، ونتيجتها يكتبها الخادم وحده
        if new.kind = 'brochure' and not public.is_admin() then
            raise exception 'قراءة البروشور للمدير فقط';
        end if;
        new.result       := null;
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
    new.cost_usd    := old.cost_usd;
    new.lease_until := old.lease_until;
    new.stage       := old.stage;
    new.candidates  := old.candidates;
    new.target_id   := old.target_id;
    new.ladder      := old.ladder;
    new.result      := old.result;   -- (ب) 036
    if new.status is distinct from old.status then
        -- (ب) 035: وما ينتظر اختيار المرشّح يُلغى أيضاً
        if new.status <> 'cancelled' or not (old.status in ('queued', 'running')
               or (old.status = 'ready' and jsonb_typeof(old.candidates) = 'array' and jsonb_array_length(old.candidates) > 0)) then
            raise exception 'حالة الطلب يحددها الخادم';
        end if;
    end if;
    if new.status <> 'cancelled' then new.error_ar := old.error_ar; end if;
    if old.status <> 'queued' then
        new.instruction := old.instruction;
        new.title       := old.title;
        new.effort_hint := old.effort_hint;
    end if;
    return new;
end $$;
revoke execute on function public.agent_requests_guard() from public, anon, authenticated;

create or replace function public.agent_sources_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_status text; v_kind text; v_count int; v_max int;
begin
    if tg_op = 'UPDATE' then
        new.request_id := old.request_id;
        new.created_at := old.created_at;
    end if;

    select status, kind into v_status, v_kind from public.agent_requests where id = new.request_id;
    if v_status is null then raise exception 'الطلب غير موجود'; end if;

    if tg_op = 'INSERT' then
        select count(*) into v_count from public.agent_sources where request_id = new.request_id;
        -- 036: البروشور صفحاتٌ صوراً، حتى أربعين صفحة؛ وغيره عشرة ملفات كما كان
        v_max := case when v_kind = 'brochure' then 40 else 10 end;
        if v_count >= v_max then
            raise exception '%', case when v_kind = 'brochure' then 'حد صفحات البروشور أربعون صفحة' else 'حد المرفقات عشرة ملفات للطلب الواحد' end;
        end if;
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
        -- من المتصفح: الرابط فقط؛ ما يخص القراءة تكتبه وظيفة الاستخراج وحدها (بلا هوية مستخدم)
        if auth.uid() is not null then
            new.storage_path := null; new.bytes := null; new.pages := null; new.sha256 := null;
            new.title := null; new.fetched_at := null; new.fetch_error := null;
        end if;
    elsif new.storage_path is null then
        raise exception 'مسار الملف مطلوب';
    end if;
    -- المسار داخل المخزن يبدأ دائماً بمعرّف الطلب، وهو ما تعتمد عليه سياسات المخزن
    if new.storage_path is not null and new.storage_path !~ ('^' || new.request_id::text || '/') then
        raise exception 'مسار الملف لا يخص هذا الطلب';
    end if;
    return new;
end $$;
revoke execute on function public.agent_sources_guard() from public, anon, authenticated;
