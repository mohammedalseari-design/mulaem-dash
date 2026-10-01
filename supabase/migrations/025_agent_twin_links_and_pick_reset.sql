-- 025_agent_twin_links_and_pick_reset — ربط المسودات التوائم ذرّياً، واختيار الهدف لا يُحسب محاولة.
-- طُبّقت على المشروع الحي في 2 أكتوبر 2026 باسم agent_twin_links_and_pick_reset، قبل نشر agent-run الذي يناديها.
-- وظيفةٌ نُشرت قبلها لا تجد agent_link_twin و agent_unlink_twin فتعود إلى القراءة ثم الكتابة، فلا يتعطل شيء أياً كان الترتيب.
--
-- ما يضيفه:
--   * agent_link_twin: سطر توأم يُلحق بمكرّرات مسودة في UPDATE واحد، ما لم تذكر المسودة مسودته (draft_id).
--     كانت agent-run تقرأ المكرّرات ثم تكتبها كاملة: تشغيلان متزامنان (دفعة عروض من واتساب) يقرأ كلاهما القائمة
--     قبل أن يكتب الآخر، فيمحو الثاني سطر الأول — في مكرّرات التوأم الأقدم، وفي مكرّرات المسودة الجديدة نفسها حين
--     يُعاد فحصها بعد الحفظ.
--   * agent_unlink_twin: يحذف سطر توأم (kind = 'draft') بمعرّف مسودته ويبقي باقي المكرّرات. تناديها agent-run حين
--     تُعاد مطابقة مسودة بعد تعديل مقترحها (recheck_twins): توأمٌ لم يعد يطابق يُفكّ، وسطرٌ تغيّر اسمه أو سببه يُفكّ
--     ثم يُلحق من جديد. وتنفع للصيانة، مثل إزالة مسودة اختبار من مكرّرات مسودات حقيقية بدل تصفير قوائمها.
--   * agent_pick_target كما في 020، ويصفّر المحاولات وموضع السلّم حين يُختار الهدف.

-- ============================================================
-- (1) التوائم: إلحاق وحذف ذرّيان (service_role فقط)
-- ============================================================
-- الشرط والكتابة عبارة واحدة: نداءان متزامنان على المسودة نفسها، الثاني ينتظر قفل الصف، ثم يعيد Postgres تقييم
-- شرطه وقيمته الجديدة على الصف كما تركه الأول (Read Committed)، فلا يضيع سطر ولا يتكرر.
--
-- حارس المسودات (agent_drafts_guard، 020) يمرّر هذه الكتابة كما يمرّر كتابات agent-run كلها: مفتاح الخدمة بلا هوية
-- مستخدم، و security definer لا يغيّر auth.uid() (تُقرأ من ادعاءات JWT للطلب لا من دور التنفيذ)، فيعود الحارس بالصف
-- بعد أن يعيد حساب content_hash ويحدّث updated_at. البصمة من proposed و evidence وحدهما، فسطر توأم لا يُبطل اعتماداً
-- يجري على المسودة. ولو نادى الدالةَ مستخدمٌ (والتنفيذ مسحوب منه) لأبقى الحارس المكرّرات على قيمتها القديمة أو رفض الكتابة.
--
-- المكرّرات قائمة دائماً (default '[]')؛ ما ليس قائمة يُعدّ فارغاً كما في agent-run، بلا خطأ.
create or replace function public.agent_link_twin(p_draft uuid, p_entry jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
begin
    -- سطر توأم فقط: كائن بنوع draft ومعرّف مسودة
    if jsonb_typeof(p_entry) is distinct from 'object' or p_entry->>'kind' is distinct from 'draft'
       or coalesce(p_entry->>'draft_id', '') = '' then
        return false;
    end if;
    update public.agent_drafts d
       set duplicates = (case when jsonb_typeof(d.duplicates) = 'array' then d.duplicates else '[]'::jsonb end)
                        || jsonb_build_array(p_entry)
     where d.id = p_draft
       and not exists (
           select 1
             from jsonb_array_elements(case when jsonb_typeof(d.duplicates) = 'array' then d.duplicates else '[]'::jsonb end) e
            where e->>'draft_id' = p_entry->>'draft_id');
    return found;
end $$;
revoke execute on function public.agent_link_twin(uuid, jsonb) from public, anon, authenticated;
grant  execute on function public.agent_link_twin(uuid, jsonb) to service_role;

-- الشرط نفسه بالعكس: لا كتابة إلا إن وُجد السطر، وما سواه يبقى بترتيبه
create or replace function public.agent_unlink_twin(p_draft uuid, p_twin_draft text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
    if coalesce(p_twin_draft, '') = '' then return false; end if;
    update public.agent_drafts d
       set duplicates = (
               select coalesce(jsonb_agg(x.e order by x.n), '[]'::jsonb)
                 from jsonb_array_elements(d.duplicates) with ordinality as x(e, n)
                where (x.e->>'kind' = 'draft' and x.e->>'draft_id' = p_twin_draft) is not true)
     where d.id = p_draft
       and exists (
           select 1
             from jsonb_array_elements(case when jsonb_typeof(d.duplicates) = 'array' then d.duplicates else '[]'::jsonb end) e
            where e->>'kind' = 'draft' and e->>'draft_id' = p_twin_draft);
    return found;
end $$;
revoke execute on function public.agent_unlink_twin(uuid, text) from public, anon, authenticated;
grant  execute on function public.agent_unlink_twin(uuid, text) to service_role;

-- ============================================================
-- (2) اختيار الهدف لا يُحسب محاولة
-- ============================================================
-- كما في 020 حرفياً، مع attempts = 0 و ladder = null. المحاولات سقفٌ لأعطال التنفيذ: agent_claim_request يزيدها مع
-- كل حجز، و agent_pending_requests يُفشل الطلب عند السقف (3 في agent-run). سؤال الموظف عن الهدف ليس عطلاً لكنه كان
-- يُحسب: تحديثٌ يسأل مرتين (المشروع ثم الوحدة) مع إعادة واحدة لمهلة أو انقطاع يبلغ السقف، فيُغلق الطلب «بعد 3 محاولات»
-- حالما يختار الموظف، بلا أي نداء. بعد الاختيار يبدأ الطلب محاولاته من جديد.
-- لا تصفير بلا سؤال: الخادم وحده يكتب المرشّحين بعد نداء نجح، والاختيار يمسحهم. التكلفة (tokens_used و cost_usd) تبقى
-- مجموع الطلب كله، وسقف الإنفاق اليومي يبقى الحد الأعلى.
-- موضع السلّم يُمسح أصلاً حين يُسأل الموظف (finish في agent-run لا يبقيه إلا مع العودة إلى الانتظار)؛ مسحه هنا يضمن أن
-- التنفيذ بعد الاختيار يبدأ السلّم من أوله.
-- حارس الطلبات (023) يمرّر التصفير: علَم mulaem.agent_pick يعيد الصف قبل أن يثبّت attempts و ladder على قيمتيهما القديمتين.
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
           lease_until = null, error_ar = null, attempts = 0, ladder = null
     where id = p_request;
    perform set_config('mulaem.agent_pick', 'off', true);
    return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.agent_pick_target(uuid, text) from public, anon;
grant  execute on function public.agent_pick_target(uuid, text) to authenticated;
