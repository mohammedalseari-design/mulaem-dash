# migrate-images.ps1 - نقل صور المشاريع من استضافة GoDaddy (dash.mulaem.sa) إلى مخزن Supabase وتحديث الروابط.
#
# التشغيل من PowerShell داخل مجلد المشروع:
#   .\scripts\migrate-images.ps1                 # ينقل كل الصور
#   .\scripts\migrate-images.ps1 -DryRun         # يعرض ما سيفعله فقط
#   .\scripts\migrate-images.ps1 -LocalFolder "D:\backup\uploads\projects"   # يأخذ الملفات من مجلد محلي إن لم يعد الموقع القديم يعمل
#
# الأمان: كلمة مرور المدير تُطلب عند التشغيل ولا تُحفظ في أي ملف. المفتاح المستخدم هو المفتاح العام فقط،
# والصلاحيات الفعلية تأتي من حساب المدير عبر RLS (رفع الصور وتحديث المشاريع للمدير فقط).
# الروابط القديمة تُحفظ في العمود images_legacy قبل أي تحديث، فالرجوع ممكن دائماً.

param(
    [string]$SupabaseUrl = 'https://niykzsspdehexphewlxa.supabase.co',
    [string]$Key         = 'sb_publishable_GUx3i6pNJE56TidkxaItMg_0zwRSaVi',
    [string]$Username    = 'admin',
    [string]$EmailDomain = 'users.mulaem.sa',
    [string]$Bucket      = 'project-images',
    [string]$LocalFolder = '',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Get-ContentType([string]$name) {
    switch -Regex ($name.ToLower()) {
        '\.png$'   { 'image/png';  break }
        '\.webp$'  { 'image/webp'; break }
        '\.gif$'   { 'image/gif';  break }
        default    { 'image/jpeg' }
    }
}

# 1) تسجيل الدخول بحساب المدير
$email = if ($Username -like '*@*') { $Username } else { "$Username@$EmailDomain" }
$secure = Read-Host "Password for $email" -AsSecureString
$plain  = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
$login  = Invoke-RestMethod -Method Post -Uri "$SupabaseUrl/auth/v1/token?grant_type=password" `
            -Headers @{ apikey = $Key; 'Content-Type' = 'application/json' } `
            -Body (@{ email = $email; password = $plain } | ConvertTo-Json)
$plain = $null
$token = $login.access_token
if (-not $token) { throw 'Login failed' }
$auth = @{ apikey = $Key; Authorization = "Bearer $token" }
Write-Host "Logged in as $email"

# 2) جلب المشاريع التي ما زالت صورها على الاستضافة القديمة
$projects = Invoke-RestMethod -Method Get -Headers $auth `
    -Uri "$SupabaseUrl/rest/v1/projects?select=id,name,images,images_legacy&order=id"
$todo = @($projects | Where-Object { ($_.images | Where-Object { $_ -match 'dash\.mulaem\.sa' }).Count -gt 0 })
Write-Host ("Projects with legacy image links: {0} of {1}" -f $todo.Count, $projects.Count)

$tmpDir = Join-Path $env:TEMP 'mulaem-images'
New-Item -ItemType Directory -Force $tmpDir | Out-Null
$migrated = 0; $failed = @()

foreach ($p in $todo) {
    $newImages = @()
    $changed = $false
    foreach ($url in @($p.images)) {
        if ($url -notmatch 'dash\.mulaem\.sa') { $newImages += $url; continue }
        $fileName = ($url -split '/')[-1]
        $cleanUrl = $url -replace '(?<!:)//+', '/'
        $local    = Join-Path $tmpDir $fileName
        $publicUrl = "$SupabaseUrl/storage/v1/object/public/$Bucket/projects/$fileName"
        if ($DryRun) { Write-Host ("[dry-run] {0} -> {1}" -f $cleanUrl, $publicUrl); $newImages += $publicUrl; $changed = $true; continue }
        try {
            # (أ) تنزيل الملف: من الموقع القديم، أو من المجلد المحلي إن حُدد
            $got = $false
            if ($LocalFolder -and (Test-Path (Join-Path $LocalFolder $fileName))) {
                Copy-Item (Join-Path $LocalFolder $fileName) $local -Force; $got = $true
            } else {
                try { Invoke-WebRequest -Uri $cleanUrl -OutFile $local -UseBasicParsing -TimeoutSec 60; $got = $true }
                catch { if ($LocalFolder -and (Test-Path (Join-Path $LocalFolder $fileName))) { Copy-Item (Join-Path $LocalFolder $fileName) $local -Force; $got = $true } else { throw } }
            }
            if (-not $got) { throw "file not found" }
            # (ب) رفع الملف إلى مخزن Supabase (upsert)
            $null = Invoke-RestMethod -Method Post -Uri "$SupabaseUrl/storage/v1/object/$Bucket/projects/$fileName" `
                        -Headers ($auth + @{ 'x-upsert' = 'true' }) -ContentType (Get-ContentType $fileName) -InFile $local
            $newImages += $publicUrl
            $changed = $true
            Write-Host ("OK  project {0}: {1}" -f $p.id, $fileName)
        } catch {
            $failed += ("project {0}: {1} - {2}" -f $p.id, $fileName, $_.Exception.Message)
            $newImages += $url          # نبقي الرابط القديم لهذه الصورة
            Write-Host ("ERR project {0}: {1} - {2}" -f $p.id, $fileName, $_.Exception.Message)
        }
    }
    if ($changed -and -not $DryRun) {
        # (ج) تحديث المشروع: الروابط الجديدة، مع حفظ القديمة في images_legacy (إن لم تكن محفوظة من قبل)
        $body = @{ images = $newImages }
        if (-not $p.images_legacy) { $body.images_legacy = @($p.images) }
        $null = Invoke-RestMethod -Method Patch -Uri "$SupabaseUrl/rest/v1/projects?id=eq.$($p.id)" `
                    -Headers ($auth + @{ 'Content-Type' = 'application/json'; Prefer = 'return=minimal' }) `
                    -Body ($body | ConvertTo-Json -Depth 5 -Compress)
        $migrated++
    }
}

Write-Host ""
Write-Host ("Done. Projects updated: {0}. Failed files: {1}" -f $migrated, $failed.Count)
$failed | ForEach-Object { Write-Host "  $_" }
if ($failed.Count -gt 0) { Write-Host "Re-run the script later to retry the failed files; already migrated files are skipped." }
