-- 033: مركز الاتصال يضيف عروض المشاريع أيضاً عبر المساعد (قرار المالك 2026-10-11)، لا العملاء وحدهم.
-- الحارس نفسه كما في 023 حرفاً بحرف، والتغيير الوحيد: callcenter يُسمح له kind = 'client' أو 'project'.
-- الاعتماد يبقى للمدير وحده (agent_apply_draft). تطبيقها مرة ثانية لا يغيّر شيئاً.

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
        new.target_id    := null;
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
        if new.status <> 'cancelled' or old.status not in ('queued', 'running') then
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

revoke execute on function public.agent_requests_guard() from public, anon, authenticated;
