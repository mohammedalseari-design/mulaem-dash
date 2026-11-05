-- 041: الربط مع مقسم: جدول حالة يقرؤه الخادم وحده، والمفاتيح مشفّرة في Vault، وثلاث دوال لمفتاح الخدمة وحده.
--
-- صفحة «الربط مع مقسم» (#/settings/maqsam) يلصق فيها المدير قيم مقسم الثلاث (base_url وaccess_key_id وaccess_secret).
-- وظيفة maqsam-link تجرّبها على مقسم أولاً، ولا تنادي maqsam_link_connect إلا إذا نجحت التجربة. المتصفح لا يكلّم مقسم أبداً.
--
-- ما يضيفه:
--   * public.maqsam_link: صف واحد (id دائماً true): النطاق، وآخر 4 خانات من المفتاح، ومن ربط ومتى، ونتيجة آخر فحص (أعداد
--     وبريد الموظفين فقط). لا سر فيه ولا رقم عميل ولا نص مكالمة. RLS مفعّل بلا سياسات، ولا صلاحية لـ anon ولا authenticated:
--     crm_settings لا يصلح لهذا، فكل من سجّل دخوله يقرؤه.
--   * قيود تصدّ الخطأ ولو أخطأ الكود: النطاق maqsam.com أو نطاق فرعي منه لا غيره، وkey_hint أربع خانات لا أكثر.
--   * مفتاح الخدمة يقرأ الجدول ويكتب أعمدة آخر فحص وحدها، فالنطاق والمفتاحان لا يتغيّرون إلا معاً عبر maqsam_link_connect.
--   * maqsam_link_connect: يكتب السرّين في Vault بالاسم (ينشئ أو يستبدل) وصف الحالة في معاملة واحدة.
--   * maqsam_link_credentials: يعيد النطاق والمفتاحين للخادم حين يفحص الربط.
--   * maqsam_link_disconnect: يكتب فوق السرّين قيمة عشوائية ثم يحذفهما ويحذف الصف. سر agent_cron_secret وغيره لا يُمس.
--   * الدوال الثلاث ترفض anon وauthenticated من داخلها: استعادة نسخة في مشروع جديد قد تعيد الصلاحيات الافتراضية (docs/RECOVERY.md).
--
-- لا يعتمد على بيانات ولا ينشئ امتداداً (Vault مفعّل ومستعمل منذ 020). الدوال plpgsql فلا تُفحص مراجع vault وقت الإنشاء،
-- فتمر التجربة على النسخة المؤقتة في migrate.yml كما هي. تطبيقه مرة ثانية لا يغيّر شيئاً.
--
-- التراجع (يدوياً من محرر SQL، ولا يمس غير ما أضافه هذا الملف):
--   select public.maqsam_link_disconnect();
--   drop function public.maqsam_link_disconnect();
--   drop function public.maqsam_link_credentials();
--   drop function public.maqsam_link_connect(text, text, text, text, uuid, jsonb);
--   drop table public.maqsam_link;
--   delete from public.mulaem_migrations where name = '041_maqsam_link.sql';
-- وقبله تُوقَف وظيفة maqsam-link كما في docs/DEPLOY.md («التراجع إلى نسخة سابقة»)، وإلا صارت ترد خطأ خادم على كل طلب.

/* ===================== جدول الحالة ===================== */

create table if not exists public.maqsam_link (
    id               boolean primary key default true check (id),
    host             text not null check (
                         length(host) <= 253
                         and host ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*maqsam\.com$'
                     ),
    key_hint         text check (key_hint is null or length(key_hint) = 4),
    connected_at     timestamptz not null default now(),
    connected_by     uuid references public.profiles (id) on delete set null,
    last_check_at    timestamptz,
    last_check_ok    boolean,
    last_check_code  text check (last_check_code is null or last_check_code in (
                         'ok', 'unauthorized', 'not_found', 'rate_limited', 'timeout', 'network', 'server_error', 'bad_response'
                     )),
    last_check_stats jsonb check (last_check_stats is null or jsonb_typeof(last_check_stats) = 'object')
);

alter table public.maqsam_link enable row level security;

-- إعداد Supabase الافتراضي يمنح كل جدول جديد لكل الأدوار، فيُسحب كله بعد الإنشاء ولا يبقى إلا ما تحتاجه الوظيفة
revoke all on table public.maqsam_link from public, anon, authenticated, service_role;
grant select on table public.maqsam_link to service_role;
grant update (last_check_at, last_check_ok, last_check_code, last_check_stats) on table public.maqsam_link to service_role;

/* ===================== دوال الخادم (service_role فقط) ===================== */

-- الربط: السرّان والصف معاً أو لا شيء. الوظيفة لا تناديها إلا بعد نجاح التجربة على مقسم. ربط جديد يستبدل القديم ولا يكرره.
create or replace function public.maqsam_link_connect(
    p_host     text,
    p_key_id   text,
    p_secret   text,
    p_key_hint text,
    p_by       uuid,
    p_stats    jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
declare
    v_key_id    uuid;
    v_secret_id uuid;
begin
    if pg_catalog.current_setting('role', true) in ('anon', 'authenticated') then
        raise exception 'maqsam_link: service role only' using errcode = '42501';
    end if;

    -- رسالة ثابتة: لا تحمل أي قيمة من المعاملات
    if coalesce(p_key_id, '') = '' or coalesce(p_secret, '') = '' then
        raise exception 'maqsam_link_connect: empty credentials';
    end if;

    -- مديران يحفظان معاً لا يتصادمان على اسم السر
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public.maqsam_link', 0));

    select s.id into v_key_id from vault.secrets s where s.name = 'maqsam_access_key_id';
    if v_key_id is null then
        perform vault.create_secret(p_key_id, 'maqsam_access_key_id', 'الربط مع مقسم: access_key_id');
    else
        perform vault.update_secret(v_key_id, p_key_id);
    end if;

    select s.id into v_secret_id from vault.secrets s where s.name = 'maqsam_access_secret';
    if v_secret_id is null then
        perform vault.create_secret(p_secret, 'maqsam_access_secret', 'الربط مع مقسم: access_secret');
    else
        perform vault.update_secret(v_secret_id, p_secret);
    end if;

    insert into public.maqsam_link
        (id, host, key_hint, connected_at, connected_by, last_check_at, last_check_ok, last_check_code, last_check_stats)
    values
        (true, p_host, p_key_hint, pg_catalog.now(), p_by, pg_catalog.now(), true, 'ok', p_stats)
    on conflict (id) do update set
        host             = excluded.host,
        key_hint         = excluded.key_hint,
        connected_at     = excluded.connected_at,
        connected_by     = excluded.connected_by,
        last_check_at    = excluded.last_check_at,
        last_check_ok    = excluded.last_check_ok,
        last_check_code  = excluded.last_check_code,
        last_check_stats = excluded.last_check_stats;
end $$;
revoke execute on function public.maqsam_link_connect(text, text, text, text, uuid, jsonb) from public, anon, authenticated;
grant  execute on function public.maqsam_link_connect(text, text, text, text, uuid, jsonb) to service_role;

-- قيم الربط المحفوظة ومتى رُبطت، أو لا صف إن لم يوجد ربط أو نقص أحد السرّين. connected_at يميّز هذا الربط عن ربط أحدث منه أثناء الفحص.
-- الوحيدة التي تعيد سراً مفكوكاً، فلا تُعطى إلا لمفتاح الخدمة نفسه. والفحص الثاني ليس في الدالتين الأخريين: سطر التراجع ينادي الفصل من محرر SQL بلا JWT.
create or replace function public.maqsam_link_credentials()
returns table (host text, key_id text, secret text, connected_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
    if pg_catalog.current_setting('role', true) in ('anon', 'authenticated') then
        raise exception 'maqsam_link: service role only' using errcode = '42501';
    end if;
    if auth.role() is distinct from 'service_role' then
        raise exception 'maqsam_link: service role only' using errcode = '42501';
    end if;

    return query
    select l.host, k.decrypted_secret::text, s.decrypted_secret::text, l.connected_at
      from public.maqsam_link l
      join vault.decrypted_secrets k on k.name = 'maqsam_access_key_id'
      join vault.decrypted_secrets s on s.name = 'maqsam_access_secret'
     where l.id;
end $$;
revoke execute on function public.maqsam_link_credentials() from public, anon, authenticated;
grant  execute on function public.maqsam_link_credentials() to service_role;

-- الفصل: يكتب فوق السرّين قيمة عشوائية ثم يحذفهما (الحذف يُخرجهما من vault.decrypted_secrets) ويحذف الصف. بلا ربط لا يفعل شيئاً.
create or replace function public.maqsam_link_disconnect()
returns void
language plpgsql security definer set search_path = '' as $$
declare
    v_id uuid;
begin
    if pg_catalog.current_setting('role', true) in ('anon', 'authenticated') then
        raise exception 'maqsam_link: service role only' using errcode = '42501';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public.maqsam_link', 0));

    for v_id in
        select s.id from vault.secrets s where s.name in ('maqsam_access_key_id', 'maqsam_access_secret')
    loop
        perform vault.update_secret(v_id, pg_catalog.gen_random_uuid()::text);
    end loop;

    delete from vault.secrets s where s.name in ('maqsam_access_key_id', 'maqsam_access_secret');
    delete from public.maqsam_link l where l.id;
end $$;
revoke execute on function public.maqsam_link_disconnect() from public, anon, authenticated;
grant  execute on function public.maqsam_link_disconnect() to service_role;
