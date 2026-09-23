-- 019_project_import_approval — يسمح للمدير بإرسال الاستيراد إلى طابور الاعتماد.
-- الإدخال العادي للمدير يبقى معتمداً، أما status = pending الصريح فيُحترم.
create or replace function public.projects_guard() returns trigger
language plpgsql security definer set search_path = public as
$$
declare
    v_role text;
    v_user text;
    v_full text;
begin
    if auth.uid() is null then
        return new;
    end if;

    select p.role, p.username, p.fullname into v_role, v_user, v_full
    from public.profiles p where p.id = auth.uid() and not p.is_blocked;
    if v_role is null then raise exception 'غير مصرح'; end if;

    if tg_op = 'INSERT' then
        new.added_by         := v_user;
        new.employee         := coalesce(v_full, v_user);
        new.date_added       := now() at time zone 'Asia/Riyadh';
        new.rejection_reason := null;
        new.deleted_at       := null;
        new.status           := case
            when v_role = 'admin' and new.status = 'pending' then 'pending'
            when v_role = 'admin' then 'approved'
            else 'pending'
        end;
    else
        new.id         := old.id;
        new.added_by   := old.added_by;
        new.date_added := old.date_added;
        if v_role <> 'admin' then
            new.employee         := old.employee;
            new.status           := 'pending';
            new.rejection_reason := null;
        end if;
    end if;
    return new;
end
$$;