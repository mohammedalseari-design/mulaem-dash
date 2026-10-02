-- 028: الروابط تُفتح (الجولة C من docs/TASK_AGENT.md — السلوك الأمين فقط).
--
-- وظيفة الاستخراج تفتح رابط المصدر العام من الخادم (robots.txt محترم، بلا تسجيل دخول ولا تجاوز حماية،
-- وبوكيل مستخدم باسمها)، وتحفظ الصفحة المقروءة نصاً (أو ملف PDF) في المخزن الخاص تحت مجلد الطلب،
-- فتبقى الاقتباسات ثابتة مهما تغيّرت الصفحة ولا يُفتح الرابط مرتين. المتصفح ما زال يسجّل الرابط فقط؛
-- المسار والعنوان ووقت القراءة وسبب التعذّر تكتبها الوظيفة وحدها (بلا هوية مستخدم).
--
-- الترتيب: تُطبَّق هذه الهجرة قبل دفع الكود الذي يقرأ أعمدتها (docs/DEPLOY.md «الهجرات قبل الدفع»). تطبيقها
-- أولاً آمن مع الوظيفة والواجهة القديمتين (تتجاهلان الأعمدة)، وإعادة تطبيقها لا تغيّر شيئاً.

alter table public.agent_sources
    add column if not exists title       text,
    add column if not exists fetched_at  timestamptz,
    add column if not exists fetch_error text;

comment on column public.agent_sources.title       is 'عنوان الصفحة كما أعلنته (<title>) عند قراءة الرابط';
comment on column public.agent_sources.fetched_at  is 'وقت محاولة قراءة الرابط من الخادم، نجحت أو تعذّرت';
comment on column public.agent_sources.fetch_error is 'سبب تعذّر القراءة بالعربية؛ لا يُعاد فتح الرابط بعده في الطلب نفسه';

-- حارس المرفقات (011): كان يصفّر مسار كل رابط. الآن: الرابط من المتصفح بلا مسار كما كان، والصفحة
-- المقروءة من الوظيفة بمسار داخل مجلد الطلب تخضع لقاعدة المسار نفسها التي تخضع لها الملفات المرفوعة.
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
