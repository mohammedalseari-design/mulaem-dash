-- تجهيز بيانات التقارير: حداثة العقار وزمن الاعتماد وسجل حالات المشاريع.
-- لا يغيّر واجهة Dashboard الحالية؛ يضيف بيانات زمنية للمرحلة التالية.

alter table public.projects
    add column if not exists updated_at  timestamptz not null default now(),
    add column if not exists approved_at timestamptz,
    add column if not exists reviewed_by uuid references public.profiles(id);

create index if not exists projects_updated_at_idx on public.projects (updated_at desc);
create index if not exists projects_status_updated_idx on public.projects (status, updated_at desc);
create index if not exists projects_approved_at_idx on public.projects (approved_at desc);

create table if not exists public.project_status_history (
    id         bigint generated always as identity primary key,
    project_id integer not null references public.projects(id) on delete cascade,
    old_status text,
    new_status text not null,
    actor_id   uuid references public.profiles(id),
    changed_at timestamptz not null default now()
);
create index if not exists project_status_history_project_idx on public.project_status_history (project_id, changed_at desc);
create index if not exists project_status_history_changed_idx on public.project_status_history (changed_at desc);

alter table public.project_status_history enable row level security;
revoke all on public.project_status_history from anon;
grant select on public.project_status_history to authenticated;
drop policy if exists project_status_history_admin_select on public.project_status_history;
create policy project_status_history_admin_select on public.project_status_history for select to authenticated
using (public.is_admin());

create or replace function public.projects_reporting_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
    v_uid uuid := auth.uid();
begin
    if tg_op = 'INSERT' then
        new.updated_at := now();
        if new.status = 'approved' then
            new.approved_at := coalesce(new.approved_at, now());
            new.reviewed_by := coalesce(new.reviewed_by, v_uid);
        end if;
        return new;
    end if;

    new.updated_at := now();
    if new.status is distinct from old.status then
        if new.status = 'approved' then
            new.approved_at := now();
            new.reviewed_by := v_uid;
        elsif new.status = 'pending' then
            new.approved_at := null;
            new.reviewed_by := null;
        end if;
    else
        new.approved_at := old.approved_at;
        new.reviewed_by := old.reviewed_by;
    end if;
    return new;
end $$;
revoke execute on function public.projects_reporting_guard() from public, anon, authenticated;
drop trigger if exists projects_reporting_guard on public.projects;
create trigger projects_reporting_guard before insert or update on public.projects
for each row execute function public.projects_reporting_guard();

create or replace function public.log_project_status_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if tg_op = 'INSERT' or new.status is distinct from old.status then
        insert into public.project_status_history (project_id, old_status, new_status, actor_id)
        values (new.id, case when tg_op = 'INSERT' then null else old.status end, new.status, auth.uid());
    end if;
    return new;
end $$;
revoke execute on function public.log_project_status_change() from public, anon, authenticated;
drop trigger if exists projects_status_history_log on public.projects;
create trigger projects_status_history_log after insert or update of status on public.projects
for each row execute function public.log_project_status_change();
