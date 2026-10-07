-- 031: الصفقة التي تخرج من «تمت» لا تبقى عمولتها مستحقة.
--
-- كانت العمولة تُنشأ عند «تمت» (deals_after في 009) وتبقى «مستحقة» وتُحسب في التقارير ولو أُعيدت الصفقة إلى
-- مرحلة قبلها أو خسرت. الآن، عند خروج الصفقة من «تمت»:
--   * عمولة لم يُسجَّل عليها شيء (مستحقة، بلا دفعات، بلا رقم فاتورة) → تُحذف، ويُكتب ذلك في سجل العميل.
--     وإن عادت الصفقة إلى «تمت» أنشأها deals_after من جديد بقيمتها يومها.
--   * عمولة عليها دفعة أو فاتورة أو حالة غير «مستحقة» → لا يُمسّ سجلها المالي، وتُعلَّم «تحتاج مراجعة»
--     (needs_review من 009) ليقرر المدير، ويُكتب ذلك في السجل.
-- مشغّل مستقل بعد deals_after (لا تُعاد كتابة deals_after). تطبيقه مرة ثانية لا يغيّر شيئاً.

create or replace function public.deals_unwon_commission() returns trigger
language plpgsql security definer set search_path = public as $$
declare
    v_was_won  boolean;
    v_is_won   boolean;
    v_id       uuid;
    v_status   text;
    v_invoice  text;
    v_gross    numeric;
    v_payments int;
begin
    select is_won into v_was_won from public.deal_stages where id = old.stage_id;
    select is_won into v_is_won  from public.deal_stages where id = new.stage_id;
    if not coalesce(v_was_won, false) or coalesce(v_is_won, false) then
        return null;
    end if;

    select c.id, c.status, c.invoice_no, c.gross_amount into v_id, v_status, v_invoice, v_gross
    from public.commissions c where c.deal_id = new.id;
    if v_id is null then
        return null;
    end if;

    select count(*) into v_payments from public.commission_payments p where p.commission_id = v_id;
    if v_payments = 0 and v_status = 'due' and nullif(btrim(coalesce(v_invoice, '')), '') is null then
        delete from public.commissions where id = v_id;
        insert into public.crm_events (client_id, entity_type, entity_id, event_type, payload, actor_id)
        values (new.client_id, 'commission', v_id::text, 'commission_removed',
                jsonb_build_object('deal_id', new.id, 'gross', v_gross, 'to_stage', new.stage_id), auth.uid());
    else
        update public.commissions set needs_review = true where id = v_id;
        insert into public.crm_events (client_id, entity_type, entity_id, event_type, payload, actor_id)
        values (new.client_id, 'commission', v_id::text, 'commission_review',
                jsonb_build_object('deal_id', new.id, 'status', v_status, 'to_stage', new.stage_id), auth.uid());
    end if;
    return null;
end $$;
revoke execute on function public.deals_unwon_commission() from public, anon, authenticated;
drop trigger if exists deals_unwon_commission on public.deals;
create trigger deals_unwon_commission after update of stage_id on public.deals
for each row execute function public.deals_unwon_commission();
