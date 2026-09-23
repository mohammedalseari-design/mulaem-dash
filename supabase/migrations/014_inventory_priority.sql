-- أولوية عرض العقار: اكتمال البيانات وحداثتها، بلا تخمينات سوقية.

drop view if exists public.v_inventory_priority;
create view public.v_inventory_priority
with (security_invoker = true) as
select
    p.id,
    p.name,
    p.type,
    p.district,
    p.price,
    p.employee,
    p.date_added,
    p.listing_expires_at,
    p.rega_ad_license,
    round((
        (
            (case when nullif(btrim(p.name), '') is not null then 1 else 0 end)
          + (case when nullif(btrim(p.type), '') is not null then 1 else 0 end)
          + (case when p.price is not null and p.price > 0 then 1 else 0 end)
          + (case when p.area is not null and p.area > 0 then 1 else 0 end)
          + (case when nullif(btrim(p.address), '') is not null then 1 else 0 end)
          + (case when nullif(btrim(p.district), '') is not null and not coalesce(p.district_inferred, false) then 1 else 0 end)
          + (case when nullif(btrim(p.rega_ad_license), '') is not null then 1 else 0 end)
          + (case when p.listing_expires_at is not null then 1 else 0 end)
          + (case when jsonb_array_length(coalesce(p.images, '[]'::jsonb)) > 0 then 1 else 0 end)
          + (case when p.latitude is not null and p.longitude is not null then 1 else 0 end)
        ) * 10
    ), 0) as completeness_score,
    round((
        (
            (
                (case when nullif(btrim(p.name), '') is not null then 1 else 0 end)
              + (case when nullif(btrim(p.type), '') is not null then 1 else 0 end)
              + (case when p.price is not null and p.price > 0 then 1 else 0 end)
              + (case when p.area is not null and p.area > 0 then 1 else 0 end)
              + (case when nullif(btrim(p.address), '') is not null then 1 else 0 end)
              + (case when nullif(btrim(p.district), '') is not null and not coalesce(p.district_inferred, false) then 1 else 0 end)
              + (case when nullif(btrim(p.rega_ad_license), '') is not null then 1 else 0 end)
              + (case when p.listing_expires_at is not null then 1 else 0 end)
              + (case when jsonb_array_length(coalesce(p.images, '[]'::jsonb)) > 0 then 1 else 0 end)
              + (case when p.latitude is not null and p.longitude is not null then 1 else 0 end)
            ) * 10 * 0.6
        ) + (
            greatest(0, least(100, 100 - extract(epoch from ((now() at time zone 'Asia/Riyadh') - p.date_added)) / 86400 / 90 * 100)) * 0.4
        )
    ), 0) as priority_score
from public.projects p
where p.status = 'approved' and p.deleted_at is null;

revoke all on public.v_inventory_priority from anon;
grant select on public.v_inventory_priority to authenticated;
