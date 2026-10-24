-- 034: صفقة «تمت» لا يعيد فتحها ولا يعدّل قيمتها إلا المدير (قرار المالك 2026-10-24).
--
-- قبلها كان الوسيط يستطيع من صفحة صفقته، فيمسّ العمولة بطريق غير مباشر:
--   * تعديل قيمة صفقة «تمت»: يتبعها أساس العمولة أو تُعلَّم «تحتاج مراجعة» (deals_after في 009)،
--   * إعادة فتحها إلى مرحلة أخرى: تُحذف عمولتها التي لم يُسجَّل عليها شيء أو تُعلَّم للمراجعة (031).
-- الآن يُرفض الطلب كله لأي مستخدم غير المدير إن كانت الصفقة في «تمت» وتغيّرت مرحلتها أو قيمتها.
-- ما قبل «تمت» كما هو: الوسيط يسجّل القيمة أثناء الصفقة ويؤكد السعر النهائي عند الإتمام، وعليه تُنشأ العمولة.
-- وما سوى المرحلة والقيمة (الوحدة، الإغلاق المتوقع) يبقى له. «خسرت» يعيد فتحها كما كان.
-- بلا مستخدم (مفتاح الخدمة، صيانة لوحة Supabase) أو المدير: لا قيد.
-- مشغّل مستقل قبل التعديل (لا تُعاد كتابة deals_guard ولا deals_after). لا يغيّر أي سجل قائم،
-- وتطبيقه مرة ثانية لا يغيّر شيئاً.

create or replace function public.deals_won_lock() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_was_won boolean;
begin
    if auth.uid() is null or public.is_admin() then
        return new;
    end if;

    select is_won into v_was_won from public.deal_stages where id = old.stage_id;
    if not coalesce(v_was_won, false) then
        return new;
    end if;

    if new.stage_id is distinct from old.stage_id then
        raise exception 'إعادة فتح صفقة «تمت» للمدير فقط';
    end if;
    if new.amount is distinct from old.amount then
        raise exception 'تعديل قيمة صفقة «تمت» للمدير فقط';
    end if;
    return new;
end $$;
revoke execute on function public.deals_won_lock() from public, anon, authenticated;

drop trigger if exists deals_won_lock on public.deals;
create trigger deals_won_lock before update of stage_id, amount on public.deals
for each row execute function public.deals_won_lock();
