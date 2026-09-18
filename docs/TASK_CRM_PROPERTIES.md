# Task: CRM round 3 — read-only properties page inside the CRM

Same hard rules as the previous tasks (everything under `crm/`; `el()`/`textContent` only; `.range()` pagination;
Arabic errors via `errorText`). One commit, push at the end, run the headless-Chrome harness for the new route and
delete the harness files before pushing.

## Why

Staff open the CRM and ask "where are the projects?". The inventory still lives in the legacy dashboard (which is
where it is edited), but the CRM must let staff browse it without leaving. This page is read-only.

## Route `#/properties` (nav item "العقارات", visible to every role)

Data source: the view `v_units` (RLS-aware; one row per unit model, plus one row `unit_key = 'كامل العقار'` for
projects without unit models). Columns available: `project_id, project_name, project_type, purpose, city, district,
district_inferred, status, availability, deleted_at, listing_expires_at, latitude, longitude, construction_status,
unit_ord, unit_key, unit_type, rooms, bathrooms, area, price, unit_count, unit_status`.

1. Filters row: search by project name (`.ilike('project_name', '%q%')`), district select (from `crm_districts()`),
   unit type select (from `crm_property_types()`), rooms ≥, price from/to (money inputs, Arabic digits accepted),
   and a checkbox "المتاح فقط" (default on: `unit_status = 'available'` and `availability = 'available'` and
   `status = 'approved'` and `deleted_at is null`).
2. Results table, `.range()` page size 25, ordered by `project_name, unit_ord`: project (name + id), unit, type,
   district (+ "مستنتج" badge), rooms, baths, area, price, construction status, unit status badge. Show the total
   count from the query (`{ count: 'exact' }`).
3. Row actions: "فتح صفقة" (opens the existing deal form prefilled with project_id/unit_key; hidden for callcenter)
   and "نسخ الوصف" which copies a short Arabic text of the row to the clipboard (project name, unit, district,
   rooms, area, price) — plain `navigator.clipboard.writeText`, no messaging integration.
4. A note under the title: "التعديل على العقارات يتم من اللوحة" with a link to `../index.html`.

Also: on the deals board cards and the deal page header, show the project name (join `project:projects(name)`),
not only the id, if not already the case.

## Finish

Push and report the commit hash and the harness result.
