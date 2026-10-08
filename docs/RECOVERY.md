# إذا ضاع المشروع

هذا الدليل لحالة واحدة: مشروع Supabase الحالي ضاع أو تعطّل ولا يرجع، ونريد ملائم شغّالاً من جديد. الخطوات بالترتيب،
ولا تتخطَّ خطوة. الوقت المتوقع: ساعتان إلى ثلاث.

## ما تحتاجه قبل أن تبدأ

1. **ملف مفتاح age الخاص** (عندك وحدك، خارج GitHub). بدونه لا تُفتح أي نسخة.
2. حساب Supabase (لإنشاء مشروع جديد)، وحساب GitHub صاحب المستودع.
3. على جهازك: GitHub CLI و age و psql 17. (`winget install GitHub.cli FiloSottile.age PostgreSQL.PostgreSQL.17`)

## ما الذي عندنا من نسخ

| ماذا | أين | كم مرة | يبقى |
|---|---|---|---|
| القاعدة بطريقة Supabase، **ومعها حسابات الدخول** — استعمل هذه | Actions ← **backup** ← `mulaem-supabase-dump-encrypted` | كل ليلة | 90 يوماً |
| القاعدة بـ pg_dump الخام (طبقة احتياط ثانية، لا تعيد حسابات الدخول) | Actions ← **backup** ← `mulaem-db-backup-encrypted` | كل ليلة | 90 يوماً |
| صور المشاريع (حاوية project-images) | Actions ← **storage-backup** ← `mulaem-images-backup-encrypted` | كل أسبوع | 90 يوماً |
| تجربة أن الاسترجاع يعمل فعلاً | Actions ← **restore-drill** (صفحة التشغيل فيها الجدول والنتيجة) | كل ثلاثة أشهر | — |

**غير منسوخ:** مرفقات المساعد (حاوية agent-sources، خاصة)، وهي نسخ عمل لمسودات اعتُمدت أو رُفضت؛ وحسابات الدخول
تُستعاد مع القاعدة إن كانت في النسخة، وإلا يُعاد إنشاء المستخدمين من «المستخدمون» في النظام (crm/index.html#/users).

## الخطوات

### 1. مشروع Supabase جديد
لوحة Supabase ← **New project** ← المنطقة نفسها (أوروبا الوسطى). احفظ كلمة مرور القاعدة في مكان آمن.
من **Project Settings ← Database ← Connection string ← Session pooler** انسخ الرابط (ضع كلمة المرور مكان `[YOUR-PASSWORD]`).

### 2. القاعدة وحسابات الدخول
نزّل آخر `mulaem-supabase-dump-encrypted` (Actions ← backup ← التشغيل ← Artifacts)، ثم في مجلد خارج المستودع:

```bash
age -d -i <ملف-المفتاح-الخاص> -o dump.tar.gz mulaem-supabase-YYYY-MM-DD.tar.gz.age
tar -xzf dump.tar.gz && cd mulaem-supabase-YYYY-MM-DD
psql --file roles.sql --dbname "<رابط المشروع الجديد من الخطوة 1>"
psql --single-transaction --variable ON_ERROR_STOP=1 --file schema.sql --dbname "<رابط المشروع الجديد من الخطوة 1>"
psql --command 'SET session_replication_role = replica' --file data.sql --dbname "<رابط المشروع الجديد من الخطوة 1>"
```

الأمر الأول قد يطبع خطأ «permission denied for parameter log_min_messages»، والثالث خطأين «permission denied for table
buckets_vectors / vector_indexes» (جداول Supabase داخلية لا نستعملها): كلها متوقعة، تجاهلها. أما الثاني (البنية) فيجب أن
ينجح بلا خطأ. الثالث يعيد البيانات وحسابات الدخول (auth.users). هذه الأوامر الثلاثة بعينها ما يجرّبه إجراء **restore-drill**
بعينه كل ثلاثة أشهر. بعدها احذف الملفات المفكوكة. النسخة تحمل جدول `mulaem_migrations`، فإجراء **migrate** يعرف ما طُبّق.

### 3. أسرار GitHub
مستودع mulaem-dash ← **Settings ← Secrets and variables ← Actions**:
- `SUPABASE_DB_URL` (سر المستودع): رابط المشروع الجديد من الخطوة 1.
- **Environments ← production ← `SUPABASE_ACCESS_TOKEN`**: رمز جديد من Supabase (Account ← Access Tokens) للمشروع الجديد.

### 4. عنوان المشروع الجديد في الملفات
رقم المشروع (ref) يظهر في رابطه: `https://<ref>.supabase.co`. اطلب من Claude أن يستبدل `niykzsspdehexphewlxa` بالرقم الجديد
في: `js/config.js` (ومعه المفتاح العام من Project Settings ← API)، و`.github/workflows/deploy-agent-run.yml`،
و`.github/workflows/keepalive.yml` (ومفتاحه العام)، و`.github/workflows/storage-backup.yml`، وتحديث جديد للقاعدة
يعيد كتابة الدالة `agent_cron_tick` بالعنوان الجديد (يُطبَّق بإجراء migrate وضغطة Approve).

### 5. سر دورة المساعد
أسرار Vault لا تنتقل بين المشاريع (مشفّرة بمفتاح المشروع القديم). في تحديث الخطوة 4 نفسه: احذف `agent_cron_secret`
القديم من `vault.secrets` وأنشئ واحداً جديداً بـ `vault.create_secret(...)` كما في `020_agent_run.sql`.

### 6. وظائف المساعد
- أسرار الوظائف في لوحة Supabase ← **Edge Functions ← Secrets**: `OPENROUTER_API_KEY` (مفتاحك في OpenRouter).
- انشر `agent-run` بإجراء **deploy-agent-run** (Actions ← Run workflow ← ثم Approve).
- `wa-triage` و`admin-users`: يُنشران من لوحة Supabase أو بطلب من Claude بأداة supabase.

### 7. الصور
نزّل آخر `mulaem-images-backup-encrypted`، فكّه بمفتاحك (`age -d -i <المفتاح> -o images.tar.gz <الملف>.age` ثم
`tar -xzf images.tar.gz`)، وارفع محتوى مجلد `images` إلى حاوية **project-images** بالأسماء نفسها
(لوحة Supabase ← Storage ← project-images ← Upload folder).

### 8. التحقق
1. افتح الموقع وسجّل الدخول.
2. لوحة الإدارة ← **حالة النظام**: كل الأسطر خضراء.
3. Actions ← **agent-watch** ← Run workflow: أخضر.
4. Actions ← **backup** ← Run workflow: أخضر.
5. أرسل طلباً صغيراً للمساعد وتأكد أنه يكتمل.

## كيف أعرف أن هذا الدليل ما زال صالحاً؟
إجراء **restore-drill** يجرّب كل ثلاثة أشهر أخذ نسخة بالطريقة الليلية نفسها واستعادتها، ويكتب في صفحة التشغيل جدولاً
بكل جدول وعدد سجلاته قبل وبعد. إن فشل وصلك إيميل من GitHub. يمكن تشغيله في أي وقت: Actions ← restore-drill ← Run workflow.
