# نظام ملائم العقاري — لوحة المشاريع (mulaem-dash)

واجهة النظام كما كانت في `dash.mulaem.sa`، مع استبدال الباك-إند القديم (PHP + MySQL على GoDaddy) بـ **Supabase**، واستضافة الواجهة كملفات ثابتة (GitHub Pages أو أي استضافة ثابتة).

## لماذا التغيير

الـAPI القديم كان يرد على أي طلب بدون تسجيل دخول (الجلسة في المتصفح فقط). هنا كل التحقق والصلاحيات في السيرفر:
تسجيل الدخول عبر Supabase Auth، والصلاحيات عبر Row Level Security، وإدارة الحسابات عبر دالة خاصة بالمدير.

## محتوى المستودع

| المسار | الوصف |
|---|---|
| `index.html` | الصفحة (SPA) — أضيف لها تحميل مكتبة Supabase وملفي `config.js` و`supabase-shim.js`، وحُذف سكربت تتبّع GoDaddy |
| `css/style.css`, `images/logo.jpg` | بدون تغيير |
| `js/script.js` | منطق الواجهة الأصلي **بدون أي تعديل** (ما زال ينادي `api/*.php`) |
| `js/supabase-shim.js` | يعترض نداءات `api/*.php` ويحوّلها إلى Supabase ويرجع نفس شكل الردود القديمة |
| `js/config.js` | رابط المشروع والمفتاح العام (آمن للنشر). **لا يوضع فيه مفتاح الخدمة أبداً** |
| `supabase/migrations/001_init.sql` | الجداول + RLS + المشغّلات + حاوية الصور |
| `supabase/functions/admin-users/` | دالة Edge لإنشاء الموظفين وتغيير كلمات المرور والحظر والحذف (للمدير فقط) |
| `supabase/functions/agent-run/` | دالة Edge للمساعد الذكي (الجولة B): تقرأ مرفقات الطلب من المخزن الخاص، تستخرج الحقول بـ Claude بمخطط JSON صارم، تتحقق منها مستقلاً، وتكتب مسودات فقط. تعمل خلف `ANTHROPIC_API_KEY` (سر في Supabase، لا في المستودع)؛ بدونه تُظهر «الاستخراج التلقائي غير مفعّل» ويفشل الطلب بهذا السبب |

## الصلاحيات (مفروضة في قاعدة البيانات)

| الدور | يرى | يضيف | يعدّل / يحذف |
|---|---|---|---|
| `admin` | كل المشاريع + المستخدمين + سجل النشاط | نعم (يُعتمد مباشرة) | كل شيء، ويعتمد/يرفض |
| `field` | المعتمد + مشاريعه هو | نعم (يدخل "معلق" حتى يعتمده المدير) | مشاريعه فقط (التعديل يعيدها "معلق")، ويحذف غير المعتمد منها |
| `callcenter` | المعتمد فقط | لا | لا |
| حساب معطَّل | لا شيء | لا | لا |

صاحب المشروع وحالته واسم الموظف في سجل النشاط يحددها السيرفر من هوية الحساب، ولا يُقبل ما يرسله المتصفح.

## التشغيل من الصفر

1. أنشئ مشروع Supabase، ثم نفّذ `supabase/migrations/001_init.sql` في SQL Editor.
2. استورد البيانات (ملف `002_import_data.sql` — غير موجود في المستودع عمداً لأنه بيانات عمل).
3. انشر الدالتين: `supabase functions deploy admin-users` و`supabase functions deploy agent-run --no-verify-jwt` (الثانية تتحقق من الهوية داخلها: رمز جلسة المستخدم، أو سر pg_cron من Vault).
   ثم ضع مفتاح Anthropic سراً: `supabase secrets set ANTHROPIC_API_KEY=...` — قبل ذلك يعمل كل شيء إلا الاستخراج نفسه.
4. ضع رابط المشروع والمفتاح العام في `js/config.js`.
5. أنشئ أول مدير: من Authentication ← Add user، بإيميل بصيغة `username@users.mulaem.sa`، ثم:
   ```sql
   insert into profiles (id, username, fullname, role)
   select id, 'username', 'الاسم الكامل', 'admin' from auth.users where email = 'username@users.mulaem.sa';
   ```
6. بقية الموظفين يضيفهم المدير من تبويب المستخدمين داخل النظام (كلمة المرور 8 خانات فأكثر). إذا استُخدم نفس اسم المستخدم القديم يُحافَظ على رقمه وترتبط به مشاريعه القديمة.

## الدخول باسم المستخدم

Supabase Auth يعمل بالإيميل، فاسم المستخدم `ali` يُحوَّل داخلياً إلى `ali@users.mulaem.sa` (لا يلزم بريد حقيقي). اسم المستخدم المكتوب كإيميل يُستخدم كما هو.

## اختبارات

- `tests/shim.test.js`: 31 اختباراً لتطابق الردود مع شكل الـAPI القديم (`node tests/shim.test.js`).
- صلاحيات RLS مُختبرة على PostgreSQL 16 (24 حالة: مجهول، مدير، ميداني، كول سنتر، معطَّل).
- `supabase/functions/agent-run/validate.test.ts`: 25 اختباراً للتحقق المستقل من ناتج النموذج والمحتوى المريب وحدود المرفقات (`deno test --allow-read --allow-net=cdn.sheetjs.com supabase/functions/agent-run/`) — لا تحتاج مفتاح Anthropic.

## مكتبات خارجية (CDN)

Leaflet 1.9.4 · Leaflet.markercluster 1.4.1 · SweetAlert2 v11 · supabase-js v2 · خطوط Google · خرائط OpenStreetMap
