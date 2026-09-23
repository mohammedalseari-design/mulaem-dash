-- 021_unit_commission_edit — تعديل عمولة الوحدة من صفحة العقارات في الـCRM (للمدير وحده).
-- طُبّقت على المشروع الحي باسم unit_commission_edit.
--
-- العمولة تعيش في projects.details.models[i].commission (017/018). هذه الدالة تغيّر هذا
-- المفتاح وحده في معاملة واحدة بقفل الصف، فلا تُعاد كتابة تفاصيل المشروع كاملة من المتصفح
-- ولا تُداس تعديلات متزامنة. المدير فقط، والقيمة رقم من 0 إلى 100 مليون.
--
-- ملاحظة على 017/018: v_inventory_attention تعتمد على v_units، فإسقاط v_units فيهما يفشل على
-- قاعدة فيها 008؛ طُبّقت الحالة النهائية للعرضين حياً باسم unit_commission_search_fields مع
-- إعادة إنشاء v_inventory_attention.

create or replace function public.set_unit_commission(p_project int, p_unit_ord int, p_commission numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_models jsonb;
begin
    if not public.is_admin() then
        return jsonb_build_object('ok', false, 'code', 'forbidden');
    end if;
    if p_commission is null or p_commission < 0 or p_commission > 100000000 then
        return jsonb_build_object('ok', false, 'code', 'bad_value');
    end if;

    select details->'models' into v_models from public.projects where id = p_project for update;
    if v_models is null or jsonb_typeof(v_models) <> 'array'
       or p_unit_ord < 1 or p_unit_ord > jsonb_array_length(v_models) then
        return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;

    update public.projects
       set details = jsonb_set(details, array['models', (p_unit_ord - 1)::text, 'commission'], to_jsonb(p_commission))
     where id = p_project;

    return jsonb_build_object('ok', true, 'commission', p_commission);
end $$;
revoke execute on function public.set_unit_commission(int, int, numeric) from public, anon;
grant  execute on function public.set_unit_commission(int, int, numeric) to authenticated;
