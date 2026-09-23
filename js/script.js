
// Current User Session
let currentUser = null;
let projects = [];
let map, markers = [];
let markerClusterGroup = null;
let selectionMarker = null;
let viewMode = 'grid'; // Default view mode
let modelIndex = 0; // Index counter for unit models

// Base API URL - relative path works since frontend and backend are on same domain
const API_URL = 'api';

// ── تهريب النصوص القادمة من قاعدة البيانات ───────────────────────────────────
// هذه اللوحة تبني صفحاتها بـ innerHTML، فاسم مشروع فيه <img src=x onerror=...>
// كان ينفَّذ عند كل من يفتح الشبكة (مجلد crm/ لا يتأثر: يبني بـ textContent).
// القاعدة هنا: لا نص من القاعدة يدخل HTML بلا esc().
function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

// نص يوضع داخل سلسلة JS في سمة onclick: المتصفح يفكّ ترميز السمة قبل تنفيذها،
// فـ esc() وحدها لا تمنع الخروج من السلسلة — يسبقها تهريب لـJS.
function escJs(v) {
    if (v === null || v === undefined) return '';
    return esc(String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/[\r\n]/g, ' '));
}

// رابط يأتي من القاعدة (صورة أو رابط خارجي): ما لم يبدأ بـ https:// فهو مرفوض،
// لأن javascript: في حقل الصور هو الثغرة نفسها. الفارغ يعني: اعرض البديل.
function safeUrl(v) {
    const s = String(v === null || v === undefined ? '' : v).trim();
    return s.slice(0, 8).toLowerCase() === 'https://' ? s : '';
}

// Helper to log employee activity
async function logActivity(action, details) {
    if (!currentUser) return;
    try {
        await fetch(`${API_URL}/activities.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: currentUser.id,
                action: action,
                details: details
            })
        });
    } catch (e) {
        console.error('Failed to log activity:', e);
    }
}

// Check session on load — verifies account is still active before showing the app
window.addEventListener('load', async function () {
    const saved = sessionStorage.getItem('currentUser');
    if (!saved) return;

    currentUser = JSON.parse(saved);

    // Verify the account hasn't been blocked since last login
    try {
        const vRes = await fetch(`${API_URL}/login.php?u=${encodeURIComponent(currentUser.username)}`);
        const vData = await vRes.json();
        if (vData.status === 'blocked') {
            sessionStorage.removeItem('currentUser');
            const errEl = document.getElementById('loginError');
            errEl.textContent = 'تم تعطيل حسابك من قبل الإدارة. تواصل مع المدير.';
            errEl.style.display = 'block';
            return; // Stay on login screen
        }
        if (vData.status === 'not_found') {
            sessionStorage.removeItem('currentUser');
            return;
        }
    } catch (e) {
        // Network issue — proceed anyway to avoid locking out users offline
        console.warn('Session verify skipped (network):', e);
    }

    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appContainer').classList.add('active');
    setUserBadge();
    initializeApp();
});

// Login Logic
document.getElementById('loginForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const loginBtn = document.getElementById('loginBtn');

    loginBtn.disabled = true;
    loginBtn.innerHTML = '<span>جاري الدخول...</span>';

    try {
        const response = await fetch(`${API_URL}/login.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const result = await response.json();

        if (result.status === 'success') {
            currentUser = result.user;
            sessionStorage.setItem('currentUser', JSON.stringify(currentUser));

            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('appContainer').classList.add('active');
            setUserBadge();

            initializeApp();
        } else {
            showError(result.message || 'خطأ في تسجيل الدخول');
        }
    } catch (error) {
        console.error(error);
        // Try to run setup check to see what's wrong
        try {
            const checkResponse = await fetch(`${API_URL}/setup_check.php`);
            // Check if response is ok
            if (!checkResponse.ok) {
                throw new Error(`HTTP Error: ${checkResponse.status}`);
            }
            const checkResult = await checkResponse.json();
            console.log("Diagnostic Result:", checkResult); // Log for user to see

            if (checkResult.status === 'error') {
                showError('خطأ: ' + checkResult.message);
            } else {
                showError('الاتصال ناجح ولكن تسجيل الدخول فشل. تحقق من اسم المستخدم/كلمة المرور.');
            }
        } catch (e) {
            console.error(e);
            showError('فشل الاتصال بملف الفحص: ' + e.message);
        }
    } finally {
        loginBtn.disabled = false;
        loginBtn.innerHTML = '<span>تسجيل الدخول</span>';
    }
});

function showError(msg) {
    const errorDiv = document.getElementById('loginError');
    errorDiv.textContent = msg;
    errorDiv.style.display = 'block';
    setTimeout(() => {
        errorDiv.style.display = 'none';
    }, 3000);
}

// Set colored role badge in header
function setUserBadge() {
    const badge = document.getElementById('currentUser');
    if (!badge || !currentUser) return;
    const roleLabels = { admin: 'مدير', field: 'ميداني', callcenter: 'كول سنتر' };
    badge.textContent = `${currentUser.fullname} — ${roleLabels[currentUser.role] || currentUser.role}`;
    badge.className = `user-badge role-${currentUser.role}`;
}

// Animate a number counter from 0 → target
function animateCounter(el, target, duration) {
    if (!el) return;
    const isNum = !isNaN(parseFloat(target));
    if (!isNum) { el.textContent = target; return; }
    const end = parseFloat(target);
    const start = 0;
    const step = Math.ceil(duration / 60);
    let current = start;
    const increment = end / (duration / step);
    el.classList.add('stat-animated');
    const timer = setInterval(() => {
        current += increment;
        if (current >= end) {
            current = end;
            clearInterval(timer);
        }
        el.textContent = end % 1 === 0
            ? Math.floor(current).toLocaleString('en-US')
            : current.toFixed(1);
    }, step);
}

// Logout
document.getElementById('logoutBtn').addEventListener('click', function () {
    Swal.fire({
        title: 'هل تريد تسجيل الخروج؟',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#C9A961',
        cancelButtonColor: '#d33',
        confirmButtonText: 'نعم',
        cancelButtonText: 'إلغاء'
    }).then(async (result) => {
        if (result.isConfirmed) {
            await logActivity('تسجيل خروج', `غادر الموظف ${currentUser.username} المنصة`);
            sessionStorage.removeItem('currentUser');
            location.reload();
        }
    });
});

// Initialize App
function initializeApp() {
    if (currentUser.role === 'callcenter') {
        // CSS class is the primary guard (!important), inline style is backup
        document.body.classList.add('callcenter-mode');
        const fs = document.getElementById('formSection');
        if (fs) fs.style.display = 'none';
        const mc = document.querySelector('.main-content');
        if (mc) mc.style.gridTemplateColumns = '1fr';
    }

    if (currentUser.role === 'admin') {
        document.getElementById('adminDashboard').classList.add('active');
    }

    initMap();
    loadProjects();

    if (currentUser.role !== 'callcenter') {
        checkAndLoadDraft();
    }
}

// Map Initialization
function initMap() {
    map = L.map('map').setView([24.7136, 46.6753], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19
    }).addTo(map);

    // Try to get current position and center the map on it
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            function(position) {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                map.setView([lat, lng], 13);
            },
            function(error) {
                console.warn("Geolocation permission denied or unavailable, using Riyadh fallback:", error.message);
            }
        );
    }

    markerClusterGroup = L.markerClusterGroup();
    map.addLayer(markerClusterGroup);

    map.on('click', function (e) {
        if (currentUser.role === 'callcenter') return;

        const lat = e.latlng.lat;
        const lng = e.latlng.lng;

        document.getElementById('coordinates').value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        saveFormDraft();

        if (selectionMarker) map.removeLayer(selectionMarker);
        selectionMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
        selectionMarker.bindPopup('موقع المشروع الجديد').openPopup();

        selectionMarker.on('dragend', function (event) {
            const position = event.target.getLatLng();
            document.getElementById('coordinates').value = `${position.lat.toFixed(6)}, ${position.lng.toFixed(6)}`;
            saveFormDraft();
        });
    });
}

// Load Projects
async function loadProjects() {
    const grid = document.getElementById('projectsGrid');
    grid.innerHTML = '<div class="loading">جاري تحميل المشاريع...</div>';

    try {
        // Periodic block check — catches accounts blocked while user is already inside
        if (currentUser) {
            try {
                const vRes = await fetch(`${API_URL}/login.php?u=${encodeURIComponent(currentUser.username)}`);
                const vData = await vRes.json();
                if (vData.status === 'blocked') {
                    sessionStorage.removeItem('currentUser');
                    Swal.fire({
                        title: 'تم تعطيل الحساب',
                        text: 'قام المدير بتعطيل حسابك. سيتم تسجيل خروجك الآن.',
                        icon: 'warning',
                        confirmButtonColor: '#C9A961',
                        confirmButtonText: 'موافق',
                        allowOutsideClick: false
                    }).then(() => location.reload());
                    return;
                }
            } catch (ve) { /* network issue — skip silently */ }
        }

        const role = currentUser ? currentUser.role : 'callcenter';
        const username = currentUser ? currentUser.username : '';
        const response = await fetch(`${API_URL}/projects.php?role=${role}&username=${username}`);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const text = await response.text();
        try {
            projects = JSON.parse(text);
        } catch (parseErr) {
            console.error('JSON parse error — server response:', text.substring(0, 300));
            throw new Error('invalid_json');
        }

        if (!Array.isArray(projects)) projects = [];

        try { updateUI(); } catch (uiErr) { console.error('updateUI error:', uiErr); }
        try { updateAdminDashboard(); } catch (e) { console.error('Dashboard update failed:', e); }

    } catch (error) {
        console.error('loadProjects error:', error);
        const msg = error.message === 'invalid_json'
            ? 'خطأ في البيانات القادمة من السيرفر — تواصل مع الدعم'
            : 'فشل تحميل البيانات — تحقق من الاتصال وأعد المحاولة';
        grid.innerHTML = '';
        const err = document.createElement('div');
        err.className = 'loading';
        err.style.color = '#ef4444';
        err.textContent = msg;
        grid.appendChild(err);
    }
}

function updateUI() {
    updateStats();
    renderSalesOverview();
    displayProjects();
    loadMyProjects();
}

/* ── نظرة سريعة للمسوقين (القسم الأعلى في اللوحة) ─────────────────────────────
   كل ما يظهر هنا حقيقي، لا أرقام ثابتة: العدّادات والمدن وأبرز المشاريع من قائمة المشاريع
   المحمّلة (نفس بيانات الشبكة والخريطة)، وفرص اليوم من متابعات وطلبات الـCRM عبر جلسة
   Supabase نفسها (window.mulaemSupabase) — فسياسات RLS تحدّ ما يراه كل موظف.
   القاعدة كما في بقية الملف: أي نص من القاعدة يمرّ على esc() قبل innerHTML. */
const salesView = { city: 'all', availableOnly: false };
// أقل من هذا ليس سعر بيع حقيقياً (بعض النماذج فيها قيم مؤقتة مثل «1») فلا يتصدّر «أرخص شقة»
const SALES_MIN_PRICE = 50000;

function setSalesText(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
}

function projectDetailsOf(project) {
    let details = project.details;
    if (typeof details === 'string') { try { details = JSON.parse(details); } catch (error) { details = {}; } }
    return details || {};
}

function salesPriceTag(value) {
    const n = featuredNumber(value);
    if (!n || n < 1000) return '—';
    if (n >= 1000000) return 'SAR ' + (Math.round(n / 100000) / 10).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1000) return 'SAR ' + Math.round(n / 1000) + 'K';
    return 'SAR ' + formatNumber(n);
}

function renderSalesOverview() {
    const shell = document.getElementById('salesShell');
    if (!shell) return;
    if (!shell.dataset.wired) {
        shell.dataset.wired = '1';
        document.getElementById('salesShowAll')?.addEventListener('click', () => {
            document.querySelector('.projects-section')?.scrollIntoView({ behavior: 'smooth' });
        });
        document.getElementById('salesAddOffer')?.addEventListener('click', () => {
            const formSection = document.getElementById('formSection');
            if (!formSection) return;
            formSection.scrollIntoView({ behavior: 'smooth' });
            setTimeout(() => document.getElementById('projectName')?.focus(), 450);
        });
        document.getElementById('salesRefresh')?.addEventListener('click', () => loadSalesOpportunities());
        loadSalesOpportunities();
    }

    // «إضافة عرض» يظهر لمن يملك نموذج الإضافة أصلاً (مركز الاتصال لا يضيف عروضاً)
    const addBtn = document.getElementById('salesAddOffer');
    const formSection = document.getElementById('formSection');
    if (addBtn) addBtn.style.display = formSection && formSection.offsetParent !== null ? '' : 'none';

    const approved = projects.filter((project) => project.status === 'approved' && !project.deleted_at);
    setSalesText('salesTotal', formatNumber(approved.length));
    setSalesText('salesAvailable', formatNumber(approved.filter((project) => project.availability === 'available').length));
    setSalesText('salesPending', formatNumber(projects.filter((project) => project.status === 'pending').length));
    renderSalesToolbar(approved);
    renderSalesProjects(approved);
}

// الشرائح من المدن الموجودة فعلاً في المخزون (لا قائمة ثابتة)، و«متاحة الآن» مفتاح تبديل
function renderSalesToolbar(approved) {
    const bar = document.getElementById('salesToolbar');
    if (!bar) return;
    const counts = new Map();
    approved.forEach((project) => {
        const city = String(project.city || '').trim();
        if (city) counts.set(city, (counts.get(city) || 0) + 1);
    });
    const cities = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map((entry) => entry[0]);
    if (salesView.city !== 'all' && !cities.includes(salesView.city)) salesView.city = 'all';

    const chip = (label, active, onClick) => {
        const node = document.createElement('button');
        node.type = 'button';
        node.className = 'toolbar-chip' + (active ? ' active' : '');
        node.textContent = label;
        node.addEventListener('click', onClick);
        return node;
    };
    bar.innerHTML = '';
    bar.appendChild(chip('الكل', salesView.city === 'all', () => { salesView.city = 'all'; renderSalesOverview(); }));
    cities.forEach((city) => bar.appendChild(chip(city, salesView.city === city, () => { salesView.city = city; renderSalesOverview(); })));
    bar.appendChild(chip('متاحة الآن', salesView.availableOnly, () => { salesView.availableOnly = !salesView.availableOnly; renderSalesOverview(); }));
}

// أبرز المشاريع: أرخص شقة، أصغر شقة، أعلى عمولة، وأحدث عرض — من المعتمد ضمن الشريحة المختارة
function renderSalesProjects(approved) {
    const list = document.getElementById('salesProjectList');
    if (!list) return;
    const canSeeCommission = currentUser && currentUser.role !== 'callcenter';
    const filtered = approved.filter((project) => {
        if (salesView.city !== 'all' && String(project.city || '').trim() !== salesView.city) return false;
        if (salesView.availableOnly && project.availability !== 'available') return false;
        return true;
    });

    const units = [];
    filtered.forEach((project) => {
        const models = projectDetailsOf(project).models;
        (Array.isArray(models) ? models : []).forEach((model) => {
            if (salesView.availableOnly && model.status && model.status !== 'available') return;
            units.push({ project, model });
        });
    });
    const byPrice = units.filter((row) => featuredNumber(row.model.price) >= SALES_MIN_PRICE).sort((a, b) => featuredNumber(a.model.price) - featuredNumber(b.model.price));
    const byArea = units.filter((row) => featuredNumber(row.model.area) > 0).sort((a, b) => featuredNumber(a.model.area) - featuredNumber(b.model.area));
    const byCommission = canSeeCommission
        ? units.filter((row) => featuredNumber(row.model.commission) > 0).sort((a, b) => featuredNumber(b.model.commission) - featuredNumber(a.model.commission))
        : [];
    const newest = filtered.slice().sort((a, b) => new Date(b.date_added || 0) - new Date(a.date_added || 0))[0];

    const rows = [];
    const seen = new Set();
    const push = (row, highlight) => {
        if (!row) return;
        const key = row.project.id + '|' + (row.model ? row.model.name : '');
        if (seen.has(key)) return;
        seen.add(key);
        rows.push({ project: row.project, model: row.model, highlight });
    };
    push(byPrice[0], 'أرخص شقة');
    push(byArea[0], 'أصغر شقة');
    if (canSeeCommission) push(byCommission[0], 'أعلى عمولة');
    if (newest) push({ project: newest, model: null }, 'أحدث عرض');
    if (!rows.length) {
        filtered.filter((project) => featuredNumber(project.price) >= SALES_MIN_PRICE)
            .sort((a, b) => featuredNumber(a.price) - featuredNumber(b.price)).slice(0, 3)
            .forEach((project) => push({ project, model: null }, 'عرض'));
    }
    list.innerHTML = rows.length
        ? rows.map((row) => salesDealCardHtml(row, canSeeCommission)).join('')
        : '<div class="sales-empty">لا توجد عروض مطابقة لهذا الفلتر</div>';
}

function salesDealCardHtml(row, canSeeCommission) {
    const project = row.project;
    const unit = row.model || {};
    const details = projectDetailsOf(project);
    let images = project.images;
    if (typeof images === 'string') { try { images = JSON.parse(images); } catch (error) { images = []; } }
    // الرابط يمرّ على safeUrl (https فقط) ثم تُنزع منه علامات الاقتباس والأقواس حتى لا يخرج من url()
    const image = Array.isArray(images) && images[0] ? safeUrl(images[0]).replace(/["'()\s\\]/g, '') : '';

    const available = row.model ? (unit.status || 'available') === 'available' : project.availability === 'available';
    let status;
    if (!available) status = { text: 'غير متاحة', cls: 'neutral' };
    else if (details.construction_status === 'تحت_الإنشاء') status = { text: 'قريب', cls: 'warning' };
    else if (isRecentProject(project)) status = { text: 'جديد', cls: 'neutral' };
    else status = { text: 'متاحة', cls: 'success' };

    const rooms = featuredNumber(unit.rooms) || featuredNumber(project.rooms) || featuredNumber(details.rooms);
    const area = featuredNumber(unit.area) || featuredNumber(project.area);
    const price = featuredNumber(unit.price) || featuredNumber(project.price);
    const commission = featuredNumber(unit.commission);
    const facts = [];
    if (row.highlight) facts.push(row.highlight);
    if (rooms) facts.push(rooms + ' غرف');
    if (area) facts.push(formatNumber(area) + ' م²');
    const place = project.district || project.city || '';
    if (place) facts.push(place);
    if (canSeeCommission && commission) facts.push('عمولة ' + formatNumber(commission) + ' ر.س');
    const title = row.model && unit.name ? project.name + ' — ' + unit.name : (project.name || 'عرض بلا اسم');
    const id = Number(project.id);
    const thumb = image
        ? `<div class="deal-thumb" style="background-image:url('${esc(image)}')"></div>`
        : '<div class="deal-thumb thumb-one"></div>';

    return `<article class="deal-card" role="button" tabindex="0" onclick="viewProject(${id})" onkeydown="if(event.key==='Enter'){viewProject(${id})}">
        ${thumb}
        <div class="deal-body">
            <div class="deal-meta"><span class="price-tag">${esc(salesPriceTag(price))}</span><span class="status-dot ${status.cls}">${esc(status.text)}</span></div>
            <h4>${esc(title)}</h4>
            <p>${facts.map(esc).join(' • ')}</p>
        </div>
    </article>`;
}

// فرص اليوم: متابعات مستحقة (اليوم أو متأخرة) ثم الطلبات المفتوحة الجديدة خلال 7 أيام.
// القراءة بجلسة المستخدم نفسها فلا يرى الوسيط إلا عملاءه ومتابعاته.
async function loadSalesOpportunities() {
    const host = document.getElementById('salesOpportunities');
    if (!host) return;
    host.innerHTML = '<div class="sales-empty">جاري التحديث...</div>';
    const sb = window.mulaemSupabase;
    if (!sb) { host.innerHTML = '<div class="sales-empty">تعذّر الاتصال بقاعدة البيانات</div>'; return; }

    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(); dayEnd.setHours(23, 59, 59, 999);
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    try {
        const [followUps, requests, newCount] = await Promise.all([
            sb.from('follow_ups').select('id, client_id, due_at, purpose, client:clients(full_name)')
                .eq('status', 'pending').lte('due_at', dayEnd.toISOString())
                .order('due_at', { ascending: true }).range(0, 5),
            sb.from('client_requirements').select('id, client_id, property_type, purpose, priority, created_at, client:clients(full_name)')
                .eq('status', 'open').gte('created_at', since)
                .order('created_at', { ascending: false }).range(0, 5),
            sb.from('client_requirements').select('id', { count: 'exact', head: true })
                .eq('status', 'open').gte('created_at', since)
        ]);
        if (followUps.error) throw followUps.error;
        if (requests.error) throw requests.error;
        setSalesText('salesNewRequests', formatNumber(newCount.error ? 0 : (newCount.count || 0)));

        const items = [];
        (followUps.data || []).forEach((row) => {
            const due = row.due_at ? new Date(row.due_at) : null;
            const overdue = Boolean(due && due < dayStart);
            items.push({
                href: 'crm/#/clients/' + row.client_id,
                tag: overdue ? 'متابعة متأخرة' : 'متابعة اليوم',
                title: (row.client && row.client.full_name) || 'عميل',
                sub: row.purpose || '',
                score: overdue ? 'متأخرة' : (due ? due.toLocaleTimeString('ar-SA-u-nu-latn', { hour: '2-digit', minute: '2-digit' }) : ''),
                order: overdue ? 0 : 1
            });
        });
        const priorityText = { 1: 'أولوية عالية', 2: 'أولوية متوسطة', 3: 'أولوية منخفضة' };
        (requests.data || []).forEach((row) => {
            items.push({
                href: 'crm/#/clients/' + row.client_id,
                tag: 'طلب جديد',
                title: ((row.client && row.client.full_name) || 'عميل') + (row.property_type ? ' — ' + row.property_type : ''),
                sub: row.purpose === 'rent' ? 'إيجار' : 'شراء',
                score: priorityText[row.priority] || '',
                order: 2
            });
        });
        items.sort((a, b) => a.order - b.order);
        const shown = items.slice(0, 6);
        host.innerHTML = shown.length
            ? shown.map(salesOpportunityHtml).join('')
            : '<div class="sales-empty">لا فرص اليوم — لا متابعات مستحقة ولا طلبات جديدة خلال 7 أيام</div>';
    } catch (error) {
        console.error('فرص اليوم:', error);
        host.innerHTML = '<div class="sales-empty">تعذّر تحميل فرص اليوم: ' + esc(error && error.message ? error.message : error) + '</div>';
    }
}

function salesOpportunityHtml(item) {
    return `<a class="opportunity-item" href="${esc(item.href)}">
        <div>
            <span class="opportunity-tag">${esc(item.tag)}</span>
            <h4>${esc(item.title)}</h4>
            ${item.sub ? `<small class="opportunity-sub">${esc(item.sub)}</small>` : ''}
        </div>
        <span class="opportunity-score">${esc(item.score)}</span>
    </a>`;
}

function isRecentProject(project) {
    const value = project.updated_at || project.date_added;
    return value ? Date.now() - new Date(value).getTime() < 30 * 86400000 : false;
}

function featuredNumber(value) {
    if (value === null || value === undefined || value === '') return 0;
    const text = normalizeNumericValue(value).replace(/,/g, '').replace(/\s/g, '');
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : 0;
}

function clearMarkers() {
    if (markerClusterGroup) {
        markerClusterGroup.clearLayers();
    }
    markers = [];
}

function getStatusBadgeHtml(status) {
    try {
        status = (status && typeof status === 'string') ? status : 'pending';
        switch (status) {
            case 'approved': return '<span class="status-badge approved">معتمد</span>';
            case 'rejected': return '<span class="status-badge rejected">مرفوض</span>';
            default:         return '<span class="status-badge pending">معلق</span>';
        }
    } catch (e) { return '<span class="status-badge pending">معلق</span>'; }
}

function getCategoryBadgeHtml(project) {
    try {
        let d = project.details;
        if (typeof d === 'string') { try { d = JSON.parse(d); } catch(e) { d = {}; } }
        d = d || {};
        const c = d.construction_status || '';
        const s = d.support_type || '';
        if (!c) return '';
        const cLabel = c === 'جاهز' ? 'جاهز' : 'تحت الإنشاء';
        const sMap = { 'مدعوم': 'مدعوم', 'غير_مدعوم': 'غير مدعوم', 'تمويل': 'تمويل' };
        const sLabel = sMap[s] || '';
        const colorMap = {
            'جاهز-مدعوم': '#10b981', 'جاهز-غير_مدعوم': '#3b82f6',
            'تحت_الإنشاء-مدعوم': '#f59e0b', 'تحت_الإنشاء-غير_مدعوم': '#8b5cf6', 'تحت_الإنشاء-تمويل': '#ef4444'
        };
        const color = colorMap[`${c}-${s}`] || '#64748b';
        const text = sLabel ? `${cLabel} · ${sLabel}` : cLabel;
        return `<span class="category-badge" style="background:${color};">${text}</span>`;
    } catch(e) { return ''; }
}

function getAvailabilityBadgeHtml(availability) {
    try {
        availability = (availability && typeof availability === 'string') ? availability : 'available';
        if (availability === 'sold_out') {
            return '<span class="availability-badge sold_out">نفدت بالكامل</span>';
        }
        return '<span class="availability-badge available">متاحة</span>';
    } catch (e) { return '<span class="availability-badge available">متاحة</span>'; }
}

function addMarker(project) {
    if (project.latitude && project.longitude) {
        // Colored marker by project status
        const statusClass = project.status === 'approved' ? 'approved' : project.status === 'rejected' ? 'rejected' : 'pending';
        const pinIcon = L.divIcon({
            className: '',
            html: `<div class="map-marker-pin ${statusClass}"></div>`,
            iconSize:   [22, 22],
            iconAnchor: [11, 20],
            popupAnchor:[0, -22]
        });
        const marker = L.marker([project.latitude, project.longitude], { icon: pinIcon });
        marker.projectId = project.id;
        
        let popupContent = `
            <div style="text-align: right; direction: rtl; min-width: 250px; font-family: 'Tajawal';">
                <h3 style="color: #C9A961; margin-bottom: 10px;">${esc(project.name)}</h3>
                <p><strong>النوع:</strong> ${esc(project.type)}</p>
                <p><strong>السعر:</strong> ${formatNumber(project.price)} ريال</p>
                <p><strong>التوفر:</strong> ${getAvailabilityBadgeHtml(project.availability)}</p>
                <p><strong>الحالة:</strong> ${getStatusBadgeHtml(project.status)}</p>
        `;

        if (project.status === 'rejected' && project.rejection_reason) {
            popupContent += `<p style="color:#ef4444; margin-top:5px;"><strong>سبب الرفض:</strong> ${esc(project.rejection_reason)}</p>`;
        }

        // الإحداثيات عمودان رقميان في القاعدة (double precision)، ومع ذلك يمران على
        // Number() فلا يدخل الرابط إلا رقم أو NaN
        popupContent += `
                <a href="https://www.google.com/maps?q=${Number(project.latitude)},${Number(project.longitude)}" target="_blank" style="display:inline-flex; align-items:center; gap:5px; margin-top:10px; color:var(--primary-gold); text-decoration:none; font-weight:600;"><span>فتح في خرائط Google</span></a>
            </div>
        `;

        marker.bindPopup(popupContent);
        markerClusterGroup.addLayer(marker);
        markers.push(marker);
    }
}

// ── Category filter state ──────────────────────────────────────────────────
let activeCategoryConstruction = ''; // '' | 'جاهز' | 'تحت_الإنشاء'
let activeCategorySupport      = ''; // '' | 'مدعوم' | 'غير_مدعوم' | 'تمويل'

// Category tab helpers
function getCategoryFromDetails(p) {
    let d = p.details;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = {}; } }
    return d || {};
}

function setCategoryFilter(construction, support) {
    activeCategoryConstruction = construction;
    activeCategorySupport      = support;

    // Update active tab highlight
    document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.cat-sub').forEach(t => t.classList.remove('active'));

    if (!construction) {
        document.getElementById('catTabAll').classList.add('active');
    } else if (construction === 'جاهز' && !support) {
        document.getElementById('catTabReady').classList.add('active');
    } else if (construction === 'تحت_الإنشاء' && !support) {
        document.getElementById('catTabConstruction').classList.add('active');
    } else {
        // Find matching sub button
        document.querySelectorAll('.cat-sub').forEach(btn => {
            if (btn.dataset.c === construction && btn.dataset.s === support) btn.classList.add('active');
        });
    }
    displayProjects();
}

// Display Projects
function displayProjects() {
    const filterType = document.getElementById('filterType').value;
    const filterAvailability = document.getElementById('filterAvailability').value;
    const filterMinPrice = parseFloat(document.getElementById('filterMinPrice').value) || null;
    const filterMaxPrice = parseFloat(document.getElementById('filterMaxPrice').value) || null;
    const searchText = document.getElementById('searchBox').value.toLowerCase();

    let filtered = projects;

    // Category filter (construction_status / support_type stored in details)
    if (activeCategoryConstruction) {
        filtered = filtered.filter(p => {
            const d = getCategoryFromDetails(p);
            return d.construction_status === activeCategoryConstruction;
        });
    }
    if (activeCategorySupport) {
        filtered = filtered.filter(p => {
            const d = getCategoryFromDetails(p);
            return d.support_type === activeCategorySupport;
        });
    }
    
    // Type Filter
    if (filterType) {
        filtered = filtered.filter(p => p.type === filterType);
    }
    
    // Availability Filter
    if (filterAvailability) {
        filtered = filtered.filter(p => p.availability === filterAvailability);
    }
    
    // Price Filters
    if (filterMinPrice !== null) {
        filtered = filtered.filter(p => parseFloat(p.price) >= filterMinPrice);
    }
    if (filterMaxPrice !== null) {
        filtered = filtered.filter(p => parseFloat(p.price) <= filterMaxPrice);
    }
    
    // Text Search
    if (searchText) {
        filtered = filtered.filter(p => {
            let details = p.details;
            if (typeof details === 'string') {
                try { details = JSON.parse(details); } catch (e) { details = {}; }
            }
            details = details || {};
            const nameMatch = (p.name && p.name.toLowerCase().includes(searchText));
            const addressMatch = (p.address && p.address.toLowerCase().includes(searchText));
            const modelMatch = (p.type === 'شقة' && details.models && Array.isArray(details.models) && details.models.some(m => m.name && m.name.toLowerCase().includes(searchText)));
            return nameMatch || addressMatch || modelMatch;
        });
    }

    try {
        if (viewMode === 'grid') {
            renderGridView(filtered);
        } else {
            renderKanbanBoard(filtered);
        }
    } catch (e) {
        console.error('Display error (non-fatal):', e);
        document.getElementById('projectsGrid').innerHTML = '<div class="loading">حدث خطأ في العرض، يرجى تحديث الصفحة</div>';
    }

    // Refresh Map Markers visually sync
    clearMarkers();
    filtered.forEach(p => addMarker(p));
}

// Locate Project
window.locateProject = function (id) {
    const project = projects.find(p => p.id == id); // Use loose equality for string/number id mismatch
    if (!project || !project.latitude || !project.longitude) {
        showNotification('لا يوجد موقع مسجل لهذا المشروع', 'info');
        return;
    }
    document.querySelector('.map-section').scrollIntoView({ behavior: 'smooth' });
    map.flyTo([project.latitude, project.longitude], 16);
    setTimeout(() => {
        const marker = markers.find(m => m.projectId == id);
        if (marker) marker.openPopup();
    }, 1500);
};

// Add Project Form
document.getElementById('projectForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    const submitBtn = document.getElementById('submitBtn');
    const editId = document.getElementById('editProjectId').value;
    
    // Disable submit button during processing
    submitBtn.disabled = true;
    submitBtn.textContent = editId ? 'جاري التعديل...' : 'جاري الحفظ...';

    try {
        const coords = document.getElementById('coordinates').value;
        if (!coords) {
            showNotification('يرجى تحديد الموقع الجغرافي للمشروع', 'info');
            submitBtn.disabled = false;
            submitBtn.innerHTML = editId ? '<span>حفظ التعديلات</span>' : '<span>إضافة المشروع</span>';
            return;
        }

        const parts = coords.split(',');
        if (parts.length !== 2) {
            showNotification('صيغة الإحداثيات غير صحيحة. يجب أن تكون: خط العرض، خط الطول (مثال: 24.7136, 46.6753)', 'error');
            submitBtn.disabled = false;
            submitBtn.innerHTML = editId ? '<span>حفظ التعديلات</span>' : '<span>إضافة المشروع</span>';
            return;
        }

        const lat = parseFloat(parts[0].trim());
        const lng = parseFloat(parts[1].trim());

        if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            showNotification('الإحداثيات المدخلة غير صالحة. خط العرض (-90 إلى 90)، خط الطول (-180 إلى 180)', 'error');
            submitBtn.disabled = false;
            submitBtn.innerHTML = editId ? '<span>حفظ التعديلات</span>' : '<span>إضافة المشروع</span>';
            return;
        }
        const imageFiles = document.getElementById('images').files;
        let imageUrls = [];

        // Upload new images to server (file → URL), keep existing images if no new selection
        if (imageFiles.length > 0) {
            for (let file of imageFiles) {
                try {
                    const url = await uploadImageFile(file);
                    imageUrls.push(url);
                } catch (imgErr) {
                    console.error("Image upload error:", imgErr);
                    throw new Error("فشل في رفع إحدى الصور إلى السيرفر. يرجى التحقق من الاتصال والمحاولة مرة أخرى.");
                }
            }
        } else if (editId) {
            imageUrls = window.editingProjectImages || [];
        }

        const type = document.getElementById('propertyType').value;
        
        // Compile details based on property type
        let details = {};
        let calculatedPrice = 0;
        let calculatedArea = 0;

        if (type === 'أرض') {
            details = {
                sides: document.getElementById('landSides').value,
                interface: document.getElementById('landInterface').value
            };
        } else if (type === 'فيلا') {
            details = {
                buildingArea: document.getElementById('villaBuildingArea').value,
                interface: document.getElementById('villaInterface').value,
                villaType: document.getElementById('villaType').value,
                rooms: document.getElementById('villaRooms').value,
                age: document.getElementById('villaAge').value
            };
        } else if (type === 'شقة') {
            const models = [];
            const blocks = document.querySelectorAll('#unitModelsContainer .unit-model-block');
            blocks.forEach(b => {
                const mPrice = parseFloat(b.querySelector('.model-price').value) || 0;
                const mArea  = parseFloat(b.querySelector('.model-area').value)  || 0;
                const mCountRaw = parseInt(b.querySelector('.model-count').value);
                const mCount = (!isNaN(mCountRaw) && mCountRaw > 0) ? mCountRaw : 1;
                
                models.push({
                    name: b.querySelector('.model-name').value,
                    type: b.querySelector('.model-type').value,
                    rooms: parseInt(b.querySelector('.model-rooms').value) || 0,
                    bathrooms: parseInt(b.querySelector('.model-bathrooms').value) || 0,
                    area: mArea,
                    price: mPrice,
                    commission: parseFloat(b.querySelector('.model-commission').value) || 0,
                    status: b.querySelector('.model-status').value,
                    count: mCount
                });

                calculatedPrice += (mPrice * mCount);
                calculatedArea += (mArea * mCount);
            });

            details = {
                aptCount: document.getElementById('aptCount').value,
                roofCount: document.getElementById('roofCount').value,
                models: models
            };
        }

        // Add classification fields to details for ALL property types
        details.construction_status = document.getElementById('constructionStatus').value;
        details.support_type        = document.getElementById('supportType').value;
        const deliveryVal = document.getElementById('deliveryTime').value.trim();
        if (deliveryVal) details.delivery_time = deliveryVal;

        // Save Drive link in details (no separate DB column)
        const driveLinkVal = document.getElementById('driveLink').value.trim();
        if (driveLinkVal) details.drive_link = driveLinkVal;

        const data = {
            name: document.getElementById('projectName').value,
            type: type,
            availability: document.getElementById('availability').value,
            price: type === 'شقة' ? calculatedPrice : (document.getElementById('price').value || document.getElementById('villaPrice').value || document.getElementById('landPrice').value || 0),
            area: type === 'شقة' ? calculatedArea : (document.getElementById('area').value || document.getElementById('landArea').value || document.getElementById('villaLandArea').value || 0),
            address: document.getElementById('address').value,
            rega_ad_license: document.getElementById('regaAdLicense').value.trim(),
            listing_expires_at: document.getElementById('listingExpiresAt').value || null,
            latitude: lat,
            longitude: lng,
            notes: document.getElementById('notes').value,
            employee: currentUser.fullname,
            addedBy: currentUser.username,
            images: imageUrls,
            details: details
        };

        let url = `${API_URL}/projects.php`;
        let method = 'POST';
        if (editId) {
            url += `?id=${editId}`;
            method = 'PUT';
        }

        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            if (response.status === 413) {
                throw new Error("حجم البيانات كبير جداً! يرجى تقليل حجم أو عدد الصور والمحاولة مرة أخرى.");
            }
            throw new Error(`خطأ من الخادم (رمز الخطأ: ${response.status})`);
        }

        const result = await response.json();

        if (result.status === 'success') {
            if (!editId && currentUser.role === 'field') {
                showNotification('تم إرسال المشروع! سيظهر للكول سنتر بعد موافقة المدير.', 'info');
            } else {
                showNotification(editId ? 'تم تعديل المشروع بنجاح!' : 'تمت إضافة المشروع بنجاح!', 'success');
            }
            if (editId) {
                cancelEdit();
            } else {
                localStorage.removeItem('project_draft'); // Clear draft on success
                document.getElementById('projectForm').reset();
                document.getElementById('imagePreview').innerHTML = '';
                document.getElementById('coordinates').value = '';
                if (selectionMarker) {
                    map.removeLayer(selectionMarker);
                    selectionMarker = null;
                }
            }
            loadProjects();
        } else {
            throw new Error(result.message || 'فشل غير معروف في حفظ البيانات');
        }
    } catch (error) {
        console.error(error);
        showNotification('فشل الحفظ: ' + error.message, 'error');
        Swal.fire({
            title: 'فشل حفظ المشروع',
            text: error.message || 'حدث خطأ غير متوقع أثناء حفظ المشروع. يرجى التحقق من اتصالك بالإنترنت أو حجم الصور.',
            icon: 'error',
            confirmButtonColor: '#C9A961',
            confirmButtonText: 'موافق'
        });
    } finally {
        // ALWAYS re-enable the submit button, even if an error is thrown
        submitBtn.disabled = false;
        submitBtn.innerHTML = editId ? '<span>حفظ التعديلات</span>' : '<span>إضافة المشروع</span>';
    }
});

// Helper Functions
const toBase64 = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
});

// Compress image using canvas → Blob (does NOT produce base64 anymore)
const compressToBlob = (file, maxSize = 1200, quality = 0.75) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = event => {
        const img = new Image();
        img.src = event.target.result;
        img.onload = () => {
            let w = img.width, h = img.height;
            if (w > h && w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize; }
            else if (h > maxSize)     { w = Math.round(w * maxSize / h); h = maxSize; }
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Compression failed')), 'image/jpeg', quality);
        };
        img.onerror = reject;
    };
    reader.onerror = reject;
});

// Upload image file to server → returns public URL (replaces base64 storage)
const uploadImageFile = async (file) => {
    const blob     = await compressToBlob(file);
    const formData = new FormData();
    formData.append('image', blob, `img_${Date.now()}.jpg`);
    const resp = await fetch(`${API_URL}/upload.php`, { method: 'POST', body: formData });
    if (!resp.ok) throw new Error(`Upload HTTP ${resp.status}`);
    const data = await resp.json();
    if (data.status !== 'success') throw new Error(data.message || 'فشل رفع الصورة');
    return data.url;
};

// Legacy: compressImage kept for any old code still referencing it (returns base64)
const compressImage = (file, maxWidth = 1200, maxHeight = 1200, quality = 0.7) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = event => {
        const img = new Image();
        img.src = event.target.result;
        img.onload = () => {
            let width = img.width, height = img.height;
            if (width > height) { if (width > maxWidth)  { height = Math.round(height * maxWidth / width);  width  = maxWidth;  } }
            else                { if (height > maxHeight) { width  = Math.round(width * maxHeight / height); height = maxHeight; } }
            const canvas = document.createElement('canvas');
            canvas.width = width; canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
    };
    reader.onerror = reject;
});

function showNotification(msg, type) {
    const notif = document.getElementById('notification');
    notif.textContent = msg;
    notif.className = `notification ${type}`;
    notif.style.display = 'block';
    setTimeout(() => notif.style.display = 'none', 3000);
}

function normalizeNumericValue(value) {
    if (value === null || value === undefined || value === '') return '0';
    let text = String(value).trim();
    text = text.replace(/٬/g, ',').replace(/٫/g, '.');
    text = text.replace(/[٠-٩۰-۹]/g, (ch) => {
        const code = ch.charCodeAt(0);
        if (code >= 0x06F0) return String(code - 0x06F0 + 48);
        return String(code - 0x0660 + 48);
    });
    return text;
}

function formatNumber(num) {
    const normalized = normalizeNumericValue(num);
    const value = Number(normalized.replace(/,/g, '').replace(/\s/g, ''));
    return Number.isFinite(value) ? new Intl.NumberFormat('en-US').format(value) : '—';
}

// UI Toggles (Property Type, etc) - Keep existing logic
document.getElementById('propertyType').addEventListener('change', function () {
    const type = this.value;
    document.querySelectorAll('.dynamic-section').forEach(el => el.style.display = 'none');
    document.getElementById('genericFields').style.display = 'block';

    if (type === 'أرض') {
        document.getElementById('genericFields').style.display = 'none';
        document.getElementById('landSection').style.display = 'block';
    } else if (type === 'فيلا') {
        document.getElementById('genericFields').style.display = 'none';
        document.getElementById('villaSection').style.display = 'block';
    } else if (type === 'شقة') {
        document.getElementById('genericFields').style.display = 'none';
        document.getElementById('apartmentSection').style.display = 'block';
    }
});

document.getElementById('getLocationBtn').addEventListener('click', function () {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            pos => {
                const { latitude, longitude } = pos.coords;
                document.getElementById('coordinates').value = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
                saveFormDraft();
                map.setView([latitude, longitude], 15);
                
                if (selectionMarker) map.removeLayer(selectionMarker);
                selectionMarker = L.marker([latitude, longitude], { draggable: true }).addTo(map);
                selectionMarker.bindPopup('موقعك الحالي').openPopup();

                selectionMarker.on('dragend', function (event) {
                    const position = event.target.getLatLng();
                    document.getElementById('coordinates').value = `${position.lat.toFixed(6)}, ${position.lng.toFixed(6)}`;
                    saveFormDraft();
                });
            },
            err => {
                console.error("Geolocation error:", err);
                let errorMsg = 'تعذر الحصول على موقعك الجغرافي.';
                if (err.code === err.PERMISSION_DENIED) {
                    errorMsg = 'تم رفض الوصول للموقع الجغرافي. يرجى تفعيل إذن الوصول للموقع من إعدادات المتصفح/الجهاز.';
                } else if (err.code === err.POSITION_UNAVAILABLE) {
                    errorMsg = 'معلومات الموقع الجغرافي غير متوفرة حالياً.';
                } else if (err.code === err.TIMEOUT) {
                    errorMsg = 'انتهت مهلة الحصول على الموقع الجغرافي.';
                }
                
                showNotification(errorMsg, 'error');
                Swal.fire({
                    title: 'تحديد الموقع الجغرافي',
                    text: errorMsg,
                    icon: 'warning',
                    confirmButtonColor: '#C9A961',
                    confirmButtonText: 'موافق'
                });
            },
            {
                enableHighAccuracy: true,
                timeout: 8000,
                maximumAge: 0
            }
        );
    } else {
        showNotification('تحديد الموقع غير مدعوم في متصفحك', 'error');
    }
});

// Sync manual coordinate changes with the map
function syncMapWithCoordinates() {
    const val = document.getElementById('coordinates').value;
    if (!val) return;
    const parts = val.split(',');
    if (parts.length !== 2) return;
    const lat = parseFloat(parts[0].trim());
    const lng = parseFloat(parts[1].trim());
    
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

    if (selectionMarker) map.removeLayer(selectionMarker);
    selectionMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
    selectionMarker.bindPopup('الموقع المحدد').openPopup();

    selectionMarker.on('dragend', function (event) {
        const position = event.target.getLatLng();
        document.getElementById('coordinates').value = `${position.lat.toFixed(6)}, ${position.lng.toFixed(6)}`;
    });

    map.setView([lat, lng], 15);
}

document.getElementById('coordinates').addEventListener('input', syncMapWithCoordinates);
document.getElementById('coordinates').addEventListener('change', syncMapWithCoordinates);

// Update General Stats
function updateStats() {
    document.getElementById('totalProjects').textContent = projects.length;
    const developers = new Set();
    projects.forEach((project) => {
        let details = project.details;
        if (typeof details === 'string') {
            try { details = JSON.parse(details); } catch (error) { details = {}; }
        }
        const developer = details && (details.developer || details.developer_name || details.developerName);
        if (developer && String(developer).trim()) developers.add(String(developer).trim());
    });
    const developerCount = document.getElementById('developerCount');
    if (developerCount) developerCount.textContent = formatNumber(developers.size);

    // Last Added
    if (projects.length > 0) {
        // Sort by date if needed, but API already returns sorted
        const last = projects[0];
        document.getElementById('lastAdded').textContent = last.name;
    }
}

// Admin Stats — fully defensive (never throws, never affects loadProjects)
function updateAdminDashboard() {
    try {
        if (!currentUser || currentUser.role !== 'admin') return;

        const setEl = (id, val) => {
            const el = document.getElementById(id);
            if (el) animateCounter(el, val, 600);
        };

        setEl('adminTotalProjects', projects.length);

        // This month
        const now = new Date();
        const thisMonth = projects.filter(p => {
            try {
                const d = new Date(p.date_added);
                return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
            } catch (e) { return false; }
        }).length;
        setEl('adminThisMonth', thisMonth);

        // Pending projects needing approval
        const pendingCount = projects.filter(p => p && p.status === 'pending').length;
        setEl('adminPendingCount', pendingCount);
        const pendingCard = document.getElementById('adminPendingCard');
        if (pendingCard) {
            pendingCard.classList.toggle('has-pending', pendingCount > 0);
            // Make pending card clickable — opens approvals tab
            pendingCard.style.cursor = 'pointer';
            pendingCard.onclick = function () {
                const approvalsTabBtn = document.getElementById('approvalsTab');
                if (approvalsTabBtn) approvalsTabBtn.click();
            };
        }
        updateApprovalsBadge();

        // Active users
        loadUsers();
    } catch (e) {
        console.error('updateAdminDashboard error (non-fatal):', e);
    }
}

// Switch Admin Tabs
window.switchAdminTab = function (tabId) {
    document.querySelectorAll('.admin-tab').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    document.querySelectorAll('.admin-content').forEach(div => div.classList.remove('active'));
    document.getElementById(tabId + '-content').classList.add('active');

    if (tabId === 'users') {
        loadUsers();
    } else if (tabId === 'activity') {
        loadActivity();
    } else if (tabId === 'approvals') {
        loadApprovals();
    }
};

// ── Admin Approvals Tab ───────────────────────────────────────────────────────
function loadApprovals() {
    const container = document.getElementById('approvalsList');
    if (!container) return;

    const pending = projects.filter(p => p && p.status === 'pending');

    if (pending.length === 0) {
        container.innerHTML = '<div class="approvals-empty">لا توجد مشاريع بانتظار الموافقة</div>';
        return;
    }

    container.innerHTML = '';
    pending.forEach(p => {
        const card = document.createElement('div');
        card.className = 'approval-card';
        card.id = `approval-card-${p.id}`;

        const dateStr = p.date_added ? new Date(p.date_added).toLocaleDateString('ar-SA') : '--';
        card.innerHTML = `
            <div class="approval-card-info">
                <h4>${esc(p.name)}</h4>
                <p>${esc(p.type)} &mdash; ${formatNumber(p.price)} ريال &mdash; ${formatNumber(p.area)} م²</p>
                <p>${esc(p.address || 'بدون عنوان')}</p>
                <p>رفعه: <strong>${esc(p.employee)}</strong> &mdash; ${esc(dateStr)}</p>
            </div>
            <div class="approval-card-actions">
                <button class="btn btn-approve btn-small" onclick="approveProject(${p.id})"><span>اعتماد</span></button>
                <button class="btn btn-reject btn-small" onclick="rejectProject(${p.id})"><span>رفض</span></button>
            </div>
        `;
        container.appendChild(card);
    });
}

// Update the badge count on the Approvals tab
function updateApprovalsBadge() {
    const badge = document.getElementById('approvalsBadge');
    if (!badge) return;
    const count = projects.filter(p => p && p.status === 'pending').length;
    badge.textContent = count > 0 ? count : '';
}

// ── Field Employee: My Projects Section ──────────────────────────────────────
function loadMyProjects() {
    if (!currentUser || currentUser.role !== 'field') return;
    const section = document.getElementById('myProjectsSection');
    const container = document.getElementById('myProjectsList');
    const countEl = document.getElementById('myProjectsCount');
    if (!section || !container) return;

    section.style.display = 'block';

    const mine = projects.filter(p => p && p.added_by === currentUser.username);

    if (countEl) countEl.textContent = mine.length + ' مشروع';

    if (mine.length === 0) {
        container.innerHTML = '<div class="my-projects-empty">لم ترفع أي مشاريع بعد</div>';
        return;
    }

    container.innerHTML = '';
    mine.forEach(p => {
        const card = document.createElement('div');
        card.className = `my-project-card status-${p.status || 'pending'}`;
        card.id = `my-project-card-${p.id}`;

        const statusMap = { approved: { text: 'مقبول', color: '#10b981' }, rejected: { text: 'مرفوض', color: '#ef4444' }, pending: { text: 'قيد المراجعة', color: '#f59e0b' } };
        const s = statusMap[p.status] || statusMap.pending;
        const dateStr = p.date_added ? new Date(p.date_added).toLocaleDateString('ar-SA') : '--';

        let rejectionHtml = '';
        if (p.status === 'rejected' && p.rejection_reason) {
            rejectionHtml = `
                <div class="rejection-note">
                    <strong>سبب الرفض من الإدارة:</strong>
                    ${esc(p.rejection_reason)}
                </div>`;
        }

        let actionsHtml = '';
        if (p.status === 'rejected') {
            actionsHtml = `
                <button class="btn btn-success btn-small" onclick="editProjectAndResubmit(${p.id})"><span>تعديل وإعادة الإرسال</span></button>
                <button class="btn btn-secondary btn-small" onclick="deleteProject(${p.id})"><span>حذف</span></button>`;
        } else if (p.status === 'pending') {
            actionsHtml = `<span class="pending-label">في انتظار مراجعة الإدارة...</span>`;
        }

        card.innerHTML = `
            <div class="my-project-card-info">
                <h4>${esc(p.name)}</h4>
                <p>${esc(p.type)} &mdash; ${formatNumber(p.price)} ريال</p>
                <p>${esc(p.address || 'بدون عنوان')} &mdash; <span style="color:${s.color}; font-weight:700;">${s.text}</span></p>
                <p style="font-size:0.78em;">${esc(dateStr)}</p>
                ${rejectionHtml}
            </div>
            <div class="my-project-card-actions">
                ${actionsHtml}
            </div>
        `;
        container.appendChild(card);
    });
}

// Edit a rejected project and scroll to form with a hint
window.editProjectAndResubmit = function (id) {
    editProject(id);
    setTimeout(() => {
        showNotification('عدّل البيانات ثم اضغط "حفظ التعديلات" لإعادة الإرسال للموافقة', 'info');
    }, 700);
};

// Load Users
async function loadUsers() {
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = '<tr><td colspan="5" class="loading">جاري التحميل...</td></tr>';

    try {
        const response = await fetch(`${API_URL}/users.php`);
        const users = await response.json();

        // Update count
        document.getElementById('userCount').textContent = users.length;
        document.getElementById('adminActiveUsers').textContent = users.length;

        tbody.innerHTML = '';
        users.forEach(user => {
            const tr = document.createElement('tr');
            
            // Block status badge
            const isBlocked = parseInt(user.is_blocked) === 1;
            const statusBadge = isBlocked 
                ? '<span class="status-badge blocked">معطل</span>' 
                : '<span class="status-badge active">نشط</span>';

            // Action buttons
            const toggleBlockText = isBlocked ? 'تفعيل' : 'تعطيل';
            
            tr.innerHTML = `
                <td>${esc(user.username)}</td>
                <td>${esc(user.fullname)}</td>
                <td><span class="role-badge ${esc(user.role)}">${esc(getRoleName(user.role))}</span></td>
                <td>${statusBadge}</td>
                <td>
                    <button class="btn-user-action change-pw" onclick="changeUserPassword(${Number(user.id)}, '${escJs(user.username)}')">
                        <span>كلمة المرور</span>
                    </button>
                    <button class="btn-user-action block-toggle" onclick="toggleUserBlock(${Number(user.id)}, ${isBlocked ? 0 : 1})">
                        <span>${toggleBlockText}</span>
                    </button>
                    <button class="btn-user-action delete-user" onclick="deleteUser(${Number(user.id)})">
                        <span>حذف</span>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="5" style="color:red">فشل تحميل المستخدمين</td></tr>';
    }
}

function getRoleName(role) {
    const names = { 'admin': 'مدير', 'field': 'ميداني', 'callcenter': 'كول سنتر' };
    return names[role] || role;
}

// Add User
document.getElementById('addUserForm') && document.getElementById('addUserForm').addEventListener('submit', async function (e) {
    e.preventDefault();

    const data = {
        username: document.getElementById('newUsername').value,
        fullname: document.getElementById('newFullname').value,
        password: document.getElementById('newPassword').value, // In real app, SSL is must
        role: document.getElementById('newRole').value
    };

    try {
        const response = await fetch(`${API_URL}/users.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();

        if (result.status === 'success') {
            showNotification('تم إضافة المستخدم بنجاح', 'success');
            this.reset();
            loadUsers();
        } else {
            showNotification(result.message, 'error');
        }
    } catch (error) {
        showNotification('فشل الاتصال بالخادم', 'error');
    }
});

// Delete User
window.deleteUser = async function (id) {
    const confirmResult = await Swal.fire({
        title: 'هل أنت متأكد من حذف هذا المستخدم؟',
        text: "لن تتمكن من استرجاع هذا الحساب!",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'نعم، احذفه!',
        cancelButtonText: 'إلغاء'
    });

    if (confirmResult.isConfirmed) {
        try {
            const response = await fetch(`${API_URL}/users.php?id=${id}`, { method: 'DELETE' });
            const result = await response.json();

            if (result.status === 'success') {
                showNotification('تم الحذف بنجاح', 'success');
                loadUsers();
            } else {
                showNotification(result.message || 'فشل الحذف', 'error');
            }
        } catch (error) {
            showNotification('فشل الاتصال بالخادم', 'error');
        }
    }
};

window.toggleUserBlock = async function (id, blockState) {
    const actionText = blockState ? 'تعطيل' : 'تفعيل';
    const confirmResult = await Swal.fire({
        title: `هل أنت متأكد من ${actionText} هذا المستخدم؟`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#C9A961',
        cancelButtonColor: '#d33',
        confirmButtonText: 'نعم',
        cancelButtonText: 'إلغاء'
    });

    if (confirmResult.isConfirmed) {
        try {
            const response = await fetch(`${API_URL}/users.php`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: id, action: 'toggle_block', is_blocked: blockState })
            });
            const result = await response.json();
            if (result.status === 'success') {
                showNotification(`تم ${actionText} المستخدم بنجاح`, 'success');
                loadUsers();
            } else {
                showNotification(result.message || 'فشل تحديث حالة المستخدم', 'error');
            }
        } catch (error) {
            showNotification('فشل الاتصال بالخادم', 'error');
        }
    }
};

window.changeUserPassword = async function (id, username) {
    const { value: password } = await Swal.fire({
        // titleText لا title: SweetAlert2 يضع title في innerHTML، واسم المستخدم من القاعدة
        titleText: `تعديل كلمة مرور: ${username}`,
        input: 'password',
        inputLabel: 'كلمة المرور الجديدة',
        inputPlaceholder: 'أدخل كلمة المرور الجديدة',
        inputAttributes: {
            autocapitalize: 'off',
            autocorrect: 'off'
        },
        showCancelButton: true,
        confirmButtonText: 'تعديل',
        cancelButtonText: 'إلغاء',
        confirmButtonColor: '#C9A961',
        inputValidator: (value) => {
            if (!value) {
                return 'يجب إدخال كلمة مرور جديدة!';
            }
            if (value.length < 4) {
                return 'يجب أن تكون كلمة المرور من 4 خانات على الأقل!';
            }
        }
    });

    if (password) {
        try {
            const response = await fetch(`${API_URL}/users.php`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: id, action: 'change_password', password: password })
            });
            const result = await response.json();
            if (result.status === 'success') {
                showNotification('تم تغيير كلمة المرور بنجاح', 'success');
            } else {
                showNotification(result.message || 'فشل تغيير كلمة المرور', 'error');
            }
        } catch (error) {
            showNotification('فشل الاتصال بالخادم', 'error');
        }
    }
};

// Load Activity — Premium Timeline
async function loadActivity() {
    const container = document.getElementById('activityLog');
    container.innerHTML = '<div class="loading">جاري التحميل...</div>';

    try {
        const response = await fetch(`${API_URL}/activities.php`);
        const activities = await response.json();

        container.innerHTML = '';
        if (!Array.isArray(activities) || activities.length === 0) {
            container.innerHTML = '<div class="no-data">لا توجد نشاطات حديثة</div>';
            return;
        }

        const timeline = document.createElement('div');
        timeline.className = 'activity-timeline';

        activities.forEach(act => {
            const { icon, color, label } = getActivityMeta(act.action);
            const timeAgo = formatActivityTime(act.timestamp);

            const item = document.createElement('div');
            item.className = 'timeline-item';
            item.innerHTML = `
                <div class="timeline-connector"></div>
                <div class="timeline-dot" style="background:${color}; border-color:${color}; box-shadow:0 0 6px ${color}66;"></div>
                <div class="timeline-card" style="border-right:3px solid ${color};">
                    <div class="timeline-card-header">
                        <span class="timeline-action" style="color:${color};">${esc(label)}</span>
                        <span class="timeline-time">${esc(timeAgo)}</span>
                    </div>
                    <div class="timeline-card-body">
                        <strong class="timeline-user">${esc(act.user_name || 'النظام')}</strong>
                        <span class="timeline-details">${esc(act.details)}</span>
                    </div>
                </div>
            `;
            timeline.appendChild(item);
        });

        container.appendChild(timeline);
    } catch (error) {
        container.innerHTML = '<div class="error">فشل تحميل النشاطات</div>';
    }
}

function getActivityMeta(action) {
    const map = {
        'تسجيل دخول':           { color: '#10b981', label: 'تسجيل دخول' },
        'تسجيل خروج':           { color: '#6366f1', label: 'تسجيل خروج' },
        'نسخ عرض كامل':         { color: '#c5a880', label: 'نسخ عرض للنشر' },
        'نسخ ملخص للعميل':      { color: '#a3875a', label: 'نسخ ملخص للعميل' },
        'مشاركة واتساب كامل':   { color: '#25D366', label: 'مشاركة واتساب (كامل)' },
        'مشاركة واتساب مختصر':  { color: '#128C7E', label: 'مشاركة واتساب (مختصر)' },
        'Add Project':           { color: '#c5a880', label: 'إضافة مشروع' },
        'Edit Project':          { color: '#f59e0b', label: 'تعديل مشروع' },
        'حذف مشروع':            { color: '#ef4444', label: 'حذف مشروع' },
        'Approve Project':       { color: '#10b981', label: 'اعتماد مشروع' },
        'Reject Project':        { color: '#dc2626', label: 'رفض مشروع' },
        'Update Availability':   { color: '#8b5cf6', label: 'تحديث توفر الوحدات' },
        'Add User':              { color: '#c5a880', label: 'إضافة مستخدم' },
        'Toggle Block':          { color: '#f59e0b', label: 'تعليق / إلغاء حساب' },
        'Change Password':       { color: '#6366f1', label: 'تغيير كلمة مرور' },
        'Delete User':           { color: '#ef4444', label: 'حذف مستخدم' },
    };
    return map[action] || { color: '#c5a880', label: action };
}

function formatActivityTime(timestamp) {
    try {
        const d = new Date(timestamp);
        if (isNaN(d.getTime())) return '--';
        return d.toLocaleString('ar-SA', {
            year:   'numeric',
            month:  'short',
            day:    'numeric',
            hour:   '2-digit',
            minute: '2-digit',
            hour12: true
        });
    } catch(e) { return '--'; }
}

// ── Image Slider Builder ──────────────────────────────────────────────────────
function buildImageSlider(images, projectId) {
    // رابط غير https مرفوض: الصور مخزَّنة في مخزن Supabase، وأي شيء آخر في الحقل
    // (javascript: مثلاً) لا يُعرض أصلاً
    const safe = (images || []).map(safeUrl).filter(Boolean);
    if (safe.length === 0) return '';
    const sliderId = `slider-${Number(projectId)}`;
    if (safe.length === 1) {
        return `<div style="margin-top:20px; border-radius:12px; overflow:hidden; max-height:300px;">
            <img src="${esc(safe[0])}" style="width:100%; height:280px; object-fit:cover; cursor:zoom-in; display:block;" onclick="window.open(this.src)">
        </div>`;
    }
    const slides = safe.map((src, i) => `
        <div class="img-slider-slide">
            <img src="${esc(src)}" alt="صورة ${i + 1}" onclick="window.open(this.src)">
        </div>`).join('');
    const dots = safe.map((_, i) => `<button class="img-slider-dot ${i === 0 ? 'active' : ''}" onclick="sliderGoTo('${sliderId}', ${i})"></button>`).join('');
    return `
        <div style="margin-top:20px;">
            <div class="img-slider-wrap" id="${sliderId}-wrap">
                <div class="img-slider-track" id="${sliderId}-track">${slides}</div>
                <button class="img-slider-btn img-slider-prev" onclick="sliderStep('${sliderId}', -1)">&#8250;</button>
                <button class="img-slider-btn img-slider-next" onclick="sliderStep('${sliderId}', 1)">&#8249;</button>
                <div class="img-slider-counter" id="${sliderId}-counter">1 / ${safe.length}</div>
            </div>
            <div class="img-slider-dots" id="${sliderId}-dots">${dots}</div>
        </div>`;
}

// Slider state stored per slider id
const _sliderIdx = {};

window.sliderGoTo = function (id, idx) {
    const track = document.getElementById(`${id}-track`);
    if (!track) return;
    const total = track.children.length;
    idx = ((idx % total) + total) % total;
    _sliderIdx[id] = idx;
    track.style.transform = `translateX(${idx * 100}%)`;
    // dots
    const dotsEl = document.getElementById(`${id}-dots`);
    if (dotsEl) dotsEl.querySelectorAll('.img-slider-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
    // counter
    const counter = document.getElementById(`${id}-counter`);
    if (counter) counter.textContent = `${idx + 1} / ${total}`;
};

window.sliderStep = function (id, dir) {
    const current = _sliderIdx[id] || 0;
    sliderGoTo(id, current + dir);
};

// ── Fetch full project (all images) on-demand ──────────────────
async function fetchFullProject(id) {
    try {
        const role     = currentUser ? currentUser.role     : 'callcenter';
        const username = currentUser ? currentUser.username : '';
        const resp = await fetch(
            `${API_URL}/projects.php?id=${id}&role=${encodeURIComponent(role)}&username=${encodeURIComponent(username)}`
        );
        const full = await resp.json();
        if (full && full.id) return full;
    } catch (e) {
        console.error('fetchFullProject failed:', e);
    }
    return null;
}

function listingShareValidation(project) {
    if (!project) return { ok: false, message: 'العقار غير موجود' };
    if (!String(project.rega_ad_license || '').trim()) {
        return { ok: false, message: 'لا يمكن مشاركة هذا العقار قبل إدخال رقم ترخيص الإعلان (REGA).' };
    }
    const expiresKey = dateKey(project.listing_expires_at);
    if (project.listing_expires_at && !expiresKey) {
        return { ok: false, message: 'صيغة تاريخ انتهاء الإعلان غير صحيحة. حدّث التاريخ قبل المشاركة.' };
    }
    if (expiresKey && expiresKey < todayDateKeyRiyadh()) {
        return { ok: false, message: 'لا يمكن مشاركة هذا العقار لأن ترخيص الإعلان منتهي.' };
    }
    return { ok: true, message: '' };
}

function todayDateKeyRiyadh() {
    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Riyadh',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(new Date());
        const pick = (type) => (parts.find((p) => p.type === type) || {}).value || '';
        const y = pick('year');
        const m = pick('month');
        const d = pick('day');
        if (y && m && d) return y + '-' + m + '-' + d;
    } catch (error) {
        /* fallback below */
    }
    return new Date().toISOString().slice(0, 10);
}

function dateKey(value) {
    if (!value) return '';
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return [
            String(value.getFullYear()).padStart(4, '0'),
            String(value.getMonth() + 1).padStart(2, '0'),
            String(value.getDate()).padStart(2, '0')
        ].join('-');
    }
    const raw = String(value).trim();
    const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) {
        const ymd = m[1];
        const parts = ymd.split('-').map((n) => Number(n));
        const y = parts[0], mon = parts[1], day = parts[2];
        if (!Number.isInteger(y) || !Number.isInteger(mon) || !Number.isInteger(day)) return '';
        if (mon < 1 || mon > 12 || day < 1 || day > 31) return '';
        const d = new Date(Date.UTC(y, mon - 1, day));
        if (d.getUTCFullYear() !== y || (d.getUTCMonth() + 1) !== mon || d.getUTCDate() !== day) return '';
        return ymd;
    }
    return '';
}

function ensureListingShareable(id) {
    const p = projects.find(x => x.id == id);
    const check = listingShareValidation(p);
    if (check.ok) return p;
    Swal.fire({
        title: 'المشاركة غير متاحة',
        text: check.message || 'هذا العقار غير مؤهل للمشاركة حالياً.',
        icon: 'warning',
        confirmButtonColor: '#C9A961'
    });
    return null;
}

// View Project (Modal)
window.viewProject = async function (id) {
    const base = projects.find(x => x.id == id);
    if (!base) return;

    const modal = document.getElementById('projectModal');
    const body  = document.getElementById('modalBody');

    // Show modal immediately with a spinner while images load
    body.innerHTML = `
        <div style="text-align:center;padding:60px 20px;color:var(--text-muted);">
            <div style="width:38px;height:38px;border:3px solid var(--border-light);border-top-color:var(--primary-gold);
                        border-radius:50%;animation:spin 0.7s linear infinite;margin:0 auto 14px;"></div>
            <p style="font-size:0.95em;">جاري تحميل تفاصيل المشروع...</p>
        </div>`;
    modal.style.display = 'block';

    // Fetch full project data (with all images) from server
    const full = await fetchFullProject(id);
    const p = full || base;

    const canEdit = currentUser.role === 'admin' || (currentUser.role === 'field' && p.added_by === currentUser.username);

    // Parse details if string
    let details = p.details;
    if (typeof details === 'string') {
        try { details = JSON.parse(details); } catch (e) { details = {}; }
    }

    // Parse images if string
    let images = p.images;
    if (typeof images === 'string') {
        try { images = JSON.parse(images); } catch (e) { images = []; }
    }

    const unitCommissions = Array.isArray(details?.models)
        ? details.models.map((model) => Number(model.commission)).filter((value) => Number.isFinite(value) && value > 0)
        : [];
    const showCommission = currentUser && currentUser.role !== 'callcenter';
    const commissionSummary = (showCommission && unitCommissions.length)
        ? `<div class="project-detail"><span>أعلى عمولة للوحدة</span><span>${formatNumber(Math.max(...unitCommissions))} ريال</span></div>`
        : '';
    const shareCheck = listingShareValidation(p);
    const shareDisabledAttrs = shareCheck.ok
        ? ''
        : `disabled aria-disabled="true" data-share-blocked="1" aria-describedby="shareBlockReason-${Number(p.id)}" title="${esc(shareCheck.message || 'يتطلب رقم ترخيص إعلان ساري')}"`;

    // Helper for date
    const dateStr = p.date_added ? new Date(p.date_added).toLocaleString('ar-SA') : 'غير متوفر';

    body.innerHTML = `
        <h2 style="font-family: 'Almarai'; font-weight: 800; color: var(--text-primary); margin-bottom: 25px; font-size: 2em;">${esc(p.name)}</h2>
        <div class="project-detail"><span>النوع</span><span>${esc(p.type)}</span></div>
        <div class="project-detail"><span>المطور</span><span>${esc(details.developer || p.developer || 'غير محدد')}</span></div>
        <div class="project-detail"><span>السعر</span><span>${formatNumber(p.price)} ريال</span></div>
        ${commissionSummary}
        <div class="project-detail"><span>المساحة</span><span>${formatNumber(p.area)} م²</span></div>
        <div class="project-detail"><span>الموقع</span><span>${esc(p.address || 'غير محدد')}</span></div>
        <div class="project-detail"><span>الموظف</span><span>${esc(p.employee)}</span></div>
        <div class="project-detail"><span>التاريخ</span><span>${esc(dateStr)}</span></div>
        <div class="project-detail"><span>حالة توفر الوحدات</span><span>${getAvailabilityBadgeHtml(p.availability)}</span></div>
        <div class="project-detail"><span>الحالة</span><span>${getStatusBadgeHtml(p.status)}</span></div>
        
        ${p.status === 'rejected' && p.rejection_reason ? `
            <div class="rejection-reason-box">
                <strong>سبب الرفض من قبل الإدارة:</strong>
                <p>${esc(p.rejection_reason)}</p>
            </div>
        ` : ''}

        ${currentUser.role === 'admin' && p.status === 'pending' ? `
            <div class="admin-actions">
                <button class="btn btn-approve" onclick="approveProject(${p.id})"><span>اعتماد وقبول المشروع</span></button>
                <button class="btn btn-reject" onclick="rejectProject(${p.id})"><span>رفض المشروع</span></button>
            </div>
        ` : ''}

        ${canEdit ? `
            <div class="admin-actions" style="margin-top: 15px;">
                ${p.availability === 'sold_out'
                    ? `<button class="btn btn-approve" style="background:#10b981; border-color:#10b981;" onclick="toggleAvailability(${p.id}, 'available')"><span>تغيير حالة الوحدات إلى: متاحة</span></button>`
                    : `<button class="btn btn-reject" style="background:#ef4444; border-color:#ef4444;" onclick="toggleAvailability(${p.id}, 'sold_out')"><span>تغيير حالة الوحدات إلى: نفدت بالكامل</span></button>`
                }
            </div>
        ` : ''}
        
        ${details ? `
            <div style="margin-top:20px; border-top:1px solid #eee; padding-top:10px;">
                <h4 style="margin-bottom:10px;">تفاصيل العقار</h4>
                ${details.construction_status ? `
                    <p><strong>حالة البناء:</strong> ${details.construction_status === 'تحت_الإنشاء' ? 'تحت الإنشاء' : 'جاهز'}</p>
                ` : ''}
                ${details.support_type ? `
                    <p><strong>نوع الدعم:</strong> ${details.support_type === 'غير_مدعوم' ? 'غير مدعوم' : details.support_type === 'تمويل' ? 'تمويل لغير المدعومين' : esc(details.support_type)}</p>
                ` : ''}
                ${details.delivery_time ? `
                    <p style="background:rgba(184,150,46,0.08);border-right:3px solid var(--primary-gold);padding:8px 12px;border-radius:6px;margin:8px 0;">
                        <strong>⏱ موعد التسليم:</strong> ${esc(details.delivery_time)}
                    </p>
                ` : ''}
                ${safeUrl(details.drive_link) ? `
                    <p style="margin:8px 0;">
                        <strong>🔗 رابط الدرايف:</strong>
                        <a href="${esc(safeUrl(details.drive_link))}" target="_blank" rel="noopener"
                           style="color:var(--primary-gold);word-break:break-all;">فتح الرابط ↗</a>
                    </p>
                ` : ''}
                ${p.type === 'أرض' ? `<p><strong>واجهة:</strong> ${esc(details.interface || '-')}</p><p><strong>أضلاع:</strong> ${esc(details.sides || '-')}</p>` : ''}
                ${p.type === 'فيلا' ? `
                    <p><strong>مساحة المباني:</strong> ${esc(details.buildingArea)} م²</p>
                    <p><strong>الواجهة:</strong> ${esc(details.interface || '-')}</p>
                    <p><strong>النوع:</strong> ${esc(details.villaType || '-')}</p>
                    <p><strong>عدد الغرف:</strong> ${esc(details.rooms || '-')}</p>
                    <p><strong>العمر:</strong> ${esc(details.age || '-')} سنة</p>
                ` : ''}
                 ${p.type === 'شقة' ? `
                    <p><strong>عدد الشقق:</strong> ${esc(details.aptCount || 0)}</p>
                    <p><strong>عدد الروفات:</strong> ${esc(details.roofCount || 0)}</p>
                    ${details.models && Array.isArray(details.models) && details.models.length > 0 ? `
                        <div style="margin-top: 15px;">
                            <h5 style="margin-bottom: 8px; color: var(--primary-gold); font-size: 1.1em;">نماذج الوحدات</h5>
                            <div class="table-responsive" style="overflow-x: auto;">
                                <table style="width: 100%; border-collapse: collapse; text-align: right; font-size: 0.9em;">
                                    <thead>
                                        <tr style="border-bottom: 2px solid #ddd; background-color: #f5f5f5;">
                                            <th style="padding: 8px;">النموذج</th>
                                            <th style="padding: 8px;">النوع</th>
                                            <th style="padding: 8px;">غرف</th>
                                            <th style="padding: 8px;">حمامات</th>
                                            <th style="padding: 8px;">المساحة</th>
                                            <th style="padding: 8px;">السعر</th>
                                            ${showCommission ? '<th style="padding: 8px;">العمولة</th>' : ''}
                                            <th style="padding: 8px;">الحالة</th>
                                            <th style="padding: 8px;">العدد</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${details.models.map(m => {
                                            let statusBadge = '';
                                            if (m.status === 'available') statusBadge = '<span style="color: #2ecc71; font-weight: bold;">متاح</span>';
                                            else if (m.status === 'reserved') statusBadge = '<span style="color: #f39c12; font-weight: bold;">محجوز</span>';
                                            else if (m.status === 'sold') statusBadge = '<span style="color: #e74c3c; font-weight: bold;">مباع</span>';
                                            return `
                                                <tr style="border-bottom: 1px solid #eee;">
                                                    <td style="padding: 8px;">${esc(m.name)}</td>
                                                    <td style="padding: 8px;">${esc(m.type || 'شقة')}</td>
                                                    <td style="padding: 8px;">${esc(m.rooms)}</td>
                                                    <td style="padding: 8px;">${esc(m.bathrooms)}</td>
                                                    <td style="padding: 8px;">${esc(m.area)} م²</td>
                                                    <td style="padding: 8px;">${formatNumber(m.price)} ر.س</td>
                                                    ${showCommission ? `<td style="padding: 8px;">${formatNumber(m.commission)} ر.س</td>` : ''}
                                                    <td style="padding: 8px;">${statusBadge}</td>
                                                    <td style="padding: 8px;">${esc(m.count || 1)}</td>
                                                </tr>
                                            `;
                                        }).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ` : ''}
                ` : ''}
            </div>
        ` : ''}

        ${p.notes ? `<div style="margin-top:20px; background:#f9f9f9; padding:15px; border-radius:10px;"><p><strong>ملاحظات:</strong> ${esc(p.notes)}</p></div>` : ''}

        <div class="share-actions" style="margin-top: 25px; padding-top: 20px; border-top: 1px solid var(--border-light); display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
            <button class="btn btn-outline" style="border-color: var(--primary-gold); color: var(--primary-gold); font-size: 0.95em; padding: 12px 20px;" onclick="copyProjectDetails(${p.id})" ${shareDisabledAttrs}>
                <span>نسخ للنشر (كامل)</span>
            </button>
            <button class="btn btn-outline" style="border-color: var(--primary-gold); color: var(--primary-gold); font-size: 0.95em; padding: 12px 20px;" onclick="copyProjectDetailsShort(${p.id})" ${shareDisabledAttrs}>
                <span>نسخ للعميل (مختصر)</span>
            </button>
            <button class="btn btn-success" style="background: linear-gradient(135deg, #25D366 0%, #128C7E 100%); border-color: transparent; color: #fff; font-size: 0.95em; padding: 12px 20px;" onclick="shareProjectWhatsApp(${p.id})" ${shareDisabledAttrs}>
                <span>واتساب (كامل)</span>
            </button>
            <button class="btn btn-success" style="background: linear-gradient(135deg, #25D366 0%, #128C7E 100%); border-color: transparent; color: #fff; font-size: 0.95em; padding: 12px 20px;" onclick="shareProjectWhatsAppShort(${p.id})" ${shareDisabledAttrs}>
                <span>واتساب (مختصر)</span>
            </button>
        </div>
        ${shareCheck.ok ? '' : `<p id="shareBlockReason-${Number(p.id)}" class="crm-share-note" style="margin-top:10px; color:#b45309; font-size:0.9em;">${esc(shareCheck.message)}</p>`}

        ${images && images.length > 0 ? buildImageSlider(images, p.id) : ''}
    `;

    document.getElementById('modalClose').onclick = function () {
        modal.style.display = 'none';
        body.innerHTML = '';
    }

    // Close on outside click (without overriding global window handlers)
    modal.onclick = function (event) {
        if (event.target == modal) {
            modal.style.display = 'none';
            body.innerHTML = '';
        }
    };

    modal.style.display = 'block';
};

// WhatsApp Sharing & Text Generation Logic
window.getWhatsAppMessage = function(id) {
    const p = projects.find(x => x.id == id);
    if (!p) return '';

    // Parse details if string
    let details = p.details;
    if (typeof details === 'string') {
        try { details = JSON.parse(details); } catch (e) { details = {}; }
    }
    details = details || {};

    let msg = `*نظام ملائم العقاري - تفاصيل مشروع: ${p.name}*\n`;
    msg += `------------------------------------------\n`;
    msg += `*النوع:* ${p.type}\n`;
    msg += `*السعر:* ${formatNumber(p.price)} ريال\n`;
    msg += `*المساحة:* ${formatNumber(p.area)} م²\n`;
    if (p.address) msg += `*العنوان:* ${p.address}\n`;
    if (p.latitude && p.longitude) {
        msg += `*رابط الموقع على الخريطة:* https://www.google.com/maps?q=${p.latitude},${p.longitude}\n`;
    }

    // Classification details
    if (details.construction_status) msg += `*حالة البناء:* ${details.construction_status === 'تحت_الإنشاء' ? 'تحت الإنشاء' : 'جاهز'}\n`;
    if (details.support_type) {
        const sLabel = details.support_type === 'غير_مدعوم' ? 'غير مدعوم' : details.support_type === 'تمويل' ? 'تمويل لغير المدعومين' : details.support_type;
        msg += `*نوع الدعم:* ${sLabel}\n`;
    }
    if (details.delivery_time) msg += `*موعد التسليم:* ${details.delivery_time}\n`;
    if (details.drive_link) msg += `*رابط الدرايف:* ${details.drive_link}\n`;

    // Dynamic details depending on type
    if (p.type === 'أرض') {
        if (details.interface) msg += `*الواجهة:* ${details.interface}\n`;
        if (details.sides) msg += `*أضلاع الأرض:* ${details.sides}\n`;
    } else if (p.type === 'فيلا') {
        if (details.buildingArea) msg += `*مساحة المباني:* ${details.buildingArea} م²\n`;
        if (details.interface) msg += `*الواجهة:* ${details.interface}\n`;
        if (details.villaType) msg += `*نوع الفيلا:* ${details.villaType}\n`;
        if (details.rooms) msg += `*عدد الغرف:* ${details.rooms}\n`;
        if (details.age) msg += `*عمر العقار:* ${details.age} سنة\n`;
    } else if (p.type === 'شقة') {
        if (details.aptCount) msg += `*عدد الشقق:* ${details.aptCount}\n`;
        if (details.roofCount) msg += `*عدد الروفات:* ${details.roofCount}\n`;
        
        if (details.models && Array.isArray(details.models) && details.models.length > 0) {
            msg += `\n*النماذج والوحدات المتاحة:*\n`;
            details.models.forEach(m => {
                let statusText = 'متاح';
                if (m.status === 'reserved') statusText = 'محجوز';
                else if (m.status === 'sold') statusText = 'مباع';
                msg += `- ${m.name} (${m.type || 'شقة'}): غرف: ${m.rooms} | حمامات: ${m.bathrooms} | مساحة: ${m.area}م² | سعر: ${formatNumber(m.price)} ر.س | الحالة: ${statusText}\n`;
            });
        }
    }

    if (p.notes) {
        msg += `\n*ملاحظات إضافية:*\n${p.notes}\n`;
    }

    return msg;
};

window.copyProjectDetails = function(id) {
    if (!ensureListingShareable(id)) return;
    const msg = window.getWhatsAppMessage(id);
    if (!msg) return;

    const _p = projects.find(x => x.id == id);
    logActivity('نسخ عرض كامل', `نسخ تفاصيل العرض الكامل للنشر: ${_p ? _p.name : id}`);

    navigator.clipboard.writeText(msg).then(() => {
        Swal.fire({
            title: 'تم النسخ بنجاح!',
            text: 'تم نسخ تفاصيل المشروع بصيغة مناسبة للنشر والمشاركة.',
            icon: 'success',
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 3000,
            timerProgressBar: true
        });
    }).catch(err => {
        console.error('Failed to copy text: ', err);
        Swal.fire({
            title: 'خطأ',
            text: 'فشل نسخ النص. يرجى التحديد والنسخ يدوياً.',
            icon: 'error',
            confirmButtonColor: '#C9A961'
        });
    });
};

window.shareProjectWhatsApp = function(id) {
    if (!ensureListingShareable(id)) return;
    const msg = window.getWhatsAppMessage(id);
    if (!msg) return;

    const _p = projects.find(x => x.id == id);
    logActivity('مشاركة واتساب كامل', `شارك العرض الكامل عبر واتساب: ${_p ? _p.name : id}`);

    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
};

window.getWhatsAppMessageShort = function(id) {
    const p = projects.find(x => x.id == id);
    if (!p) return '';

    let msg = `*ملخص عقار: ${p.name}*\n`;
    msg += `------------------------------------------\n`;
    msg += `*النوع:* ${p.type}\n`;
    msg += `*السعر:* ${formatNumber(p.price)} ريال\n`;
    msg += `*المساحة:* ${formatNumber(p.area)} م²\n`;
    if (p.address) msg += `*العنوان:* ${p.address}\n`;
    if (p.latitude && p.longitude) {
        msg += `*رابط الموقع:* https://www.google.com/maps?q=${p.latitude},${p.longitude}\n`;
    }
    return msg;
};

window.copyProjectDetailsShort = function(id) {
    if (!ensureListingShareable(id)) return;
    const msg = window.getWhatsAppMessageShort(id);
    if (!msg) return;

    const _p = projects.find(x => x.id == id);
    logActivity('نسخ ملخص للعميل', `نسخ الملخص المختصر للعميل: ${_p ? _p.name : id}`);

    navigator.clipboard.writeText(msg).then(() => {
        Swal.fire({
            title: 'تم النسخ بنجاح!',
            text: 'تم نسخ الملخص المختصر للعميل.',
            icon: 'success',
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 3000,
            timerProgressBar: true
        });
    }).catch(err => {
        console.error('Failed to copy text: ', err);
        Swal.fire({
            title: 'خطأ',
            text: 'فشل نسخ النص.',
            icon: 'error',
            confirmButtonColor: '#C9A961'
        });
    });
};

window.shareProjectWhatsAppShort = function(id) {
    if (!ensureListingShareable(id)) return;
    const msg = window.getWhatsAppMessageShort(id);
    if (!msg) return;

    const _p = projects.find(x => x.id == id);
    logActivity('مشاركة واتساب مختصر', `شارك الملخص المختصر عبر واتساب: ${_p ? _p.name : id}`);

    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
};

window.approveProject = async function (id) {
    try {
        const response = await fetch(`${API_URL}/projects.php?id=${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'approve', adminUser: currentUser.username })
        });
        const res = await response.json();
        if (res.status === 'success') {
            // Remove the card from approvals list immediately without full reload
            const approvalCard = document.getElementById(`approval-card-${id}`);
            if (approvalCard) approvalCard.remove();

            Swal.fire({
                title: 'تم القبول!',
                text: 'تم قبول المشروع بنجاح.',
                icon: 'success',
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 2500,
                timerProgressBar: true
            });
            // Close modal if open
            document.getElementById('projectModal').style.display = 'none';
            document.getElementById('modalBody').innerHTML = '';
            loadProjects();
        } else {
            Swal.fire('خطأ', res.message || 'حدث خطأ أثناء معالجة الطلب', 'error');
        }
    } catch (e) {
        console.error(e);
        Swal.fire('خطأ', 'فشل الاتصال بالخادم', 'error');
    }
};

window.rejectProject = async function (id) {
    const { value: reason } = await Swal.fire({
        title: 'رفض المشروع',
        input: 'textarea',
        inputLabel: 'سبب الرفض',
        inputPlaceholder: 'اكتب سبب رفض المشروع هنا...',
        inputAttributes: {
            'aria-label': 'اكتب سبب رفض المشروع هنا'
        },
        showCancelButton: true,
        confirmButtonText: 'تأكيد الرفض',
        cancelButtonText: 'إلغاء',
        confirmButtonColor: '#dc3545',
        inputValidator: (value) => {
            if (!value) {
                return 'يجب كتابة سبب الرفض!';
            }
        }
    });

    if (reason) {
        try {
            const response = await fetch(`${API_URL}/projects.php?id=${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'reject', rejection_reason: reason, adminUser: currentUser.username })
            });
            const res = await response.json();
            if (res.status === 'success') {
                // Remove the card from approvals list immediately
                const approvalCard = document.getElementById(`approval-card-${id}`);
                if (approvalCard) approvalCard.remove();

                Swal.fire({
                    title: 'تم الرفض!',
                    text: 'تم رفض المشروع وإشعار الموظف بالسبب.',
                    icon: 'info',
                    toast: true,
                    position: 'top-end',
                    showConfirmButton: false,
                    timer: 2500,
                    timerProgressBar: true
                });
                document.getElementById('projectModal').style.display = 'none';
                document.getElementById('modalBody').innerHTML = '';
                loadProjects();
            } else {
                Swal.fire('خطأ', res.message || 'حدث خطأ أثناء معالجة الطلب', 'error');
            }
        } catch (e) {
            console.error(e);
            Swal.fire('خطأ', 'فشل الاتصال بالخادم', 'error');
        }
    }
};

// Delete Project
window.deleteProject = async function (id) {
    const result = await Swal.fire({
        title: 'هل أنت متأكد؟',
        text: "لن تتمكن من استرجاع هذا المشروع!",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'نعم، احذفه!',
        cancelButtonText: 'إلغاء'
    });

    if (result.isConfirmed) {
        try {
            const response = await fetch(`${API_URL}/projects.php?id=${id}`, { method: 'DELETE' });
            const res = await response.json();
            if (res.status === 'success') {
                Swal.fire('تم الحذف!', 'تم حذف المشروع بنجاح.', 'success');
                loadProjects();
            } else {
                Swal.fire('خطأ!', res.message || 'فشل الحذف', 'error');
            }
        } catch (error) {
            Swal.fire('خطأ!', 'فشل الاتصال بالخادم', 'error');
        }
    }
};

// Toggle Project Availability
window.toggleAvailability = async function (id, newStatus) {
    try {
        const response = await fetch(`${API_URL}/projects.php?id=${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                action: 'update_availability', 
                availability: newStatus, 
                adminUser: currentUser.username 
            })
        });
        const res = await response.json();
        if (res.status === 'success') {
            showNotification('تم تحديث حالة توفر الوحدات بنجاح!', 'success');
            const modal = document.getElementById('projectModal');
            if (modal && modal.style.display === 'block') {
                viewProject(id);
            }
            loadProjects();
        } else {
            showNotification(res.message || 'حدث خطأ أثناء تحديث حالة التوفر', 'error');
        }
    } catch (e) {
        console.error(e);
        showNotification('فشل الاتصال بالخادم', 'error');
    }
};

// Image preview change listener
document.getElementById('images').addEventListener('change', function(e) {
    const preview = document.getElementById('imagePreview');
    preview.innerHTML = '';
    Array.from(e.target.files).forEach(file => {
        const reader = new FileReader();
        reader.onload = function(e) {
            const img = document.createElement('img');
            img.src = e.target.result;
            img.style.width = '80px';
            img.style.height = '80px';
            img.style.objectFit = 'cover';
            img.style.borderRadius = '8px';
            preview.appendChild(img);
        };
        reader.readAsDataURL(file);
    });
});

// Edit Project
window.editProject = async function(id) {
    const base = projects.find(p => p.id == id);
    if (!base) return;

    if (currentUser.role !== 'admin' && base.added_by !== currentUser.username) {
        showNotification('ليس لديك صلاحية لتعديل هذا المشروع', 'info');
        return;
    }

    // Fetch full project data so we have ALL existing images (not just thumbnail)
    const full = await fetchFullProject(id);
    const project = full || base;

    const formTitle = document.getElementById('formTitle');
    if (formTitle) {
        const svgEl = formTitle.querySelector('svg');
        const spanEl = formTitle.querySelector('span');
        if (svgEl) svgEl.innerHTML = '<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>';
        if (spanEl) spanEl.textContent = 'تعديل المشروع';
    }
    document.getElementById('editProjectId').value = id;
    document.getElementById('projectName').value = project.name;
    document.getElementById('propertyType').value = project.type;
    document.getElementById('availability').value = project.availability || 'available';
    
    // Trigger change event to show appropriate sub-sections
    const event = new Event('change');
    document.getElementById('propertyType').dispatchEvent(event);

    // Set prices and areas depending on type
    if (project.type === 'أرض') {
        document.getElementById('landPrice').value = project.price;
        document.getElementById('landArea').value = project.area;
    } else if (project.type === 'فيلا') {
        document.getElementById('villaPrice').value = project.price;
        document.getElementById('villaLandArea').value = project.area;
    } else {
        document.getElementById('price').value = project.price;
        document.getElementById('area').value = project.area;
    }

    document.getElementById('address').value = project.address || '';
    document.getElementById('regaAdLicense').value = project.rega_ad_license || '';
    document.getElementById('listingExpiresAt').value = project.listing_expires_at || '';
    document.getElementById('coordinates').value = `${project.latitude}, ${project.longitude}`;
    document.getElementById('notes').value = project.notes || '';
    
    // Load details
    let details = project.details;
    if (typeof details === 'string') {
        try { details = JSON.parse(details); } catch (e) { details = {}; }
    }
    details = details || {};

    // Restore classification fields
    const constructionEl = document.getElementById('constructionStatus');
    constructionEl.value = details.construction_status || '';
    constructionEl.dispatchEvent(new Event('change')); // triggers supportType options & delivery field
    setTimeout(() => {
        document.getElementById('supportType').value = details.support_type || '';
        document.getElementById('deliveryTime').value = details.delivery_time || '';
    }, 50);

    // Restore Drive link
    document.getElementById('driveLink').value = details.drive_link || '';

    if (project.type === 'أرض') {
        document.getElementById('landSides').value = details.sides || '';
        document.getElementById('landInterface').value = details.interface || '';
    } else if (project.type === 'فيلا') {
        document.getElementById('villaBuildingArea').value = details.buildingArea || '';
        document.getElementById('villaInterface').value = details.interface || '';
        document.getElementById('villaType').value = details.villaType || '';
        document.getElementById('villaRooms').value = details.rooms || '';
        document.getElementById('villaAge').value = details.age || '';
    } else if (project.type === 'شقة') {
        document.getElementById('aptCount').value = details.aptCount || '';
        document.getElementById('roofCount').value = details.roofCount || '';
        
        // Populate unit models
        const container = document.getElementById('unitModelsContainer');
        container.innerHTML = '';
        if (details.models && Array.isArray(details.models)) {
            details.models.forEach(model => {
                addUnitModel(model);
            });
        }
    }

    // Handle existing images
    let images = project.images;
    if (typeof images === 'string') {
        try { images = JSON.parse(images); } catch (e) { images = []; }
    }
    window.editingProjectImages = images || [];
    
    // Show image preview of existing images
    const preview = document.getElementById('imagePreview');
    preview.innerHTML = '';
    window.editingProjectImages.forEach(img => {
        const el = document.createElement('img');
        el.src = img;
        el.style.width = '80px';
        el.style.height = '80px';
        el.style.objectFit = 'cover';
        el.style.borderRadius = '8px';
        preview.appendChild(el);
    });

    // Update map marker to show the project location using syncMapWithCoordinates
    if (project.latitude && project.longitude) {
        syncMapWithCoordinates();
        if (selectionMarker) {
            selectionMarker.bindPopup('موقع المشروع المراد تعديله').openPopup();
        }
    }

    const submitBtnEl = document.getElementById('submitBtn');
    if (submitBtnEl) {
        const svgEl = submitBtnEl.querySelector('svg');
        const spanEl = submitBtnEl.querySelector('span');
        if (svgEl) svgEl.innerHTML = '<path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/>';
        if (spanEl) spanEl.textContent = 'حفظ التعديلات';
    }
    document.getElementById('cancelEditBtn').style.display = 'block';
    document.getElementById('resetBtn').style.display = 'none';
    document.getElementById('formSection').scrollIntoView({ behavior: 'smooth' });
};

document.getElementById('cancelEditBtn').addEventListener('click', cancelEdit);

function cancelEdit() {
    const formTitle = document.getElementById('formTitle');
    if (formTitle) {
        const svgEl = formTitle.querySelector('svg');
        const spanEl = formTitle.querySelector('span');
        if (svgEl) svgEl.innerHTML = '<path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>';
        if (spanEl) spanEl.textContent = 'إضافة مشروع جديد';
    }
    document.getElementById('editProjectId').value = '';
    document.getElementById('projectForm').reset();
    document.getElementById('imagePreview').innerHTML = '';
    document.getElementById('coordinates').value = '';
    if (selectionMarker) {
        map.removeLayer(selectionMarker);
        selectionMarker = null;
    }
    const submitBtnEl = document.getElementById('submitBtn');
    if (submitBtnEl) {
        const svgEl = submitBtnEl.querySelector('svg');
        const spanEl = submitBtnEl.querySelector('span');
        if (svgEl) svgEl.innerHTML = '<path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>';
        if (spanEl) spanEl.textContent = 'إضافة المشروع';
    }
    document.getElementById('cancelEditBtn').style.display = 'none';
    document.getElementById('resetBtn').style.display = 'block';
    window.editingProjectImages = [];
    document.getElementById('unitModelsContainer').innerHTML = '';
}

document.getElementById('resetBtn').addEventListener('click', function() {
    document.getElementById('projectForm').reset();
    document.getElementById('imagePreview').innerHTML = '';
    document.getElementById('coordinates').value = '';
    if (selectionMarker) {
        map.removeLayer(selectionMarker);
        selectionMarker = null;
    }
    window.editingProjectImages = [];
    document.getElementById('unitModelsContainer').innerHTML = '';
    localStorage.removeItem('project_draft');
});

// Switch View Mode (Grid vs Kanban)
window.setViewMode = function(mode) {
    viewMode = mode;
    document.querySelectorAll('.view-toggle-bar .btn').forEach(btn => btn.classList.remove('active'));
    if (mode === 'grid') {
        document.getElementById('viewModeGrid').classList.add('active');
        document.getElementById('projectsGrid').style.display = 'grid';
        document.getElementById('kanbanBoard').style.display = 'none';
    } else {
        document.getElementById('viewModeKanban').classList.add('active');
        document.getElementById('projectsGrid').style.display = 'none';
        document.getElementById('kanbanBoard').style.display = 'grid';
    }
    displayProjects();
};

// Dynamic Unit Models form management
window.addUnitModel = function(modelData = null) {
    const container = document.getElementById('unitModelsContainer');
    const index = modelIndex++;

    const block = document.createElement('div');
    block.className = 'unit-model-block';
    block.id = `model-block-${index}`;

    // Use nullish coalescing pattern — prevents 0 from being replaced by '' or 1
    const nameVal       = modelData ? (modelData.name       ?? '')         : '';
    const roomsVal      = modelData ? (modelData.rooms      ?? '')         : '';
    const bathroomsVal  = modelData ? (modelData.bathrooms  ?? '')         : '';
    const areaVal       = modelData ? (modelData.area       ?? '')         : '';
    const priceVal      = modelData ? (modelData.price      ?? '')         : '';
    const statusVal     = modelData ? (modelData.status     || 'available') : 'available';
    const typeVal       = modelData ? (modelData.type       || 'شقة')      : 'شقة';
    const countVal      = modelData ? (modelData.count != null ? modelData.count : 1) : 1;
    const commissionVal = modelData ? (modelData.commission ?? '') : '';

    block.innerHTML = `
        <button type="button" class="remove-model-btn" onclick="removeUnitModel(${index})">×</button>
        <div class="unit-model-grid">
            <div class="form-group">
                <label>اسم/رقم النموذج *</label>
                <input type="text" class="model-name" required value="${esc(nameVal)}" placeholder="مثال: نموذج B">
            </div>
            <div class="form-group">
                <label>نوع الوحدة *</label>
                <select class="model-type" required>
                    <option value="شقة" ${typeVal === 'شقة' ? 'selected' : ''}>شقة</option>
                    <option value="روف" ${typeVal === 'روف' ? 'selected' : ''}>روف</option>
                </select>
            </div>
            <div class="form-group">
                <label>عدد الغرف *</label>
                <input type="number" class="model-rooms" required value="${esc(roomsVal)}" placeholder="مثال: 4">
            </div>
            <div class="form-group">
                <label>دورات المياه *</label>
                <input type="number" class="model-bathrooms" required value="${esc(bathroomsVal)}" placeholder="مثال: 3">
            </div>
            <div class="form-group">
                <label>المساحة (م²) *</label>
                <input type="number" class="model-area" required value="${esc(areaVal)}" placeholder="مثال: 140">
            </div>
            <div class="form-group">
                <label>السعر (ريال) *</label>
                <input type="number" class="model-price" required value="${esc(priceVal)}" placeholder="مثال: 480000">
            </div>
            <div class="form-group">
                <label>العمولة (ريال)</label>
                <input type="number" class="model-commission" min="0" value="${esc(commissionVal)}" placeholder="مثال: 12000">
            </div>
            <div class="form-group">
                <label>الحالة *</label>
                <select class="model-status" required>
                    <option value="available" ${statusVal === 'available' ? 'selected' : ''}>متاح</option>
                    <option value="reserved" ${statusVal === 'reserved' ? 'selected' : ''}>محجوز</option>
                    <option value="sold" ${statusVal === 'sold' ? 'selected' : ''}>مباع</option>
                </select>
            </div>
            <div class="form-group">
                <label>عدد الوحدات *</label>
                <input type="number" class="model-count" required value="${esc(countVal)}" min="1" placeholder="1">
            </div>
        </div>
    `;
    container.appendChild(block);
};

window.removeUnitModel = function(index) {
    const block = document.getElementById(`model-block-${index}`);
    if (block) {
        block.remove();
    }
};

// Render Grid View
function renderGridView(filtered) {
    const grid = document.getElementById('projectsGrid');
    grid.innerHTML = '';

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div class="empty-state" style="grid-column:1/-1;">
                <h3>لا توجد مشاريع</h3>
                <p>لم يتم العثور على مشاريع تطابق معايير البحث الحالية</p>
            </div>`;
        return;
    }

    filtered.forEach(project => {
        const card = document.createElement('div');
        card.className = 'project-card';
        const typeColor = getTypeColor(project.type);

        let firstImage = '';
        if (project.images && Array.isArray(project.images) && project.images.length > 0) {
            firstImage = project.images[0];
        } else if (typeof project.images === 'string') {
            try {
                const parsed = JSON.parse(project.images);
                if (Array.isArray(parsed) && parsed.length > 0) firstImage = parsed[0];
            } catch (e) {}
        }

        const canEdit = currentUser.role === 'admin' || (currentUser.role === 'field' && project.added_by === currentUser.username);

        // رابط الصورة يُرفض ما لم يكن https، وعندها يُعرض البديل بدلاً منه
        const imgUrl = safeUrl(firstImage);
        const imgHtml = imgUrl
            ? `<img src="${esc(imgUrl)}" class="project-image" alt="${esc(project.name)}" onclick="viewProject(${project.id})" style="cursor:pointer;">`
            : `<div class="project-img-placeholder" onclick="viewProject(${project.id})" style="cursor:pointer;"></div>`;

        card.innerHTML = `
            <div class="card-type-bar" style="background:${typeColor};"></div>
            ${imgHtml}
            <div class="project-info">
                <div class="project-card-header">
                    <h3 onclick="viewProject(${project.id})" style="cursor:pointer;">${esc(project.name)}</h3>
                    <div class="project-badges">
                        ${getCategoryBadgeHtml(project)}
                        ${getAvailabilityBadgeHtml(project.availability)}
                        ${getStatusBadgeHtml(project.status)}
                    </div>
                </div>
                ${project.address ? `<div class="project-address"><span>${esc(project.address)}</span></div>` : ''}
                <div class="project-detail"><span>النوع</span><span style="color:${typeColor}; font-weight:700;">${esc(project.type)}</span></div>
                <div class="project-detail"><span>السعر</span><span>${formatNumber(project.price)} ر.س</span></div>
                <div class="project-detail"><span>المساحة</span><span>${formatNumber(project.area)} م²</span></div>
                <div class="added-by-badge">
                    <span>${esc(project.employee)}</span>
                </div>
                <div class="project-actions">
                    <button class="btn btn-outline btn-small" onclick="locateProject(${project.id})"><span>الموقع</span></button>
                    ${canEdit ? `<button class="btn btn-success btn-small" onclick="editProject(${project.id})"><span>تعديل</span></button>` : ''}
                    ${canEdit ? (project.availability === 'sold_out'
                        ? `<button class="btn btn-outline btn-small btn-avail-on" onclick="toggleAvailability(${project.id}, 'available')"><span>متاح</span></button>`
                        : `<button class="btn btn-outline btn-small btn-avail-off" onclick="toggleAvailability(${project.id}, 'sold_out')"><span>نفد</span></button>`
                    ) : ''}
                    ${canEdit ? `<button class="btn btn-secondary btn-small" onclick="deleteProject(${project.id})"><span>حذف</span></button>` : ''}
                </div>
            </div>
        `;
        grid.appendChild(card);
    });
}

function getTypeColor(type) {
    const colors = {
        'فيلا':        '#c5a880',
        'شقة':         '#3b82f6',
        'أرض':         '#10b981',
        'عمارة':       '#8b5cf6',
        'محل تجاري':   '#f59e0b',
        'مكتب':        '#06b6d4',
        'مستودع':      '#64748b',
        'مزرعة':       '#059669',
        'استراحة':     '#d97706',
    };
    return colors[type] || '#c5a880';
}

// Render Kanban Column Board Grouped by Rooms
function renderKanbanBoard(filteredProjects) {
    const kanban = document.getElementById('kanbanBoard');
    kanban.innerHTML = '';

    const cards = [];
    filteredProjects.forEach(p => {
        let details = p.details;
        if (typeof details === 'string') {
            try { details = JSON.parse(details); } catch (e) { details = {}; }
        }
        details = details || {};

        if (p.type === 'شقة') {
            if (details.models && Array.isArray(details.models) && details.models.length > 0) {
                details.models.forEach(m => {
                    cards.push({
                        id: p.id,
                        name: m.name || 'شقة',
                        projectName: p.name,
                        projectStatus: p.status,
                        projectAvailability: p.availability || 'available',
                        type: m.type || 'شقة',
                        rooms: parseInt(m.rooms) || 0,
                        bathrooms: parseInt(m.bathrooms) || 0,
                        area: parseFloat(m.area) || 0,
                        price: parseFloat(m.price) || 0,
                        status: m.status || 'available',
                        address: p.address || 'غير محدد',
                        latitude: p.latitude,
                        longitude: p.longitude,
                        count: parseInt(m.count) || 1
                    });
                });
            } else {
                cards.push({
                    id: p.id,
                    name: 'شقة (غير محددة النموذج)',
                    projectName: p.name,
                    projectStatus: p.status,
                    projectAvailability: p.availability || 'available',
                    type: 'شقة',
                    rooms: 0,
                    bathrooms: 0,
                    area: parseFloat(p.area) || 0,
                    price: parseFloat(p.price) || 0,
                    status: 'available',
                    address: p.address || 'غير محدد',
                    latitude: p.latitude,
                    longitude: p.longitude,
                    count: 1
                });
            }
        } else if (p.type === 'فيلا') {
            const rooms = parseInt(details.rooms) || 0;
            cards.push({
                id: p.id,
                name: 'فيلا',
                projectName: p.name,
                projectStatus: p.status,
                projectAvailability: p.availability || 'available',
                type: 'فيلا',
                rooms: rooms,
                bathrooms: 0,
                area: parseFloat(p.area) || 0,
                price: parseFloat(p.price) || 0,
                status: 'available',
                address: p.address || 'غير محدد',
                latitude: p.latitude,
                longitude: p.longitude,
                count: 1
            });
        } else {
            cards.push({
                id: p.id,
                name: p.type,
                projectName: p.name,
                projectStatus: p.status,
                projectAvailability: p.availability || 'available',
                type: p.type,
                rooms: 0,
                bathrooms: 0,
                area: parseFloat(p.area) || 0,
                price: parseFloat(p.price) || 0,
                status: 'available',
                address: p.address || 'غير محدد',
                latitude: p.latitude,
                longitude: p.longitude,
                count: 1
            });
        }
    });

    const groups = {
        'rooms-4': { title: '4 غرف أو أكثر', class: 'rooms-4', cards: [], totalCount: 0, totalPrice: 0 },
        'rooms-3': { title: '3 غرف', class: 'rooms-3', cards: [], totalCount: 0, totalPrice: 0 },
        'rooms-2': { title: 'غرفتان', class: 'rooms-2', cards: [], totalCount: 0, totalPrice: 0 },
        'rooms-other': { title: 'أخرى / غير محدد', class: 'rooms-other', cards: [], totalCount: 0, totalPrice: 0 }
    };

    cards.forEach(c => {
        let key = 'rooms-other';
        if (c.rooms >= 4) key = 'rooms-4';
        else if (c.rooms === 3) key = 'rooms-3';
        else if (c.rooms === 2) key = 'rooms-2';

        groups[key].cards.push(c);
        groups[key].totalCount += c.count;
        groups[key].totalPrice += (c.price * c.count);
    });

    // Color per column
    const columnBarColors = {
        'rooms-4':    '#4f46e5',
        'rooms-3':    '#d97706',
        'rooms-2':    '#0284c7',
        'rooms-other':'#64748b'
    };

    Object.values(groups).forEach(g => {
        const col = document.createElement('div');
        col.className = 'kanban-column';

        const barColor = columnBarColors[g.class] || '#c5a880';

        const header = document.createElement('div');
        header.className = `kanban-header ${g.class}`;
        header.innerHTML = `
            <div class="kanban-header-title">
                <span>${esc(g.title)}</span>
                <span class="count-badge">${g.totalCount} وحدة</span>
            </div>
            ${currentUser && currentUser.role === 'admin' ? `
            <div class="kanban-header-price">
                SAR ${formatNumber(g.totalPrice)}
            </div>
            ` : ''}
        `;
        col.appendChild(header);

        const cardsContainer = document.createElement('div');
        cardsContainer.className = 'kanban-cards';

        if (g.cards.length === 0) {
            cardsContainer.innerHTML = '<div style="text-align:center; color:var(--text-muted); margin-top:20px; font-size:0.9em;">لا توجد وحدات</div>';
        } else {
            g.cards.forEach(c => {
                const card = document.createElement('div');
                card.className = 'kanban-card';
                card.onclick = () => viewProject(c.id);

                let statusText = 'متاح';
                if (c.status === 'sold') statusText = 'مباع';
                else if (c.status === 'reserved') statusText = 'محجوز';

                card.innerHTML = `
                    <div class="kanban-card-bar" style="background:${barColor};"></div>
                    <div class="kanban-card-body">
                        <div class="kanban-card-header-row">
                            <div class="kanban-card-title">${esc(c.name)}</div>
                            ${getAvailabilityBadgeHtml(c.projectAvailability)}
                        </div>
                        <div class="kanban-card-project">${esc(c.projectName)}</div>
                        <div class="kanban-card-detail">${esc(c.address)}</div>
                        <div class="kanban-card-detail">
                            ${c.area > 0 ? `${formatNumber(c.area)} م²` : ''}${c.rooms > 0 ? ` | ${c.rooms} غرف` : ''}${c.bathrooms > 0 ? ` | ${c.bathrooms} دورات مياه` : ''}
                        </div>
                        ${c.count > 1 ? `<div class="kanban-card-detail"><strong style="color:#c5a880;">العدد:</strong> ${c.count} وحدة</div>` : ''}
                        <div class="kanban-card-footer">
                            <div class="kanban-card-price">ر.س ${formatNumber(c.price)}</div>
                            <span class="kanban-card-status ${c.status}">${statusText}</span>
                        </div>
                    </div>
                `;
                cardsContainer.appendChild(card);
            });
        }
        col.appendChild(cardsContainer);
        kanban.appendChild(col);
    });
}

// Auto-Save Draft Functions
function saveFormDraft() {
    const editId = document.getElementById('editProjectId').value;
    if (editId) return; // Do not save drafts for editing existing projects

    const draft = {
        projectName: document.getElementById('projectName').value,
        propertyType: document.getElementById('propertyType').value,
        availability: document.getElementById('availability').value,
        price: document.getElementById('price').value,
        area: document.getElementById('area').value,
        landArea: document.getElementById('landArea').value,
        landSides: document.getElementById('landSides').value,
        landInterface: document.getElementById('landInterface').value,
        landPrice: document.getElementById('landPrice').value,
        villaLandArea: document.getElementById('villaLandArea').value,
        villaBuildingArea: document.getElementById('villaBuildingArea').value,
        villaRooms: document.getElementById('villaRooms').value,
        villaInterface: document.getElementById('villaInterface').value,
        villaType: document.getElementById('villaType').value,
        villaAge: document.getElementById('villaAge').value,
        villaPrice: document.getElementById('villaPrice').value,
        aptCount: document.getElementById('aptCount').value,
        roofCount: document.getElementById('roofCount').value,
        address: document.getElementById('address').value,
        coordinates: document.getElementById('coordinates').value,
        driveLink: document.getElementById('driveLink').value,
        notes: document.getElementById('notes').value,
        constructionStatus: document.getElementById('constructionStatus').value,
        supportType: document.getElementById('supportType').value,
        deliveryTime: document.getElementById('deliveryTime').value,
        models: []
    };

    const blocks = document.querySelectorAll('#unitModelsContainer .unit-model-block');
    blocks.forEach(b => {
        draft.models.push({
            name: b.querySelector('.model-name').value,
            type: b.querySelector('.model-type').value,
            rooms: b.querySelector('.model-rooms').value,
            bathrooms: b.querySelector('.model-bathrooms').value,
            area: b.querySelector('.model-area').value,
            price: b.querySelector('.model-price').value,
            commission: b.querySelector('.model-commission').value,
            status: b.querySelector('.model-status').value,
            count: b.querySelector('.model-count').value
        });
    });

    localStorage.setItem('project_draft', JSON.stringify(draft));
}

function checkAndLoadDraft() {
    const saved = localStorage.getItem('project_draft');
    if (!saved) return;

    let draft;
    try {
        draft = JSON.parse(saved);
    } catch (e) {
        return;
    }

    // Check if there is actual input in the draft
    const hasContent = Object.keys(draft).some(key => {
        if (key === 'models') return draft.models.length > 0;
        if (key === 'availability') return false; // Ignore default selection
        return !!draft[key];
    });

    if (!hasContent) return;

    Swal.fire({
        title: 'توجد مسودة غير مكتملة',
        text: 'هل ترغب في استعادة بيانات المشروع التي أدخلتها سابقاً؟',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#C9A961',
        cancelButtonColor: '#d33',
        confirmButtonText: 'نعم، استعد البيانات',
        cancelButtonText: 'تجاهل'
    }).then((result) => {
        if (result.isConfirmed) {
            restoreDraft(draft);
        } else {
            localStorage.removeItem('project_draft');
        }
    });
}

function restoreDraft(draft) {
    document.getElementById('projectName').value = draft.projectName || '';
    document.getElementById('propertyType').value = draft.propertyType || '';
    document.getElementById('availability').value = draft.availability || 'available';

    // Trigger change event to show appropriate sections
    const event = new Event('change');
    document.getElementById('propertyType').dispatchEvent(event);

    document.getElementById('price').value = draft.price || '';
    document.getElementById('area').value = draft.area || '';
    document.getElementById('landArea').value = draft.landArea || '';
    document.getElementById('landSides').value = draft.landSides || '';
    document.getElementById('landInterface').value = draft.landInterface || '';
    document.getElementById('landPrice').value = draft.landPrice || '';
    document.getElementById('villaLandArea').value = draft.villaLandArea || '';
    document.getElementById('villaBuildingArea').value = draft.villaBuildingArea || '';
    document.getElementById('villaRooms').value = draft.villaRooms || '';
    document.getElementById('villaInterface').value = draft.villaInterface || '';
    document.getElementById('villaType').value = draft.villaType || '';
    document.getElementById('villaAge').value = draft.villaAge || '';
    document.getElementById('villaPrice').value = draft.villaPrice || '';
    document.getElementById('aptCount').value = draft.aptCount || '';
    document.getElementById('roofCount').value = draft.roofCount || '';
    document.getElementById('address').value = draft.address || '';
    document.getElementById('coordinates').value = draft.coordinates || '';
    document.getElementById('driveLink').value = draft.driveLink || '';
    document.getElementById('notes').value = draft.notes || '';

    // Restore classification fields from draft
    if (draft.constructionStatus) {
        const cEl = document.getElementById('constructionStatus');
        cEl.value = draft.constructionStatus;
        cEl.dispatchEvent(new Event('change'));
        setTimeout(() => {
            document.getElementById('supportType').value = draft.supportType || '';
            document.getElementById('deliveryTime').value = draft.deliveryTime || '';
        }, 50);
    }

    // Restore dynamic models
    const container = document.getElementById('unitModelsContainer');
    container.innerHTML = '';
    if (draft.models && Array.isArray(draft.models)) {
        draft.models.forEach(model => {
            addUnitModel(model);
        });
    }

    // Update selection marker on map
    if (draft.coordinates) {
        syncMapWithCoordinates();
    }

    showNotification('تم استعادة المسودة بنجاح', 'success');
}

// Attach Form Draft Save Listeners
document.getElementById('projectForm').addEventListener('input', saveFormDraft);
document.getElementById('projectForm').addEventListener('change', saveFormDraft);

// Live Filter Input Event Listeners
document.getElementById('filterType').addEventListener('change', displayProjects);
document.getElementById('filterAvailability').addEventListener('change', displayProjects);
document.getElementById('filterMinPrice').addEventListener('input', displayProjects);
document.getElementById('filterMaxPrice').addEventListener('input', displayProjects);
document.getElementById('searchBox').addEventListener('input', displayProjects);

// ── Construction status → update support type options ──────────────────────
document.getElementById('constructionStatus').addEventListener('change', function () {
    const val     = this.value;
    const group   = document.getElementById('supportTypeGroup');
    const selSup  = document.getElementById('supportType');

    selSup.innerHTML = '<option value="">اختر نوع الدعم</option>';

    const deliveryGroup = document.getElementById('deliveryTimeGroup');

    if (val === 'جاهز') {
        group.style.display = '';
        selSup.innerHTML += `
            <option value="مدعوم">مدعوم</option>
            <option value="غير_مدعوم">غير مدعوم</option>`;
        deliveryGroup.style.display = 'none';
        document.getElementById('deliveryTime').value = '';
    } else if (val === 'تحت_الإنشاء') {
        group.style.display = '';
        selSup.innerHTML += `
            <option value="مدعوم">مدعوم</option>
            <option value="غير_مدعوم">غير مدعوم</option>
            <option value="تمويل">تمويل لغير المدعومين</option>`;
        deliveryGroup.style.display = '';
    } else {
        group.style.display = 'none';
        deliveryGroup.style.display = 'none';
        document.getElementById('deliveryTime').value = '';
    }
});

// ── Category tabs setup ─────────────────────────────────────────────────────
(function initCategoryTabs() {
    // "كل المشاريع" button
    document.getElementById('catTabAll').addEventListener('click', () => {
        closeAllDropdowns();
        setCategoryFilter('', '');
    });

    // "جاهزة" main tab — click toggles dropdown
    const readyTab = document.getElementById('catTabReady');
    const readyDrop = document.getElementById('catDropReady');
    readyTab.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = readyDrop.classList.contains('open');
        closeAllDropdowns();
        if (!isOpen) readyDrop.classList.add('open');
        setCategoryFilter('جاهز', '');
    });

    // "تحت الإنشاء" main tab
    const conTab = document.getElementById('catTabConstruction');
    const conDrop = document.getElementById('catDropConstruction');
    conTab.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = conDrop.classList.contains('open');
        closeAllDropdowns();
        if (!isOpen) conDrop.classList.add('open');
        setCategoryFilter('تحت_الإنشاء', '');
    });

    // Sub-category buttons
    document.querySelectorAll('.cat-sub').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeAllDropdowns();
            setCategoryFilter(btn.dataset.c, btn.dataset.s);
        });
    });

    // Close dropdowns when clicking outside
    document.addEventListener('click', closeAllDropdowns);

    function closeAllDropdowns() {
        document.querySelectorAll('.cat-dropdown').forEach(d => d.classList.remove('open'));
    }
})();

// ── Export CSV ────────────────────────────────────────────────────────────────
document.getElementById('exportBtn').addEventListener('click', function () {
    if (!projects || projects.length === 0) {
        showNotification('لا توجد مشاريع للتصدير', 'info');
        return;
    }

    const headers = ['الاسم', 'النوع', 'السعر (ريال)', 'المساحة (م²)', 'العنوان', 'الحالة', 'التوفر', 'المسؤول', 'التاريخ'];
    const rows = projects.map(p => [
        `"${(p.name || '').replace(/"/g, '""')}"`,
        `"${p.type || ''}"`,
        p.price || 0,
        p.area  || 0,
        `"${(p.address || '').replace(/"/g, '""')}"`,
        p.status === 'approved' ? 'معتمد' : p.status === 'rejected' ? 'مرفوض' : 'معلق',
        p.availability === 'sold_out' ? 'نفدت' : 'متاحة',
        `"${(p.employee || '').replace(/"/g, '""')}"`,
        p.date_added ? new Date(p.date_added).toLocaleDateString('ar-SA') : ''
    ]);

    const csvContent = '﻿' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `مشاريع-ملائم-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showNotification(`تم تصدير ${projects.length} مشروع بنجاح`, 'success');
});
