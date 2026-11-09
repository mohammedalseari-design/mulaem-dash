-- 043: تحويل العميل لوسيط وحذف العميل، والاثنان للمدير وحده
--
-- قرار المالك 2026-11-10: «ابغا خاصية حذف العميل»، «ابغا العميل اقدر احوله للوسيط من المدير»، «الحذف فقط للمدير».
--
-- من يرى العميل بعد هذا الملف: المدير، وصاحبه (owner_id)، ومن عليه شغل جارٍ فيه (صفقة جارية وسيطها هو، أو متابعة معلّقة مكلّف
-- بها)، ومركز الاتصال فيما أدخله، ومن أدخله ما دام غير مسند. كان الموظف يرى أيضاً كل عميل أدخله ولو صار لغيره، فيبقى الوسيط
-- القديم يرى العميل بعد تحويله. «الشغل الجاري» يحفظ ما كان: الوسيط الذي أسند له المدير صفقة أو متابعة على عميل غيره يراه
-- ليعمل عليها، والوسيط الذي نُقل عميله قبل هذا الملف وبقيت عنده صفقته الجارية يبقى يراه حتى تُغلق أو تُنقل.
--
-- ما يضيفه:
--   * public.crm_works_on_client(p_client): هل على المستخدم شغل جارٍ في العميل. تقرؤها قواعد الرؤية أدناه.
--   * public.transfer_client(p_client, p_to): المدير وحده، والوسيط الجديد دوره field وغير موقوف. في معاملة واحدة ينتقل:
--     العميل، وطلباته المفتوحة، وما عند صاحبه الحالي من متابعات معلّقة وصفقات جارية (وإن كان غير مسند: عند الوسيط الذي أدخله)،
--     ومعها ما لا صاحب له وما بقي على وسيط معطّل. ما أسنده المدير أو مركز الاتصال لموظف آخر يبقى عنده. الطلبات المغلقة والمتابعات
--     المنتهية والصفقات المغلقة («تمت» و«خسرت») تبقى باسم من عمل عليها: أداؤه وعمولته في v_broker_performance.
--     وتُوقف روابط مشاركة العميل القديمة (012، الميزة متوقفة في الموقع أصلاً) فلا يفتحها من أنشأها بعد خروج العميل من عنده،
--     ولا يعدّل منشئ الرابط رابطه إلا ما دام يرى عميله (client_share_links_update)، فلا يعيد فتح رابط أوقفه التحويل.
--     الحدث client_reassigned يكتبه clients_log كما كان. يعيد أعداد ما انتقل.
--   * public.delete_client(p_client): المدير وحده. يرفض عميلاً له صفقة: deals بلا حذف متتابع، وفيها العمولات وسجل المراحل.
--     يحذف العميل، ومعه بالقيود القائمة طلباته ومطابقاتها ومتابعاته وروابط مشاركته وسجله. ويكتب في crm_events حدث
--     client_deleted بلا client_id وبلا اسم ولا رقم: من حذف، ومتى، ومعرّف العميل، وكم طلباً ومتابعة حُذفت معه.
--     لا يمس سجل المساعد (agent_*): ما فيه من رسائل ومسودات ذكرت العميل يبقى كما هو.
--   * قواعد الرؤية: clients_select وcrm_can_see_client بالقاعدة أعلاه. deals_select وcrm_can_see_deal: منشئ الصفقة يقرؤها ولو جعل
--     المدير وسيطها غيره، كما كان، ما دام يرى عميلها. follow_ups_select وfollow_ups_update: منشئ المتابعة يراها ويعدّلها كما كان
--     ما دام مركز اتصال أو يرى عميلها، والمكلَّف بها يراها ويعدّلها كما كان.
--   * deals_reopen_guard وfollow_ups_reopen_guard: صفقة مغلقة أو متابعة منتهية لعميل لا يراه صاحبها لا يعيد فتحها إلا المدير،
--     فلا يعيد الوسيط القديم شغلاً منتهياً بعد تحويل العميل ليراه من جديد أو يتمّ صفقته لنفسه. («تمت» للمدير أصلاً: 034.)
--
-- لا يمس صفاً ولا ينشئ امتداداً. تطبيقه مرة ثانية لا يغيّر شيئاً. يأخذ أقفال clients وdeals وfollow_ups لحظة استبدال سياساتها:
-- lock_timeout يجعله يفشل بعد 15 ثانية بدل أن يوقف الموقع خلف استعلام طويل، فيُعاد تشغيله.
--
-- التراجع (يدوياً من محرر SQL): يعيد القواعد كما في 005 و007 ويحذف ما أضافه. لا يعيد ما حُوِّل ولا ما حُذف: العميل المحوَّل يبقى
-- عند وسيطه الجديد، والمحذوف لا يعود إلا من النسخة الاحتياطية، وروابط المشاركة الموقوفة تبقى موقوفة.
--   drop trigger if exists deals_reopen_guard on public.deals;
--   drop function if exists public.deals_reopen_guard();
--   drop trigger if exists follow_ups_reopen_guard on public.follow_ups;
--   drop function if exists public.follow_ups_reopen_guard();
--   drop function if exists public.transfer_client(uuid, uuid);
--   drop function if exists public.delete_client(uuid);
--   drop policy if exists clients_select on public.clients;
--   create policy clients_select on public.clients for select to authenticated
--   using (public.is_admin() or owner_id = (select auth.uid()) or created_by = (select auth.uid()));
--   create or replace function public.crm_can_see_client(p_client uuid) returns boolean
--   language sql stable security definer set search_path = public as $f$
--       select exists (select 1 from public.clients c where c.id = p_client
--           and (public.is_admin() or c.owner_id = (select auth.uid()) or c.created_by = (select auth.uid()))) $f$;
--   drop policy if exists deals_select on public.deals;
--   create policy deals_select on public.deals for select to authenticated
--   using (public.is_admin() or broker_id = (select auth.uid()) or created_by = (select auth.uid()));
--   create or replace function public.crm_can_see_deal(p_deal uuid) returns boolean
--   language sql stable security definer set search_path = public as $f$
--       select exists (select 1 from public.deals d where d.id = p_deal
--           and (public.is_admin() or d.broker_id = (select auth.uid()) or d.created_by = (select auth.uid()))) $f$;
--   drop policy if exists follow_ups_select on public.follow_ups;
--   create policy follow_ups_select on public.follow_ups for select to authenticated
--   using (public.is_admin() or assigned_to = (select auth.uid()) or created_by = (select auth.uid()) or public.crm_can_see_client(client_id));
--   drop policy if exists follow_ups_update on public.follow_ups;
--   create policy follow_ups_update on public.follow_ups for update to authenticated
--   using (public.is_admin() or assigned_to = (select auth.uid()) or created_by = (select auth.uid()))
--   with check (public.is_admin() or assigned_to = (select auth.uid()) or created_by = (select auth.uid()));
--   drop policy if exists client_share_links_update on public.client_share_links;
--   create policy client_share_links_update on public.client_share_links for update to authenticated
--   using (public.is_admin() or created_by = (select auth.uid())) with check (public.is_admin() or created_by = (select auth.uid()));
--   drop function if exists public.crm_works_on_client(uuid);
--   delete from public.mulaem_migrations where name = '043_client_transfer_delete.sql';

set local lock_timeout = '15s';

-- ---------- الشغل الجاري ----------
-- security definer: تقرأ deals وfollow_ups بلا قواعد رؤيتهما، فلا تدور قاعدة العميل على قاعدة الصفقة. لا تجيب إلا عن المستخدم نفسه.
create or replace function public.crm_works_on_client(p_client uuid) returns boolean
language sql stable security definer set search_path = '' as $$
    select (select public.my_role()) is not null
       and (exists (select 1 from public.deals d join public.deal_stages s on s.id = d.stage_id
                    where d.client_id = p_client and d.broker_id = (select auth.uid()) and not s.is_terminal)
            or exists (select 1 from public.follow_ups f
                       where f.client_id = p_client and f.assigned_to = (select auth.uid()) and f.status = 'pending'))
$$;
revoke execute on function public.crm_works_on_client(uuid) from public, anon;
grant  execute on function public.crm_works_on_client(uuid) to authenticated;

-- ---------- من يرى العميل ----------
create or replace function public.crm_can_see_client(p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from public.clients c
        where c.id = p_client
          and (public.is_admin()
               or c.owner_id = (select auth.uid())
               or (c.created_by = (select auth.uid())
                   and (c.owner_id is null or (select public.my_role()) = 'callcenter'))
               or public.crm_works_on_client(c.id))
    )
$$;
revoke execute on function public.crm_can_see_client(uuid) from public, anon;
grant  execute on function public.crm_can_see_client(uuid) to authenticated;

drop policy if exists clients_select on public.clients;
create policy clients_select on public.clients for select to authenticated
using (public.is_admin()
       or owner_id = (select auth.uid())
       or (created_by = (select auth.uid())
           and (owner_id is null or (select public.my_role()) = 'callcenter'))
       or public.crm_works_on_client(id));

-- ---------- من يرى الصفقة ----------
create or replace function public.crm_can_see_deal(p_deal uuid) returns boolean
language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from public.deals d
        where d.id = p_deal
          and (public.is_admin()
               or d.broker_id = (select auth.uid())
               or (d.created_by = (select auth.uid()) and public.crm_can_see_client(d.client_id)))
    )
$$;
revoke execute on function public.crm_can_see_deal(uuid) from public, anon;
grant  execute on function public.crm_can_see_deal(uuid) to authenticated;

drop policy if exists deals_select on public.deals;
create policy deals_select on public.deals for select to authenticated
using (public.is_admin()
       or broker_id = (select auth.uid())
       or (created_by = (select auth.uid()) and public.crm_can_see_client(client_id)));

-- ---------- من يرى المتابعة ويعدّلها ----------
drop policy if exists follow_ups_select on public.follow_ups;
create policy follow_ups_select on public.follow_ups for select to authenticated
using (public.is_admin()
       or assigned_to = (select auth.uid())
       or (created_by = (select auth.uid()) and (select public.my_role()) = 'callcenter')
       or public.crm_can_see_client(client_id));

drop policy if exists follow_ups_update on public.follow_ups;
create policy follow_ups_update on public.follow_ups for update to authenticated
using (public.is_admin()
       or assigned_to = (select auth.uid())
       or (created_by = (select auth.uid())
           and ((select public.my_role()) = 'callcenter' or public.crm_can_see_client(client_id))))
with check (public.is_admin()
       or assigned_to = (select auth.uid())
       or (created_by = (select auth.uid())
           and ((select public.my_role()) = 'callcenter' or public.crm_can_see_client(client_id))));

-- ---------- روابط المشاركة القديمة (012) ----------
drop policy if exists client_share_links_update on public.client_share_links;
create policy client_share_links_update on public.client_share_links for update to authenticated
using (public.is_admin() or (created_by = (select auth.uid()) and public.crm_can_see_client(client_id)))
with check (public.is_admin() or (created_by = (select auth.uid()) and public.crm_can_see_client(client_id)));

-- ---------- إعادة فتح شغل منتهٍ لعميل لا يراه صاحبه ----------
-- تُقرأ الرؤية قبل التعديل: الصفقة المغلقة والمتابعة المنتهية ليستا شغلاً جارياً، فلا تفتحان العميل لصاحبهما.
create or replace function public.deals_reopen_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
    if auth.uid() is null or public.is_admin() then
        return new;
    end if;
    if new.stage_id is not distinct from old.stage_id then
        return new;
    end if;
    if exists (select 1 from public.deal_stages s where s.id = old.stage_id and s.is_terminal)
       and not public.crm_can_see_client(old.client_id) then
        raise exception 'إعادة فتح هذه الصفقة للمدير: عميلها ليس عندك' using errcode = 'P0001';
    end if;
    return new;
end $$;
revoke execute on function public.deals_reopen_guard() from public, anon, authenticated;
drop trigger if exists deals_reopen_guard on public.deals;
create trigger deals_reopen_guard before update of stage_id on public.deals
for each row execute function public.deals_reopen_guard();

create or replace function public.follow_ups_reopen_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
    if auth.uid() is null or public.is_admin() then
        return new;
    end if;
    if old.status <> 'pending' and new.status = 'pending' and not public.crm_can_see_client(old.client_id) then
        raise exception 'إعادة فتح هذه المتابعة للمدير: عميلها ليس عندك' using errcode = 'P0001';
    end if;
    return new;
end $$;
revoke execute on function public.follow_ups_reopen_guard() from public, anon, authenticated;
drop trigger if exists follow_ups_reopen_guard on public.follow_ups;
create trigger follow_ups_reopen_guard before update of status on public.follow_ups
for each row execute function public.follow_ups_reopen_guard();

-- ---------- التحويل ----------
-- المشغّلات تعمل كما هي داخلها: auth.uid() هو المدير، فلا يفرض clients_guard ولا follow_ups_guard ولا deals_guard إسناداً،
-- وrequirements_guard يضع مالك الطلب من العميل بعد نقله. القفل FOR NO KEY UPDATE لا يمنع إضافة طلب أو متابعة للعميل في اللحظة نفسها.
create or replace function public.transfer_client(p_client uuid, p_to uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
    v_old uuid;
    v_from uuid;
    v_requirements integer := 0;
    v_follow_ups integer := 0;
    v_deals integer := 0;
begin
    if not coalesce(public.is_admin(), false) then
        raise exception 'تحويل العميل للمدير فقط' using errcode = '42501';
    end if;
    if p_client is null or p_to is null then
        raise exception 'اختر العميل والوسيط' using errcode = '22023';
    end if;
    if not exists (select 1 from public.profiles p where p.id = p_to and p.role = 'field' and not p.is_blocked) then
        raise exception 'الوسيط غير موجود أو حسابه معطّل' using errcode = '22023';
    end if;

    -- من ينتقل شغله: صاحب العميل، وإن كان غير مسند فالوسيط الذي أدخله
    select c.owner_id, coalesce(c.owner_id, case when p.role = 'field' then c.created_by end)
      into v_old, v_from
      from public.clients c left join public.profiles p on p.id = c.created_by
     where c.id = p_client
       for no key update of c;
    if not found then
        raise exception 'العميل غير موجود' using errcode = 'P0002';
    end if;

    if v_old is distinct from p_to then
        update public.clients set owner_id = p_to where id = p_client;
    end if;

    update public.client_requirements r set owner_id = p_to
     where r.client_id = p_client and r.status in ('open', 'matched') and r.owner_id is distinct from p_to;
    get diagnostics v_requirements = row_count;

    update public.follow_ups f set assigned_to = p_to
     where f.client_id = p_client and f.status = 'pending' and f.assigned_to is distinct from p_to
       and (f.assigned_to is null
            or f.assigned_to = v_from
            or exists (select 1 from public.profiles p where p.id = f.assigned_to and p.role = 'field' and p.is_blocked));
    get diagnostics v_follow_ups = row_count;

    update public.deals d set broker_id = p_to
     where d.client_id = p_client and d.broker_id is distinct from p_to
       and exists (select 1 from public.deal_stages s where s.id = d.stage_id and not s.is_terminal)
       and (d.broker_id is null
            or d.broker_id = v_from
            or exists (select 1 from public.profiles p where p.id = d.broker_id and p.role = 'field' and p.is_blocked));
    get diagnostics v_deals = row_count;

    update public.client_share_links l set revoked_at = now()
     where l.client_id = p_client and l.revoked_at is null;

    return jsonb_build_object(
        'changed', v_old is distinct from p_to,
        'requirements', v_requirements,
        'follow_ups', v_follow_ups,
        'deals', v_deals
    );
end $$;
revoke execute on function public.transfer_client(uuid, uuid) from public, anon;
grant  execute on function public.transfer_client(uuid, uuid) to authenticated;

-- ---------- الحذف ----------
-- القفل FOR UPDATE على صف العميل يسبق العدّ: صفقة تُضاف في اللحظة نفسها تنتظره (قفل المفتاح الأجنبي)، ثم يفشل الحذف أو الإضافة،
-- ولا تضيع صفقة.
create or replace function public.delete_client(p_client uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
    v_deals integer;
    v_requirements integer;
    v_follow_ups integer;
begin
    if not coalesce(public.is_admin(), false) then
        raise exception 'حذف العميل للمدير فقط' using errcode = '42501';
    end if;
    perform 1 from public.clients c where c.id = p_client for update;
    if not found then
        raise exception 'العميل غير موجود' using errcode = 'P0002';
    end if;

    select count(*) into v_deals from public.deals d where d.client_id = p_client;
    if v_deals > 0 then
        raise exception 'للعميل % صفقة، فلا يُحذف حتى لا تضيع الصفقات والعمولات', v_deals
            using errcode = 'P0001', hint = 'has_deals';
    end if;

    select count(*) into v_requirements from public.client_requirements r where r.client_id = p_client;
    select count(*) into v_follow_ups from public.follow_ups f where f.client_id = p_client;

    delete from public.clients c where c.id = p_client;

    insert into public.crm_events (client_id, entity_type, entity_id, event_type, payload, actor_id)
    values (null, 'client', p_client::text, 'client_deleted',
            jsonb_build_object('requirements', v_requirements, 'follow_ups', v_follow_ups), auth.uid());

    return jsonb_build_object('requirements', v_requirements, 'follow_ups', v_follow_ups);
end $$;
revoke execute on function public.delete_client(uuid) from public, anon;
grant  execute on function public.delete_client(uuid) to authenticated;
