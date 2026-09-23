-- روابط عروض العملاء: وصول عام محدود بزمن ومربوط بطلب واحد فقط.

create table if not exists public.client_share_links (
    id             uuid primary key default gen_random_uuid(),
    token          text not null unique default encode(gen_random_bytes(24), 'hex'),
    client_id      uuid not null references public.clients(id) on delete cascade,
    requirement_id uuid not null references public.client_requirements(id) on delete cascade,
    created_by     uuid not null references public.profiles(id),
    expires_at     timestamptz not null default (now() + interval '14 days'),
    revoked_at     timestamptz,
    created_at     timestamptz not null default now()
);
create index if not exists client_share_links_token_idx on public.client_share_links (token);
create index if not exists client_share_links_requirement_idx on public.client_share_links (requirement_id);

alter table public.client_share_links enable row level security;
revoke all on public.client_share_links from anon;
revoke all on public.client_share_links from authenticated;
grant select, insert, update on public.client_share_links to authenticated;

drop policy if exists client_share_links_select on public.client_share_links;
create policy client_share_links_select on public.client_share_links for select to authenticated
using (public.is_admin() or created_by = (select auth.uid()) or public.crm_can_see_client(client_id));
drop policy if exists client_share_links_insert on public.client_share_links;
create policy client_share_links_insert on public.client_share_links for insert to authenticated
with check (public.crm_can_see_client(client_id));
drop policy if exists client_share_links_update on public.client_share_links;
create policy client_share_links_update on public.client_share_links for update to authenticated
using (public.is_admin() or created_by = (select auth.uid()))
with check (public.is_admin() or created_by = (select auth.uid()));

create or replace function public.create_client_share(p_client uuid, p_requirement uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
    v_token text;
begin
    if auth.uid() is null or not public.crm_can_see_client(p_client) then
        raise exception 'غير مصرح';
    end if;
    if not exists (
        select 1 from public.client_requirements r
        where r.id = p_requirement and r.client_id = p_client
    ) then
        raise exception 'الطلب غير موجود';
    end if;
    insert into public.client_share_links (client_id, requirement_id, created_by)
    values (p_client, p_requirement, auth.uid())
    returning token into v_token;
    return v_token;
end $$;
revoke execute on function public.create_client_share(uuid, uuid) from public, anon;
grant execute on function public.create_client_share(uuid, uuid) to authenticated;

create or replace function public.get_client_share(p_token text)
returns jsonb
language sql security definer set search_path = public as $$
    select jsonb_build_object(
        'client_name', c.full_name,
        'created_at', s.created_at,
        'expires_at', s.expires_at,
        'properties', coalesce((
            select jsonb_agg(jsonb_build_object(
                'project_id', u.project_id,
                'project_name', u.project_name,
                'unit_key', u.unit_key,
                'unit_type', u.unit_type,
                'district', u.district,
                'rooms', u.rooms,
                'bathrooms', u.bathrooms,
                'area', u.area,
                'price', u.price,
                'construction_status', u.construction_status,
                'unit_status', u.unit_status
            ) order by u.project_name, u.unit_ord), '[]'::jsonb)
            from public.property_matches m
            join public.v_units u on u.project_id = m.project_id
                and (m.unit_key is null or u.unit_key = m.unit_key)
            where m.requirement_id = s.requirement_id
              and m.state in ('shared', 'interested', 'viewing')
              and u.unit_status = 'available'
              and u.availability = 'available'
              and u.status = 'approved'
              and u.deleted_at is null
        ), '[]'::jsonb)
    )
    from public.client_share_links s
    join public.clients c on c.id = s.client_id
    where s.token = p_token
      and s.revoked_at is null
      and s.expires_at > now();
$$;
revoke execute on function public.get_client_share(text) from public, authenticated;
grant execute on function public.get_client_share(text) to anon;
