-- 035: طلب «تحديث مشروع أو وحدة» يُنشأ لمشروع بعينه، والطلب الذي ينتظر اختياراً يُلغى (مراجعة مسار المساعد 2026-10-24،
-- التحسين ١: منشورات المشاريع القائمة كانت كلها تُرسل «مشروعاً جديداً» فتتوقف بلا مسودة أو تصير مسودة مكررة).
--
-- الحارس نفسه كما في 033 حرفاً بحرف، والتغيير في موضعين:
--   (أ) عند الإنشاء: طلب «تحديث» ينشئه المدير يبقى هدفه (target_id) إن كان مشروعاً قائماً غير محذوف، بصيغة «رقم» أو
--       «رقم/ترتيب الوحدة» كما يكتبها agent_pick_target. فيبني الخادم مسودة التحديث على ذلك المشروع بلا تخمين بالاسم:
--       agent-run يقرأ target_id كما يقرؤه بعد اختيار المرشّح (buildUpdateDrafts)، فلا تتغير الوظيفة. أي هدف غير ذلك،
--       أو من غير المدير، أو لنوع آخر، يُفرَّغ كما كان.
--   (ب) الإلغاء: صاحب الطلب أو المدير يلغي أيضاً طلباً «جاهزاً» ينتظر اختيار المرشّح (candidates غير فارغة، ولا مسودة
--       تُبنى قبل الاختيار)، حين يُحوَّل إلى طلب «تحديث» بدل اختيار «أنشئه مشروعاً جديداً».
-- الهدف لا يكتب شيئاً بنفسه: المسودة تنتظر اعتماد المدير، وagent_apply_draft يتحقق من بصمة السجل الهدف.
-- تطبيقها مرة ثانية لا يغيّر شيئاً.

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
