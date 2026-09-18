# Task: one shell for the dashboard and the CRM (shared header + shared navigation)

Same hard rules as the previous tasks: `el()`/`textContent` only inside `crm/`, no innerHTML with data, `.range()`
pagination untouched, Arabic errors via `errorText`. This round touches the legacy `index.html` and `css/style.css`
in a limited, explicitly listed way. **Do not touch `js/script.js`, `js/supabase-shim.js`, or the map/projects
markup.** One commit per group, push at the end, run the headless-Chrome harness for both pages and delete the
harness files before pushing.

## Why

The owner opened `crm/#/properties` and asked "why is this separate from the dashboard?". The two pages already share
the design system (`crm.css` imports `../css/style.css`) and the login session (`storageKey: 'mulaem-auth'`), but
they have different headers and different navigation, so they feel like two products. Target: one header and one
navigation bar that look and behave the same on both pages, so staff move between المشاريع والخريطة, العملاء,
العقارات, الصفقات… from one place with one login. A preview the owner approved is described below.

## 0. Record the DB migration (commit: "DB: price sanity in v_units")

`supabase/migrations/008_price_sanity.sql` is already applied to the live project (migration name `price_sanity`).
It makes `v_units.price`/`area` NULL when the stored value is not positive (40 units had price 0, which rendered as
"0" on the properties page and scored full budget points in `match_requirement`), and adds the issue
'وحدات بلا سعر' to `v_inventory_attention`. Just commit the file. No UI change is needed for the properties page:
`money(null)` already renders "—" and `describe()` already skips null prices. **Do not change `money()` in
`ui.js`** — commissions must keep showing a real 0 for `collected_amount`.

## 1. Shared navigation styles (commit: "Shell: shared nav styles")

- Move the `.crm-nav` block (the `.crm-nav`, `.crm-nav a`, `:hover`, `.active` rules) from `crm/crm.css` to the end
  of `css/style.css` under a comment `/* =============== Shared navigation (dashboard + CRM) =============== */`.
  Keep the selector name `.crm-nav` so nothing in `crm/` changes. Also move `.crm-brand`, `.crm-logo` and the
  `.user-badge small` rule there, since the header becomes shared too.
- Add `.crm-nav a.nav-ext` (no visual difference; marker for links that leave the current page) — optional.

## 2. Navigation bar on the legacy dashboard (commit: "Dashboard: shared navigation bar")

In `index.html`, directly **after** the closing tag of the `<div class="header">…</div>` block and before
`<div class="admin-dashboard" …>`, add exactly:

```html
<nav class="crm-nav" id="mainNav">
    <a href="index.html" class="active">المشاريع والخريطة</a>
    <a href="crm/#/work">عملي اليوم</a>
    <a href="crm/#/clients">العملاء</a>
    <a href="crm/#/properties">العقارات</a>
    <a href="crm/#/deals" data-deny="callcenter">الصفقات</a>
    <a href="crm/#/commissions" data-admin="1">العمولات</a>
    <a href="crm/#/dashboard" data-admin="1">لوحة الإدارة</a>
    <a href="crm/#/inventory" data-admin="1">جودة المخزون</a>
    <a href="crm/#/settings" data-admin="1">الإعدادات</a>
</nav>
```

- Remove the anchor `<a href="crm/" class="logout-btn" …>إدارة العملاء</a>` from the header (the nav replaces it).
- The nav lives inside `#appContainer`, which is hidden until login, so the login screen shows no nav. Verify that.
- Role visibility without touching `script.js`: add a new file `js/nav.js` (classic script, loaded after
  `js/supabase-shim.js` and before `js/script.js`) that:
  1. hides every `[data-admin]` and `[data-deny]` link by default (`hidden` attribute),
  2. waits for a session (`window.mulaemSupabase.auth.getSession()` — the shim exposes the client as
     `window.mulaemSupabase`; if the name differs, read it from `js/supabase-shim.js` and use that), then reads
     `profiles.role` for `auth.uid()` with `.select('role').eq('id', user.id).maybeSingle()`,
  3. shows `[data-admin]` links only for `admin`, and `[data-deny="callcenter"]` links for every role except
     `callcenter`,
  4. re-runs on `onAuthStateChange` (the user may log in after the page loaded) and never throws — on any error the
     admin links simply stay hidden (the CRM guards the routes anyway).
  Keep it under 60 lines, no innerHTML, no DOM outside `#mainNav`.

## 3. Shared header in the CRM (commit: "CRM: shared header and dashboard link")

- In `crm/index.html`, make the header markup identical to the dashboard's header: `div.header > div.header-content >
  div.header-brand > img.header-logo + div(h1 "نظام ملائم العقاري", p "إدارة العملاء")`, then `div.user-info` with
  `#userBadge` and `#logoutBtn` (keep the ids the JS uses). Drop `.crm-brand`/`.crm-logo` from the markup if the
  legacy classes cover it; keep `../images/logo.jpg`.
- In `crm/js/app.js`, the nav gets a first item `{ href: '../index.html', label: 'المشاريع والخريطة', external: true }`
  rendered as a plain link (never `active`, never intercepted by the hash router). All other items and role rules
  unchanged (`deny: 'callcenter'`, `admin: true`).
- Keep the CRM's login screen as is.

## 4. Acceptance (write results in the final report)

1. Logged in as admin on `index.html`: nav shows 9 items, "المشاريع والخريطة" is highlighted; clicking "العملاء" opens
   `crm/#/clients` **without a second login**; the CRM header looks the same as the dashboard header; the first CRM
   nav item returns to `index.html`.
2. Logged in as `field`: `index.html` shows 5 items (no admin items); as `callcenter`: 4 items (no الصفقات, no admin
   items). Use the harness with the three roles as before.
3. Logged-out `index.html`: login screen only, no nav.
4. `crm/#/properties` still lists 622 units and no row shows a price of "0" (62 rows show "—").

## Finish

Push and report the commit hashes, the harness result, and what could not be verified.
