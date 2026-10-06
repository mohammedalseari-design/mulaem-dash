-- 029: صفحة العروض للعميل — صورة العقار وموقعه، واسم الوسيط، وزر «أنا مهتم» إلى واتساب المكتب.
--
-- get_client_share تعيد ما كانت تعيده كما هو، وتزيد عليه:
--   * لكل عقار: image (أول صورة للمشروع تبدأ بـ https:// فقط، كما يقبلها js/script.js)، و latitude/longitude.
--   * على مستوى الرابط: broker_name (اسم من أنشأ الرابط)، و office_whatsapp (crm_settings، يضبطه المدير من «الإعدادات»).
-- لا جدول جديد ولا صلاحية جديدة: الدالة نفسها (security definer، للزائر anon وحده) والشروط نفسها على الوحدات المتاحة.
--
-- الترتيب: الواجهة تعرض الحقول الجديدة إن وُجدت وتتجاهل غيابها، فتطبيق الهجرة قبل الدفع أو بعده آمن،
-- وإعادة تطبيقها لا تغيّر شيئاً.

insert into public.crm_settings (key, value) values ('office_whatsapp', '""')
on conflict (key) do nothing;

create or replace function public.get_client_share(p_token text)
returns jsonb
language sql security definer set search_path = public as $$
    select jsonb_build_object(
        'client_name', c.full_name,
        'created_at', s.created_at,
        'expires_at', s.expires_at,
        'broker_name', (select pr.fullname from public.profiles pr where pr.id = s.created_by),
        'office_whatsapp', (
            select nullif(btrim(st.value #>> '{}'), '')
              from public.crm_settings st
             where st.key = 'office_whatsapp' and jsonb_typeof(st.value) = 'string'
        ),
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
                'unit_status', u.unit_status,
                'image', (
                    select img.value #>> '{}'
                      from jsonb_array_elements(case when jsonb_typeof(p.images) = 'array' then p.images else '[]'::jsonb end)
                           with ordinality as img(value, ord)
                     where jsonb_typeof(img.value) = 'string' and left(img.value #>> '{}', 8) = 'https://'
                     order by img.ord
                     limit 1
                ),
                'latitude', p.latitude,
                'longitude', p.longitude
            ) order by u.project_name, u.unit_ord)
            from public.property_matches m
            join public.v_units u on u.project_id = m.project_id
                and (m.unit_key is null or u.unit_key = m.unit_key)
            join public.projects p on p.id = u.project_id
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
