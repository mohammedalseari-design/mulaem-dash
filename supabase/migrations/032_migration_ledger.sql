-- 032: سجل تحديثات القاعدة المطبّقة. يكتبه إجراء migrate في GitHub بعد كل تحديث يوافق عليه المالك، فلا لصق بعد اليوم.
--
-- اسم الملف مفتاحه، ومعه بصمته (sha256) كما طُبّق، ووقته، ومن طبّقه. ما طُبّق قبل هذا السجل (001 إلى 031، باللصق
-- في محرر Supabase) يُسجَّل «baseline» بلا بصمة. لا يقرؤه ولا يكتبه أحد من الواجهة: RLS بلا سياسات، والإجراء
-- يتصل بالقاعدة مباشرة برابط النسخ الاحتياطي (SUPABASE_DB_URL). تطبيقه مرة ثانية لا يغيّر شيئاً.

create table if not exists public.mulaem_migrations (
    name       text primary key check (name ~ '^[0-9]{3}_[a-z0-9_]+[.]sql$'),
    sha256     text,
    applied_at timestamptz not null default now(),
    applied_by text not null default 'manual'
);
alter table public.mulaem_migrations enable row level security;
revoke all on public.mulaem_migrations from public, anon, authenticated;

insert into public.mulaem_migrations (name, applied_by) values
    ('001_init.sql', 'baseline'),
    ('002_harden_function_privileges.sql', 'baseline'),
    ('003_tune_rls_policies.sql', 'baseline'),
    ('004_inventory_normalization.sql', 'baseline'),
    ('005_crm_core.sql', 'baseline'),
    ('006_inventory_quality.sql', 'baseline'),
    ('007_deals_commissions.sql', 'baseline'),
    ('008_price_sanity.sql', 'baseline'),
    ('009_hardening.sql', 'baseline'),
    ('010_keepalive.sql', 'baseline'),
    ('011_agent_core.sql', 'baseline'),
    ('012_client_share_links.sql', 'baseline'),
    ('013_property_price_alerts.sql', 'baseline'),
    ('014_inventory_priority.sql', 'baseline'),
    ('015_demand_gap.sql', 'baseline'),
    ('016_dashboard_data_prep.sql', 'baseline'),
    ('017_unit_commission.sql', 'baseline'),
    ('018_unit_search_fields.sql', 'baseline'),
    ('019_project_import_approval.sql', 'baseline'),
    ('020_agent_run.sql', 'baseline'),
    ('021_unit_commission_edit.sql', 'baseline'),
    ('022_agent_router.sql', 'baseline'),
    ('023_agent_router_resume.sql', 'baseline'),
    ('024_agent_daily_cap_by_role.sql', 'baseline'),
    ('025_agent_twin_links_and_pick_reset.sql', 'baseline'),
    ('026_wa_triage.sql', 'baseline'),
    ('027_district_norm.sql', 'baseline'),
    ('028_agent_url_sources.sql', 'baseline'),
    ('029_client_share_details.sql', 'baseline'),
    ('030_unit_holds.sql', 'baseline'),
    ('031_unwon_commission.sql', 'baseline')
on conflict (name) do nothing;
