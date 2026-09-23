-- سجل تغيّر الأسعار والتنبيهات الإدارية.

create table if not exists public.project_price_changes (
    id         bigint generated always as identity primary key,
    project_id integer not null references public.projects(id) on delete cascade,
    old_price  numeric(14,2),
    new_price  numeric(14,2),
    changed_by uuid references public.profiles(id),
    changed_at timestamptz not null default now()
);
create index if not exists project_price_changes_recent_idx on public.project_price_changes (changed_at desc, project_id);

create or replace function public.log_project_price_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    if new.price is distinct from old.price then
        insert into public.project_price_changes (project_id, old_price, new_price, changed_by)
        values (new.id, old.price, new.price, auth.uid());
    end if;
    return new;
end $$;
revoke execute on function public.log_project_price_change() from public, anon, authenticated;
drop trigger if exists projects_price_change_log on public.projects;
create trigger projects_price_change_log after update of price on public.projects
for each row execute function public.log_project_price_change();

alter table public.project_price_changes enable row level security;
revoke all on public.project_price_changes from anon, authenticated;
grant select on public.project_price_changes to authenticated;
drop policy if exists project_price_changes_admin_select on public.project_price_changes;
create policy project_price_changes_admin_select on public.project_price_changes for select to authenticated
using (public.is_admin());

drop view if exists public.v_price_alerts;
create view public.v_price_alerts
with (security_invoker = true) as
select
    h.id,
    h.project_id,
    p.name,
    p.type,
    p.district,
    h.old_price,
    h.new_price,
    case
        when h.old_price is null or h.old_price = 0 then null
        else round(((h.new_price - h.old_price) / h.old_price) * 100, 2)
    end as change_percent,
    h.changed_at
from public.project_price_changes h
join public.projects p on p.id = h.project_id
where h.changed_at >= now() - interval '30 days';

revoke all on public.v_price_alerts from anon, authenticated;
grant select on public.v_price_alerts to authenticated;
