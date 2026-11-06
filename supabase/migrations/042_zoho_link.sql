-- 042: الربط مع Zoho CRM ونقل ملخصات مكالمات مقسم إلى ملاحظات في Zoho: جداول حالة يقرؤها الخادم وحده، والمفاتيح في Vault، والنقل متوقف حتى يضغط مدير زراً.
--
-- الصفحة نفسها فيها تبويبا «مقسم» و«Zoho CRM». وظيفة zoho-link تستبدل رمز Self Client لمرة واحدة بمفتاح دائم، وتتأكد من المنشأة والمستخدم،
-- ولا تنادي zoho_link_connect إلا بعد ذلك. ووظيفة maqsam-sync يناديها pg_cron كل خمس دقائق ما دام النقل مفعّلاً.
--
-- ما يضيفه:
--   * public.zoho_link: صف واحد (id دائماً true): اسم المنشأة والمستخدم وملفه، وآخر 4 خانات من Client ID، ومن ربط ومتى، ونتيجة آخر فحص
--     (أعداد وأسماء موظفين فقط). لا سر فيه ولا رقم عميل. قائمة رموز الفحص مغلقة بقيد.
--   * public.zoho_link_limits: صف واحد: أوقات محاولات الربط وتجديد المفتاح في آخر 10 دقائق، ومحاولة جارية، وحظر Zoho المؤقت، وعدّادان.
--     الوظائف بلا حالة بين الطلبات، فمكان هذا القاعدة.
--   * public.maqsam_sync_state: صف واحد: مفعّل أم لا، ومن أين يبدأ، وأين وصل، ونتيجة آخر دورة. لا صف معناه متوقف.
--   * public.maqsam_sync_calls: مكالمة واحدة لكل صف: رقم المكالمة وحالتها ومعرّفات Zoho وعدد المحاولات. لا رقم عميل ولا اسم ولا ملخص، والقيود تمنع غير ذلك.
--     هي ضمان «ملاحظة واحدة لكل مكالمة»، فلا يمسحها الفصل.
--   * دوال الربط الثلاث كما في 041، ودوال الحدود، ودوال النقل حيث تهم الذرّية، وكلها لمفتاح الخدمة وحده وترفض anon وauthenticated من داخلها:
--     استعادة نسخة في مشروع جديد قد تعيد الصلاحيات الافتراضية (docs/RECOVERY.md).
--   * maqsam_sync_cron_tick ومهمة pg_cron باسم maqsam-sync-tick، وسر maqsam_sync_cron_secret في Vault كما بُني agent_cron_secret في 020.
--     لا يمس سراً قائماً ولا مهمة قائمة.
--
-- لا يعتمد على بيانات ولا ينشئ امتداداً (Vault وpg_cron وpg_net مفعّلة ومستعملة منذ 020). الدوال plpgsql فلا تُفحص مراجع vault وnet وقت الإنشاء،
-- فتمر التجربة على النسخة المؤقتة في migrate.yml. وتلك النسخة بنية بلا بيانات، فجدول mulaem_migrations فيها فارغ، ولا سر فيها ولا مهمة، وقد لا يعمل
-- فيها Vault ولا pg_cron: لذلك يتخطاهما آخر قسمين فيها وحدها. في القاعدة الحقيقية فيه صفوف من 032 فما بعد، فينشأ السر وتُجدول المهمة، وأي خطأ يسقط التحديث كله.
-- تطبيقه مرة ثانية لا يغيّر شيئاً.
--
-- التراجع (يدوياً من محرر SQL، ولا يمس غير ما أضافه هذا الملف). افصل Zoho من الصفحة أولاً: السطر الثاني يمسح المفتاح هنا ولا يبطله عند Zoho.
-- وحذف maqsam_sync_calls ينسي النظام ما كتبه، فلا يُشغَّل النقل بعده من 30 يوماً وإلا تكررت الملاحظات:
--   select cron.unschedule(jobid) from cron.job where jobname = 'maqsam-sync-tick';
--   select public.zoho_link_disconnect();
--   delete from vault.secrets where name = 'maqsam_sync_cron_secret';
--   drop function public.maqsam_sync_cron_tick();
--   drop function public.maqsam_sync_cron_secret_ok(text);
--   drop function public.maqsam_sync_mark(bigint, text, timestamptz);
--   drop function public.maqsam_sync_release(bigint, boolean, int, int);
--   drop function public.maqsam_sync_written(bigint, text, text, text, boolean);
--   drop function public.maqsam_sync_claim(bigint, text, text, boolean, boolean, int);
--   drop function public.maqsam_sync_set_reconnect(timestamptz, boolean);
--   drop function public.maqsam_sync_run_end(text, timestamptz);
--   drop function public.maqsam_sync_run_begin(int);
--   drop function public.maqsam_sync_stop();
--   drop function public.maqsam_sync_start(timestamptz, uuid);
--   drop function public.maqsam_sync_status();
--   drop function public.zoho_link_note_tokens(int, int);
--   drop function public.zoho_token_denied(int);
--   drop function public.zoho_token_refresh_begin(int, int);
--   drop function public.zoho_link_attempt_end();
--   drop function public.zoho_link_attempt_begin(int, int, int);
--   drop function public.zoho_link_disconnect();
--   drop function public.zoho_link_credentials();
--   drop function public.zoho_link_connect(text, text, text, text, text, text, text, uuid, jsonb);
--   drop table public.maqsam_sync_calls;
--   drop table public.maqsam_sync_state;
--   drop table public.zoho_link_limits;
--   drop table public.zoho_link;
--   delete from public.mulaem_migrations where name = '042_zoho_link.sql';
-- وقبله تُوقَف وظيفتا zoho-link وmaqsam-sync كما في docs/DEPLOY.md («التراجع إلى نسخة سابقة»)، وإلا صارتا تردان خطأ خادم على كل طلب.

/* ===================== حالة الربط ===================== */

create table if not exists public.zoho_link (
    id               boolean primary key default true check (id),
    org_name         text check (org_name is null or length(org_name) <= 200),
    user_name        text check (user_name is null or length(user_name) <= 200),
    user_profile     text check (user_profile is null or length(user_profile) <= 100),
    client_hint      text check (client_hint is null or length(client_hint) = 4),
    connected_at     timestamptz not null default now(),
    connected_by     uuid references public.profiles (id) on delete set null,
    last_check_at    timestamptz,
    last_check_ok    boolean,
    last_check_code  text check (last_check_code is null or last_check_code in (
                         'ok', 'invalid_client', 'invalid_code', 'throttled', 'no_refresh_token', 'wrong_environment', 'wrong_org', 'not_admin',
                         'token_revoked', 'scope_mismatch', 'no_permission', 'inactive_user', 'rate_limited', 'timeout', 'network', 'server_error', 'bad_response'
                     )),
    last_check_stats jsonb check (last_check_stats is null or jsonb_typeof(last_check_stats) = 'object')
);

alter table public.zoho_link enable row level security;

-- إعداد Supabase الافتراضي يمنح كل جدول جديد لكل الأدوار، فيُسحب كله بعد الإنشاء ولا يبقى إلا ما تحتاجه الوظيفة
revoke all on table public.zoho_link from public, anon, authenticated, service_role;
grant select on table public.zoho_link to service_role;
grant update (last_check_at, last_check_ok, last_check_code, last_check_stats) on table public.zoho_link to service_role;

-- حدود Zoho: 10 رموز في 10 دقائق، و10 مفاتيح وصول لكل مفتاح تجديد في 10 دقائق، ومن تجاوزها حُظر بقية النافذة. نلتزم بأقل منها.
create table if not exists public.zoho_link_limits (
    id                  boolean primary key default true check (id),
    attempts_at         timestamptz[] not null default '{}' check (cardinality(attempts_at) <= 50),
    attempt_lease_until timestamptz,
    refreshes_at        timestamptz[] not null default '{}' check (cardinality(refreshes_at) <= 50),
    blocked_until       timestamptz,
    tokens_minted       bigint not null default 0 check (tokens_minted >= 0),
    revoke_failures     bigint not null default 0 check (revoke_failures >= 0)
);

alter table public.zoho_link_limits enable row level security;
revoke all on table public.zoho_link_limits from public, anon, authenticated, service_role;

/* ===================== حالة النقل ===================== */

create table if not exists public.maqsam_sync_state (
    id              boolean primary key default true check (id),
    enabled         boolean not null default false,
    started_at      timestamptz,
    start_from      timestamptz,
    started_by      uuid references public.profiles (id) on delete set null,
    scan_cursor     timestamptz,
    last_run_at     timestamptz,
    last_run_code   text check (last_run_code is null or last_run_code in (
                        'ok', 'capped', 'zoho_not_connected', 'maqsam_not_connected',
                        'maqsam_unauthorized', 'maqsam_not_found', 'maqsam_rate_limited', 'maqsam_timeout', 'maqsam_network', 'maqsam_server_error', 'maqsam_bad_response',
                        'invalid_client', 'token_revoked', 'scope_mismatch', 'no_permission', 'inactive_user', 'wrong_environment', 'throttled', 'rate_limited',
                        'timeout', 'network', 'server_error', 'bad_response'
                    )),
    needs_reconnect boolean not null default false,
    run_lease_until timestamptz
);

alter table public.maqsam_sync_state enable row level security;
revoke all on table public.maqsam_sync_state from public, anon, authenticated, service_role;

-- معرّفات Zoho أرقام طويلة (13 خانة في أقصر ما وثّقه Zoho)، فلا يدخل هذا الجدول رقم جوال بأي صيغة ولا نص. ولا عمود هنا لنص أو اسم.
create table if not exists public.maqsam_sync_calls (
    call_id        bigint primary key check (call_id > 0),
    status         text not null check (status in ('claimed', 'written', 'waiting', 'no_match', 'no_summary', 'failed')),
    zoho_module    text check (zoho_module is null or zoho_module in ('Leads', 'Contacts')),
    zoho_record_id text check (zoho_record_id is null or zoho_record_id ~ '^[0-9]{13,40}$'),
    zoho_note_id   text check (zoho_note_id is null or zoho_note_id ~ '^[0-9]{13,40}$'),
    ambiguous      boolean not null default false,
    attempts       integer not null default 0 check (attempts >= 0),
    next_try_at    timestamptz,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    check (status <> 'written' or zoho_note_id is not null),
    check (status not in ('claimed', 'written') or (zoho_module is not null and zoho_record_id is not null))
);

create index if not exists maqsam_sync_calls_open_idx on public.maqsam_sync_calls (status) where status in ('waiting', 'claimed');

alter table public.maqsam_sync_calls enable row level security;
revoke all on table public.maqsam_sync_calls from public, anon, authenticated, service_role;
grant select on table public.maqsam_sync_calls to service_role;

/* ===================== دوال الربط (service_role فقط) ===================== */

-- الربط: الأسرار الثلاثة والصف معاً أو لا شيء، وربط جديد يستبدل القديم ولا يكرره ويرفع علامة «يحتاج إعادة ربط».
-- الوظيفة لا تناديها إلا بعد أن تتأكد من المنشأة والمستخدم، وتبطل المفتاح الجديد عند Zoho إن فشلت.
create or replace function public.zoho_link_connect(
    p_client_id     text,
    p_client_secret text,
    p_refresh_token text,
    p_client_hint   text,
    p_org_name      text,
    p_user_name     text,
    p_user_profile  text,
    p_by            uuid,
    p_stats         jsonb
) returns void
language plpgsql security definer set search_path = '' as $$
declare
    v_item record;
    v_id   uuid;
begin
    if pg_catalog.current_setting('role', true) in ('anon', 'authenticated') then
        raise exception 'zoho_link: service role only' using errcode = '42501';
    end if;

    -- رسالة ثابتة: لا تحمل أي قيمة من المعاملات
    if coalesce(p_client_id, '') = '' or coalesce(p_client_secret, '') = '' or coalesce(p_refresh_token, '') = '' then
        raise exception 'zoho_link_connect: empty credentials';
    end if;

    -- مديران يحفظان معاً لا يتصادمان على اسم السر
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public.zoho_link', 0));

    for v_item in
        select * from (values
            ('zoho_client_id', p_client_id, 'الربط مع Zoho: Client ID'),
            ('zoho_client_secret', p_client_secret, 'الربط مع Zoho: Client Secret'),
            ('zoho_refresh_token', p_refresh_token, 'الربط مع Zoho: مفتاح التجديد')
        ) as t (name, value, description)
    loop
        v_id := null;
        select s.id into v_id from vault.secrets s where s.name = v_item.name;
        if v_id is null then
            perform vault.create_secret(v_item.value, v_item.name, v_item.description);
        else
            perform vault.update_secret(v_id, v_item.value);
        end if;
    end loop;

    insert into public.zoho_link
        (id, org_name, user_name, user_profile, client_hint, connected_at, connected_by, last_check_at, last_check_ok, last_check_code, last_check_stats)
    values
        (true, p_org_name, p_user_name, p_user_profile, p_client_hint, pg_catalog.now(), p_by, pg_catalog.now(), true, 'ok', p_stats)
    on conflict (id) do update set
        org_name         = excluded.org_name,
        user_name        = excluded.user_name,
        user_profile     = excluded.user_profile,
        client_hint      = excluded.client_hint,
        connected_at     = excluded.connected_at,
        connected_by     = excluded.connected_by,
        last_check_at    = excluded.last_check_at,
        last_check_ok    = excluded.last_check_ok,
        last_check_code  = excluded.last_check_code,
        last_check_stats = excluded.last_check_stats;

    update public.maqsam_sync_state s set needs_reconnect = false where s.id;
end $$;
revoke execute on function public.zoho_link_connect(text, text, text, text, text, text, text, uuid, jsonb) from public, anon, authenticated;
grant  execute on function public.zoho_link_connect(text, text, text, text, text, text, text, uuid, jsonb) to service_role;

-- قيم الربط المحفوظة ومتى رُبطت، أو لا صف إن لم يوجد ربط أو نقص أحد الأسرار. connected_at يميّز هذا الربط عن ربط أحدث منه أثناء الفحص.
-- الوحيدة التي تعيد سراً مفكوكاً، فلا تُعطى إلا لمفتاح الخدمة نفسه. والفحص الثاني ليس في دالة الفصل: سطر التراجع ينادي الفصل من محرر SQL بلا JWT.
create or replace function public.zoho_link_credentials()
returns table (client_id text, client_secret text, refresh_token text, connected_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
    if pg_catalog.current_setting('role', true) in ('anon', 'authenticated') then
        raise exception 'zoho_link: service role only' using errcode = '42501';
    end if;
    if auth.role() is distinct from 'service_role' then
        raise exception 'zoho_link: service role only' using errcode = '42501';
    end if;

    return query
    select i.decrypted_secret::text, s.decrypted_secret::text, r.decrypted_secret::text, l.connected_at
      from public.zoho_link l
      join vault.decrypted_secrets i on i.name = 'zoho_client_id'
      join vault.decrypted_secrets s on s.name = 'zoho_client_secret'
      join vault.decrypted_secrets r on r.name = 'zoho_refresh_token'
     where l.id;
end $$;
revoke execute on function public.zoho_link_credentials() from public, anon, authenticated;
grant  execute on function public.zoho_link_credentials() to service_role;

-- الفصل: يكتب فوق الأسرار الثلاثة قيمة عشوائية ثم يحذفها ويحذف الصف ويوقف النقل. لا يمس maqsam_sync_calls: ربط لاحق لا يكرر ما كُتب.
-- إبطال المفتاح عند Zoho قبلها من الوظيفة. بلا ربط لا يفعل شيئاً. سر maqsam_sync_cron_secret وغيره لا يُمس.
create or replace function public.zoho_link_disconnect()
returns void
language plpgsql security definer set search_path = '' as $$
declare
    v_id uuid;
begin
    if pg_catalog.current_setting('role', true) in ('anon', 'authenticated') then
        raise exception 'zoho_link: service role only' using errcode = '42501';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public.zoho_link', 0));

    for v_id in
        select s.id from vault.secrets s where s.name in ('zoho_client_id', 'zoho_client_secret', 'zoho_refresh_token')
    loop
        perform vault.update_secret(v_id, pg_catalog.gen_random_uuid()::text);
    end loop;

    delete from vault.secrets s where s.name in ('zoho_client_id', 'zoho_client_secret', 'zoho_refresh_token');
    delete from public.zoho_link l where l.id;
    update public.maqsam_sync_state s set enabled = false, needs_reconnect = false, run_lease_until = null where s.id;
end $$;
revoke execute on function public.zoho_link_disconnect() from public, anon, authenticated;
grant  execute on function public.zoho_link_disconnect() to service_role;

/* ===================== حدود Zoho ===================== */

-- قبل استعمال رمز الربط: الرمز لمرة واحدة ولو فشل، فلا يُرسل إلى Zoho إلا إذا سمحت الحدود. لا تكشف إلا القرار وكم ينتظر.
-- blocked: قال Zoho «Access Denied»، وbusy: محاولة أخرى جارية (ضغطة مزدوجة أو مديران)، وlimit: 5 محاولات في 10 دقائق.
create or replace function public.zoho_link_attempt_begin(
    p_limit          int default 5,
    p_window_seconds int default 600,
    p_lease_seconds  int default 120
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
    v_now    timestamptz := pg_catalog.clock_timestamp();
    v_row    public.zoho_link_limits%rowtype;
    v_recent timestamptz[];
    v_until  timestamptz;
    v_reason text;
begin
    if pg_catalog.current_setting('role', true) in ('anon', 'authenticated') then
        raise exception 'zoho_link: service role only' using errcode = '42501';
    end if;

    insert into public.zoho_link_limits (id) values (true) on conflict (id) do nothing;
    select l.* into v_row from public.zoho_link_limits l where l.id for update;

    v_recent := array(
        select a from pg_catalog.unnest(v_row.attempts_at) as a
         where a > v_now - pg_catalog.make_interval(secs => p_window_seconds)
         order by a
    );

    if v_row.blocked_until > v_now then
        v_reason := 'blocked';
        v_until  := v_row.blocked_until;
    elsif v_row.attempt_lease_until > v_now then
        v_reason := 'busy';
        v_until  := v_row.attempt_lease_until;
    elsif pg_catalog.cardinality(v_recent) >= p_limit then
        v_reason := 'limit';
        v_until  := v_recent[1] + pg_catalog.make_interval(secs => p_window_seconds);
    end if;

    if v_reason is not null then
        return pg_catalog.jsonb_build_object(
            'allowed', false,
            'reason', v_reason,
            'wait_seconds', greatest(1, pg_catalog.ceil(extract(epoch from v_until - v_now))::int)
        );
    end if;

    update public.zoho_link_limits l
       set attempts_at = v_recent || v_now,
           attempt_lease_until = v_now + pg_catalog.make_interval(secs => p_lease_seconds)
     where l.id;
    return pg_catalog.jsonb_build_object('allowed', true, 'reason', 'ok', 'wait_seconds', 0);
end $$;
revoke execute on function public.zoho_link_attempt_begin(int, int, int) from public, anon, authenticated;
grant  execute on function public.zoho_link_attempt_begin(int, int, int) to service_role;

create or replace function public.zoho_link_attempt_end()
returns void
language plpgsql security definer set search_path = '' as $$
begin
    if pg_catalog.current_setting('role', true) in ('anon', 'authenticated') then
        raise exception 'zoho_link: service role only' using errcode = '42501';
    end if;
    update public.zoho_link_limits l set attempt_lease_until = null where l.id;
end $$;
revoke execute on function public.zoho_link_attempt_end() from public, anon, authenticated;
grant  execute on function public.zoho_link_attempt_end() to service_role;

-- قبل كل تجديد لمفتاح الوصول: Zoho يسمح بعشرة في 10 دقائق ثم يحظر بقية النافذة، ونحن نقف عند 8.
create or replace function public.zoho_token_refresh_begin(
    p_limit          int default 8,
    p_window_seconds int default 600
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
    v_now    timestamptz := pg_catalog.clock_timestamp();
    v_row    public.zoho_link_limits%rowtype;
    v_recent timestamptz[];
    v_until  timestamptz;
begin
    if pg_catalog.current_setting('role', true) in ('anon', 'authenticated') then
        raise exception 'zoho_link: service role only' using errcode = '42501';
    end if;

    insert into public.zoho_link_limits (id) values (true) on conflict (id) do nothing;
    select l.* into v_row from public.zoho_link_limits l where l.id for update;

    v_recent := array(
        select a from pg_catalog.unnest(v_row.refreshes_at) as a
         where a > v_now - pg_catalog.make_interval(secs => p_window_seconds)
         order by a
    );

    if v_row.blocked_until > v_now then
        v_until := v_row.blocked_until;
    elsif pg_catalog.cardinality(v_recent) >= p_limit then
        v_until := v_recent[1] + pg_catalog.make_interval(secs => p_window_seconds);
    end if;

    if v_until is not null then
        return pg_catalog.jsonb_build_object(
            'allowed', false,
            'wait_seconds', greatest(1, pg_catalog.ceil(extract(epoch from v_until - v_now))::int)
        );
    end if;

    update public.zoho_link_limits l set refreshes_at = v_recent || v_now where l.id;
    return pg_catalog.jsonb_build_object('allowed', true, 'wait_seconds', 0);
end $$;
revoke execute on function public.zoho_token_refresh_begin(int, int) from public, anon, authenticated;
grant  execute on function public.zoho_token_refresh_begin(int, int) to service_role;

-- قال Zoho «Access Denied»: لا طلب رمز ولا تجديد حتى تنقضي نافذته
create or replace function public.zoho_token_denied(p_seconds int default 600)
returns void
language plpgsql security definer set search_path = '' as $$
declare
    v_until timestamptz := pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_seconds);
begin
    if pg_catalog.current_setting('role', true) in ('anon', 'authenticated') then
        raise exception 'zoho_link: service role only' using errcode = '42501';
    end if;
    insert into public.zoho_link_limits as l (id, blocked_until) values (true, v_until)
    on conflict (id) do update set blocked_until = greatest(l.blocked_until, excluded.blocked_until);
end $$;
revoke execute on function public.zoho_token_denied(int) from public, anon, authenticated;
grant  execute on function public.zoho_token_denied(int) to service_role;

-- عدّادان للتشخيص: Zoho يحتفظ بعشرين مفتاحاً لكل عميل ثم يحذف أقدمها ولو كان مستعملاً، فكل مفتاح لم يُبطل يقرّب المفتاح الحي من الحذف
create or replace function public.zoho_link_note_tokens(p_minted int default 0, p_revoke_failed int default 0)
returns void
language plpgsql security definer set search_path = '' as $$
begin
    if pg_catalog.current_setting('role', true) in ('anon', 'authenticated') then
        raise exception 'zoho_link: service role only' using errcode = '42501';
    end if;
    insert into public.zoho_link_limits as l (id, tokens_minted, revoke_failures)
    values (true, greatest(p_minted, 0), greatest(p_revoke_failed, 0))
    on conflict (id) do update set
        tokens_minted   = l.tokens_minted + greatest(p_minted, 0),
        revoke_failures = l.revoke_failures + greatest(p_revoke_failed, 0);
end $$;
revoke execute on function public.zoho_link_note_tokens(int, int) from public, anon, authenticated;
grant  execute on function public.zoho_link_note_tokens(int, int) to service_role;

/* ===================== دوال النقل ===================== */

-- ما تعرضه الصفحة في صف واحد دائماً، ولو لم يبدأ النقل قط
create or replace function public.maqsam_sync_status()
returns table (
    enabled boolean, started_at timestamptz, start_from timestamptz, started_by uuid, last_run_at timestamptz, last_run_code text, needs_reconnect boolean,
    written_total bigint, written_7d bigint, no_match_total bigint, waiting bigint, failed_total bigint, ambiguous_total bigint
)
language plpgsql stable security definer set search_path = '' as $$
begin
    if pg_catalog.current_setting('role', true) in ('anon', 'authenticated') then
        raise exception 'maqsam_sync: service role only' using errcode = '42501';
    end if;

    return query
    select coalesce(s.enabled, false), s.started_at, s.start_from, s.started_by, s.last_run_at, s.last_run_code, coalesce(s.needs_reconnect, false),
           c.n_written, c.n_written_7d, c.n_no_match, c.n_waiting, c.n_failed, c.n_ambiguous
      from (
          select count(*) filter (where k.status = 'written') as n_written,
                 count(*) filter (where k.status = 'written' and k.updated_at >= pg_catalog.now() - interval '7 days') as n_written_7d,
                 count(*) filter (where k.status = 'no_match') as n_no_match,
                 count(*) filter (where k.status = 'waiting') as n_waiting,
                 count(*) filter (where k.status = 'failed') as n_failed,
                 count(*) filter (where k.status = 'written' and k.ambiguous) as n_ambiguous
            from public.maqsam_sync_calls k
      ) c
      left join public.maqsam_sync_state s on s.id;
end $$;
revoke execute on function public.maqsam_sync_status() from public, anon, authenticated;
grant  execute on function public.maqsam_sync_status() to service_role;

-- التشغيل: not_connected إن نقص أحد الربطين (الصف وأسراره، دون فكها)، وneeds_reconnect إن كان المفتاح معطلاً، وalready إن كان يعمل فلا يضيع موضعه.
create or replace function public.maqsam_sync_start(p_start_from timestamptz, p_by uuid)
returns text
language plpgsql security definer set search_path = '' as $$
declare
    v_row public.maqsam_sync_state%rowtype;
begin
    if pg_catalog.current_setting('role', true) in ('anon', 'authenticated') then
        raise exception 'maqsam_sync: service role only' using errcode = '42501';
    end if;
    if p_start_from is null then
        raise exception 'maqsam_sync_start: empty start';
    end if;

    insert into public.maqsam_sync_state (id) values (true) on conflict (id) do nothing;
    select s.* into v_row from public.maqsam_sync_state s where s.id for update;

    if not exists (select 1 from public.zoho_link l where l.id)
       or not exists (select 1 from public.maqsam_link m where m.id)
       or (select count(*) from vault.secrets v where v.name in ('zoho_client_id', 'zoho_client_secret', 'zoho_refresh_token')) <> 3
       or (select count(*) from vault.secrets v where v.name in ('maqsam_access_key_id', 'maqsam_access_secret')) <> 2 then
        return 'not_connected';
    end if;
    if v_row.enabled then
        return 'already';
    end if;
    if v_row.needs_reconnect then
        return 'needs_reconnect';
    end if;

    update public.maqsam_sync_state s
       set enabled = true, started_at = pg_catalog.now(), start_from = p_start_from, started_by = p_by,
           scan_cursor = null, last_run_at = null, last_run_code = null, run_lease_until = null
     where s.id;
    return 'started';
end $$;
revoke execute on function public.maqsam_sync_start(timestamptz, uuid) from public, anon, authenticated;
grant  execute on function public.maqsam_sync_start(timestamptz, uuid) to service_role;

-- الإيقاف: true إن كان يعمل فعلاً. بعد رجوعها لا حجز جديد لدورة (maqsam_sync_claim يقرأ الصف نفسه).
create or replace function public.maqsam_sync_stop()
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
    v_was boolean;
begin
    if pg_catalog.current_setting('role', true) in ('anon', 'authenticated') then
        raise exception 'maqsam_sync: service role only' using errcode = '42501';
    end if;
    select s.enabled into v_was from public.maqsam_sync_state s where s.id for update;
    update public.maqsam_sync_state s set enabled = false, run_lease_until = null where s.id;
    return coalesce(v_was, false);
end $$;
revoke execute on function public.maqsam_sync_stop() from public, anon, authenticated;
grant  execute on function public.maqsam_sync_stop() to service_role;

-- بداية دورة: عقد إيجار قصير يمنع دورتين معاً، فلا يضيع تجديد المفتاح. دورة ماتت في منتصفها ينتهي عقدها قبل الدورة التالية.
create or replace function public.maqsam_sync_run_begin(p_lease_seconds int default 240)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
    v_row public.maqsam_sync_state%rowtype;
    v_now timestamptz := pg_catalog.clock_timestamp();
begin
    if pg_catalog.current_setting('role', true) in ('anon', 'authenticated') then
        raise exception 'maqsam_sync: service role only' using errcode = '42501';
    end if;
    select s.* into v_row from public.maqsam_sync_state s where s.id for update;
    if not found or not v_row.enabled then
        return pg_catalog.jsonb_build_object('started', false, 'reason', 'off');
    end if;
    if v_row.needs_reconnect then
        return pg_catalog.jsonb_build_object('started', false, 'reason', 'needs_reconnect');
    end if;
    if v_row.run_lease_until > v_now then
        return pg_catalog.jsonb_build_object('started', false, 'reason', 'busy');
    end if;
    update public.maqsam_sync_state s
       set run_lease_until = v_now + pg_catalog.make_interval(secs => p_lease_seconds)
     where s.id;
    return pg_catalog.jsonb_build_object('started', true, 'reason', 'ok', 'start_from', v_row.start_from, 'scan_cursor', v_row.scan_cursor);
end $$;
revoke execute on function public.maqsam_sync_run_begin(int) from public, anon, authenticated;
grant  execute on function public.maqsam_sync_run_begin(int) to service_role;

-- نهاية دورة: نتيجتها، والموضع لا يرجع إلى الوراء أبداً. null: توقفت عند سقف أو خطأ، فالدورة التالية تعيد القراءة من الموضع نفسه.
create or replace function public.maqsam_sync_run_end(p_code text, p_cursor timestamptz default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
    if pg_catalog.current_setting('role', true) in ('anon', 'authenticated') then
        raise exception 'maqsam_sync: service role only' using errcode = '42501';
    end if;
    update public.maqsam_sync_state s
       set last_run_at = pg_catalog.now(),
           last_run_code = p_code,
           run_lease_until = null,
           scan_cursor = case when p_cursor is null or s.run_lease_until is null then s.scan_cursor else greatest(s.scan_cursor, p_cursor) end
     where s.id;
end $$;
revoke execute on function public.maqsam_sync_run_end(text, timestamptz) from public, anon, authenticated;
grant  execute on function public.maqsam_sync_run_end(text, timestamptz) to service_role;

-- علامة «يحتاج إعادة ربط» لهذا الربط بعينه: مفتاح قديم أُبطل لأن ربطاً أحدث حل محله لا يضع العلامة على الجديد. false: لم يعد هذا هو الربط القائم.
create or replace function public.maqsam_sync_set_reconnect(p_connected_at timestamptz, p_needs boolean)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
    if pg_catalog.current_setting('role', true) in ('anon', 'authenticated') then
        raise exception 'maqsam_sync: service role only' using errcode = '42501';
    end if;
    if not exists (select 1 from public.zoho_link l where l.id and l.connected_at = p_connected_at) then
        return false;
    end if;
    insert into public.maqsam_sync_state as s (id, needs_reconnect) values (true, coalesce(p_needs, false))
    on conflict (id) do update set needs_reconnect = excluded.needs_reconnect;
    return true;
end $$;
revoke execute on function public.maqsam_sync_set_reconnect(timestamptz, boolean) from public, anon, authenticated;
grant  execute on function public.maqsam_sync_set_reconnect(timestamptz, boolean) to service_role;

-- حجز مكالمة قبل كتابة ملاحظتها، فلا ملاحظتان لمكالمة واحدة. النتيجة outcome:
--   claimed: اكتب الآن. written: كُتبت من قبل، ومعها المعرّفات. busy: يكتبها غيرك الآن. disabled: النقل متوقف (دورة فقط).
--   stale: حجز مضى عليه 30 دقيقة بلا ملاحظة: ابحث في Zoho بالعنوان نفسه أولاً، فإن لم تجده فأعد النداء مع p_takeover.
create or replace function public.maqsam_sync_claim(
    p_call_id          bigint,
    p_module           text,
    p_record_id        text,
    p_require_enabled  boolean default false,
    p_takeover         boolean default false,
    p_stale_minutes    int default 30
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
    v_row public.maqsam_sync_calls%rowtype;
begin
    if pg_catalog.current_setting('role', true) in ('anon', 'authenticated') then
        raise exception 'maqsam_sync: service role only' using errcode = '42501';
    end if;

    -- قفل مشترك: ينتظر إيقافاً جارياً ثم يرى نتيجته، فلا تبدأ كتابة بعد أن رجع الإيقاف
    if p_require_enabled and not coalesce((select s.enabled from public.maqsam_sync_state s where s.id for share), false) then
        return pg_catalog.jsonb_build_object('outcome', 'disabled');
    end if;

    insert into public.maqsam_sync_calls as c (call_id, status, zoho_module, zoho_record_id, attempts)
    values (p_call_id, 'claimed', p_module, p_record_id, 1)
    on conflict (call_id) do nothing;
    if found then
        return pg_catalog.jsonb_build_object('outcome', 'claimed');
    end if;

    select c.* into v_row from public.maqsam_sync_calls c where c.call_id = p_call_id for update;

    if v_row.status = 'written' then
        return pg_catalog.jsonb_build_object('outcome', 'written', 'zoho_module', v_row.zoho_module, 'zoho_record_id', v_row.zoho_record_id, 'zoho_note_id', v_row.zoho_note_id);
    end if;
    if v_row.status = 'claimed' then
        if v_row.updated_at > pg_catalog.clock_timestamp() - pg_catalog.make_interval(mins => p_stale_minutes) then
            return pg_catalog.jsonb_build_object('outcome', 'busy');
        end if;
        if not p_takeover then
            return pg_catalog.jsonb_build_object('outcome', 'stale', 'zoho_module', v_row.zoho_module, 'zoho_record_id', v_row.zoho_record_id);
        end if;
        -- سقف لإعادة المحاولة: مكالمة تتعثر كل مرة تصير «فشلت» وتظهر في العدّاد
        if v_row.attempts >= 5 then
            update public.maqsam_sync_calls c set status = 'failed', next_try_at = null, updated_at = pg_catalog.clock_timestamp() where c.call_id = p_call_id;
            return pg_catalog.jsonb_build_object('outcome', 'busy');
        end if;
    end if;

    update public.maqsam_sync_calls c
       set status = 'claimed', zoho_module = p_module, zoho_record_id = p_record_id, zoho_note_id = null,
           attempts = c.attempts + 1, next_try_at = null, updated_at = pg_catalog.clock_timestamp()
     where c.call_id = p_call_id;
    return pg_catalog.jsonb_build_object('outcome', 'claimed');
end $$;
revoke execute on function public.maqsam_sync_claim(bigint, text, text, boolean, boolean, int) from public, anon, authenticated;
grant  execute on function public.maqsam_sync_claim(bigint, text, text, boolean, boolean, int) to service_role;

-- كُتبت الملاحظة: تُحفظ معرّفاتها على الحجز القائم وحده
create or replace function public.maqsam_sync_written(p_call_id bigint, p_note_id text, p_module text, p_record_id text, p_ambiguous boolean)
returns void
language plpgsql security definer set search_path = '' as $$
begin
    if pg_catalog.current_setting('role', true) in ('anon', 'authenticated') then
        raise exception 'maqsam_sync: service role only' using errcode = '42501';
    end if;
    update public.maqsam_sync_calls c
       set status = 'written', zoho_note_id = p_note_id, zoho_module = p_module, zoho_record_id = p_record_id, ambiguous = coalesce(p_ambiguous, false),
           next_try_at = null, updated_at = pg_catalog.clock_timestamp()
     where c.call_id = p_call_id and c.status = 'claimed';
end $$;
revoke execute on function public.maqsam_sync_written(bigint, text, text, text, boolean) from public, anon, authenticated;
grant  execute on function public.maqsam_sync_written(bigint, text, text, text, boolean) to service_role;

-- تأكد أن الملاحظة لم تُكتب: يعود الحجز إلى الانتظار، وبعد 3 محاولات محسوبة يصير failed. p_count = false: السبب ليس في الملاحظة (429 مثلاً) فلا تُحسب.
-- لا تُنادى إن كانت النتيجة مجهولة (انقطع الرد): يبقى الحجز حتى يفصل فيه البحث بالعنوان بعد 30 دقيقة. تعيد الحالة الجديدة.
create or replace function public.maqsam_sync_release(
    p_call_id       bigint,
    p_count         boolean default true,
    p_retry_minutes int default 60,
    p_max_attempts  int default 3
) returns text
language plpgsql security definer set search_path = '' as $$
declare
    v_row      public.maqsam_sync_calls%rowtype;
    v_attempts integer;
begin
    if pg_catalog.current_setting('role', true) in ('anon', 'authenticated') then
        raise exception 'maqsam_sync: service role only' using errcode = '42501';
    end if;
    select c.* into v_row from public.maqsam_sync_calls c where c.call_id = p_call_id for update;
    if not found or v_row.status <> 'claimed' then
        return null;
    end if;
    v_attempts := case when p_count then v_row.attempts else greatest(v_row.attempts - 1, 0) end;
    if v_attempts >= p_max_attempts then
        update public.maqsam_sync_calls c
           set status = 'failed', attempts = v_attempts, next_try_at = null, updated_at = pg_catalog.clock_timestamp()
         where c.call_id = p_call_id;
        return 'failed';
    end if;
    update public.maqsam_sync_calls c
       set status = 'waiting', attempts = v_attempts, next_try_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(mins => p_retry_minutes),
           updated_at = pg_catalog.clock_timestamp()
     where c.call_id = p_call_id;
    return 'waiting';
end $$;
revoke execute on function public.maqsam_sync_release(bigint, boolean, int, int) from public, anon, authenticated;
grant  execute on function public.maqsam_sync_release(bigint, boolean, int, int) to service_role;

-- مكالمة لا تحتاج كتابة الآن: تنتظر ملخصاً أو عميلاً، أو انتهى انتظارها. لا تغيّر إلا مكالمة تنتظر: ما كُتب وما حُجز وما انتهى يبقى كما هو.
create or replace function public.maqsam_sync_mark(p_call_id bigint, p_status text, p_next_try_at timestamptz default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
    if pg_catalog.current_setting('role', true) in ('anon', 'authenticated') then
        raise exception 'maqsam_sync: service role only' using errcode = '42501';
    end if;
    if p_status not in ('waiting', 'no_match', 'no_summary') then
        raise exception 'maqsam_sync_mark: bad status';
    end if;
    insert into public.maqsam_sync_calls as c (call_id, status, next_try_at)
    values (p_call_id, p_status, p_next_try_at)
    on conflict (call_id) do update
       set status = excluded.status, next_try_at = excluded.next_try_at, updated_at = pg_catalog.clock_timestamp()
     where c.status = 'waiting';
end $$;
revoke execute on function public.maqsam_sync_mark(bigint, text, timestamptz) from public, anon, authenticated;
grant  execute on function public.maqsam_sync_mark(bigint, text, timestamptz) to service_role;

/* ===================== المُجدوِل ===================== */

-- تتحقق وظيفة maqsam-sync من السر الذي وصلها، والمقارنة هنا فلا يغادر السر القاعدة (كما agent_cron_secret_ok).
-- تجيب عن السر نفسه، فالفحصان معاً كما في zoho_link_credentials.
create or replace function public.maqsam_sync_cron_secret_ok(p_secret text)
returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
    if pg_catalog.current_setting('role', true) in ('anon', 'authenticated') then
        raise exception 'maqsam_sync: service role only' using errcode = '42501';
    end if;
    if auth.role() is distinct from 'service_role' then
        raise exception 'maqsam_sync: service role only' using errcode = '42501';
    end if;
    return coalesce(p_secret is not null and length(p_secret) >= 32 and exists (
        select 1 from vault.decrypted_secrets s where s.name = 'maqsam_sync_cron_secret' and s.decrypted_secret = p_secret
    ), false);
end $$;
revoke execute on function public.maqsam_sync_cron_secret_ok(text) from public, anon, authenticated;
grant  execute on function public.maqsam_sync_cron_secret_ok(text) to service_role;

-- كل خمس دقائق: تنادي maqsam-sync ما دام النقل مفعّلاً، ولا تنادي شيئاً وهو متوقف أو يحتاج إعادة ربط، فلا تكلّف شيئاً.
-- يشغّلها pg_cron بدور صاحبها، فلا تُمنح لأحد. الرابط ليس سراً (منشور في js/config.js وفي 020).
create or replace function public.maqsam_sync_cron_tick()
returns void
language plpgsql security definer set search_path = '' as $$
declare
    v_secret text;
begin
    if pg_catalog.current_setting('role', true) in ('anon', 'authenticated') then
        raise exception 'maqsam_sync: service role only' using errcode = '42501';
    end if;
    if not exists (select 1 from public.maqsam_sync_state s where s.id and s.enabled and not s.needs_reconnect) then
        return;
    end if;
    select d.decrypted_secret::text into v_secret from vault.decrypted_secrets d where d.name = 'maqsam_sync_cron_secret';
    if v_secret is null then
        return;
    end if;
    perform net.http_post(
        url     := 'https://niykzsspdehexphewlxa.supabase.co/functions/v1/maqsam-sync',
        headers := pg_catalog.jsonb_build_object('Content-Type', 'application/json', 'x-maqsam-sync-cron', v_secret),
        body    := pg_catalog.jsonb_build_object('action', 'tick'),
        timeout_milliseconds := 5000
    );
end $$;
revoke execute on function public.maqsam_sync_cron_tick() from public, anon, authenticated, service_role;

-- سر المُجدوِل: قيمة عشوائية في Vault، لا في المستودع ولا في إعدادات الوظيفة، تُنشأ مرة واحدة كما في 020. يتخطاها النسخة المؤقتة (انظر رأس الملف).
do $$
begin
    if not exists (select 1 from public.mulaem_migrations) then
        raise notice 'maqsam_sync: empty ledger, this is the schema-only copy: no secret here';
        return;
    end if;
    if not exists (select 1 from vault.secrets where name = 'maqsam_sync_cron_secret') then
        perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'maqsam_sync_cron_secret',
                                    'يرسله pg_cron إلى وظيفة maqsam-sync');
    end if;
end $$;

-- كما في 020: الحذف من cron.job لا cron.unschedule('الاسم') الذي يخطئ إن لم تكن المهمة موجودة، فيصح أول مرة وكل مرة.
do $$
begin
    if not exists (select 1 from public.mulaem_migrations) then
        raise notice 'maqsam_sync: empty ledger, this is the schema-only copy: no job here';
        return;
    end if;
    perform cron.unschedule(jobid) from cron.job where jobname = 'maqsam-sync-tick';
    perform cron.schedule('maqsam-sync-tick', '*/5 * * * *', 'select public.maqsam_sync_cron_tick()');
end $$;
