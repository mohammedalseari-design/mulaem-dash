// Minimal harness: load the shim with a mocked supabase client and check the old-API contract.
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const calls = []; let scenario = {};
function builder(table) {
  const st = { table, ops: [] };
  const b = {
    select(c) { st.ops.push(['select', c]); return b; }, insert(v) { st.ops.push(['insert', v]); return b; },
    update(v) { st.ops.push(['update', v]); return b; }, delete() { st.ops.push(['delete']); return b; },
    eq(k, v) { st.ops.push(['eq', k, v]); return b; }, order(k, o) { st.ops.push(['order', k, o]); return b; },
    limit(n) { st.ops.push(['limit', n]); return b; },
    maybeSingle() { st.single = true; return b; },
    then(res, rej) { calls.push(st); const out = scenario.query ? scenario.query(st) : { data: [], error: null }; return Promise.resolve(out).then(res, rej); }
  };
  return b;
}
const sbMock = {
  auth: {
    getSession: async () => ({ data: { session: scenario.session || null } }),
    signInWithPassword: async (c) => { calls.push({ auth: 'signIn', c }); return scenario.signIn ? scenario.signIn(c) : { error: null }; },
    signOut: async (o) => { calls.push({ auth: 'signOut', o }); return {}; }
  },
  from: builder,
  functions: { invoke: async (name, opts) => { calls.push({ fn: name, body: opts.body }); return scenario.invoke ? scenario.invoke(opts.body) : { data: { status: 'success' }, error: null }; } },
  storage: { from: (bucket) => ({ upload: async (name, file, o) => { calls.push({ storage: 'upload', bucket, name, o }); return { error: null }; }, getPublicUrl: (name) => ({ data: { publicUrl: 'https://x.supabase.co/storage/v1/object/public/' + bucket + '/' + name } }) }) }
};
let passthrough = 0;
const listeners = [];
const win = { MULAEM_CONFIG: { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_KEY: 'k' }, supabase: { createClient: () => sbMock }, fetch: async () => { passthrough++; return new Response('real'); } };
const ctx = { window: win, document: { addEventListener: (t, f, c) => listeners.push([t, f, c]) }, localStorage: { removeItem() {} }, console, Response, URLSearchParams, FormData, Blob, Promise, Object, Number, String, Math, Date, Array, JSON, isFinite };
vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/supabase-shim.js'), 'utf8'), ctx);
const f = win.fetch; let pass = 0, failN = 0;
const t = (name, cond, extra) => { if (cond) { pass++; console.log('PASS', name); } else { failN++; console.log('FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const row = { id: 7, name: 'مشروع', type: 'شقة', price: 1200000, area: 150.5, address: null, latitude: 21.5, longitude: 39.1, notes: null, employee: 'E', added_by: 'u1', images: ['https://h/a/img_1.jpg'], details: { rooms: 3 }, status: 'approved', date_added: '2026-08-23T06:39:05', deletion_requested: false, rejection_reason: null, deleted_at: null, availability: 'available' };
(async () => {
  await f('https://unpkg.com/leaflet.js'); await f('images/logo.jpg'); t('non-API requests pass through', passthrough === 2);

  scenario = { query: () => ({ data: [row], error: null }) };
  let r = await (await f('api/projects.php?role=admin&username=u1')).json();
  t('projects list keeps old string contract', Array.isArray(r) && r[0].id === '7' && r[0].price === '1200000.00' && r[0].area === '150.50' && r[0].latitude === '21.5' && r[0].date_added === '2026-08-23 06:39:05' && r[0].deletion_requested === '0' && r[0].address === '' && r[0].details.rooms === 3, r[0]);
  t('projects list ordered by id desc', JSON.stringify(calls.at(-1).ops.find(o => o[0] === 'order')) === JSON.stringify(['order', 'id', { ascending: false }]));

  scenario = { query: () => ({ data: row, error: null }) };
  r = await (await f('api/projects.php?id=7&role=admin&username=u1')).json(); t('single project by id', r.id === '7' && calls.at(-1).ops.some(o => o[0] === 'eq' && o[2] === '7'));

  scenario = { query: () => ({ data: { id: 240 }, error: null }) };
  let resp = await f('api/projects.php', { method: 'POST', headers: {}, body: JSON.stringify({ name: 'n', type: 'شقة', availability: 'available', price: '500', area: '', address: 'a', latitude: 21, longitude: 39, notes: '', employee: 'FAKE', addedBy: 'someone', images: ['https://p/storage/img_9.jpg?x=1'], details: { a: 1 } }) });
  r = await resp.json(); const ins = calls.at(-1).ops.find(o => o[0] === 'insert')[1];
  t('create returns success + id', resp.ok && r.status === 'success' && r.id === '240');
  t('create never sends owner/status from browser', !('added_by' in ins) && !('addedBy' in ins) && !('employee' in ins) && !('status' in ins), ins);
  t('create normalises numbers and image file names', ins.price === 500 && ins.area === null && ins.image_files[0] === 'img_9.jpg', ins);

  scenario = { query: () => ({ data: [{ id: 7 }], error: null }) };
  r = await (await f('api/projects.php?id=7', { method: 'PUT', body: JSON.stringify({ action: 'approve', adminUser: 'x' }) })).json();
  t('approve', r.status === 'success' && JSON.stringify(calls.at(-1).ops.find(o => o[0] === 'update')[1]) === JSON.stringify({ status: 'approved', rejection_reason: null }));
  r = await (await f('api/projects.php?id=7', { method: 'PUT', body: JSON.stringify({ action: 'reject', rejection_reason: 'سبب' }) })).json();
  t('reject carries reason', r.status === 'success' && calls.at(-1).ops.find(o => o[0] === 'update')[1].rejection_reason === 'سبب');
  r = await (await f('api/projects.php?id=7', { method: 'PUT', body: JSON.stringify({ action: 'update_availability', availability: 'sold' }) })).json();
  t('availability', r.status === 'success' && calls.at(-1).ops.find(o => o[0] === 'update')[1].availability === 'sold');
  scenario = { query: () => ({ data: [], error: null }) };
  r = await (await f('api/projects.php?id=7', { method: 'PUT', body: JSON.stringify({ action: 'approve' }) })).json(); t('update blocked by RLS (0 rows) → error', r.status === 'error');
  r = await (await f('api/projects.php?id=7', { method: 'DELETE' })).json(); t('delete blocked by RLS (0 rows) → error', r.status === 'error');
  scenario = { query: () => ({ data: [{ id: 7 }], error: null }) };
  r = await (await f('api/projects.php?id=7', { method: 'DELETE' })).json(); t('delete ok', r.status === 'success' && calls.at(-1).ops.some(o => o[0] === 'delete'));

  const prof = { id: 'uuid-1', legacy_id: 25, username: 'u1', fullname: 'Full', role: 'admin', is_blocked: false, email: null, created_at: '2026-02-01T10:00:00+00:00' };
  scenario = { session: { user: { id: 'uuid-1' } }, query: () => ({ data: prof, error: null }) };
  r = await (await f('api/login.php', { method: 'POST', body: JSON.stringify({ username: 'U1', password: 'secret-pass' }) })).json();
  const si = calls.filter(c => c.auth === 'signIn').at(-1);
  t('login success maps username → email and returns numeric id', r.status === 'success' && r.user.id === '25' && r.user.role === 'admin' && si.c.email === 'u1@users.mulaem.sa', r);
  await f('api/login.php', { method: 'POST', body: JSON.stringify({ username: 'Someone@Gmail.com', password: 'x' }) });
  t('email-style usernames are used as-is', calls.filter(c => c.auth === 'signIn').at(-1).c.email === 'someone@gmail.com');
  scenario = { signIn: () => ({ error: { message: 'Invalid login credentials' } }) };
  r = await (await f('api/login.php', { method: 'POST', body: JSON.stringify({ username: 'u1', password: 'bad' }) })).json(); t('wrong password → error', r.status === 'error');
  scenario = { session: { user: { id: 'uuid-1' } }, query: () => ({ data: { ...prof, is_blocked: true }, error: null }) };
  const before = calls.filter(c => c.auth === 'signOut').length;
  r = await (await f('api/login.php', { method: 'POST', body: JSON.stringify({ username: 'u1', password: 'p' }) })).json();
  t('blocked account cannot log in and session is dropped', r.status === 'error' && calls.filter(c => c.auth === 'signOut').length === before + 1);
  r = await (await f('api/login.php?u=u1')).json(); t('block check → blocked', r.status === 'blocked');
  scenario = { session: null }; r = await (await f('api/login.php?u=u1')).json(); t('no session → not_found', r.status === 'not_found');
  scenario = { session: { user: { id: 'uuid-1' } }, query: () => ({ data: prof, error: null }) }; r = await (await f('api/login.php?u=u1')).json(); t('active session → ok', r.status === 'ok');

  scenario = { query: () => ({ data: [prof], error: null }) };
  r = await (await f('api/users.php')).json(); t('users list contract', r[0].id === '25' && r[0].is_blocked === '0' && r[0].email === '' && r[0].created_at === '2026-02-01 10:00:00', r[0]);
  await f('api/users.php', { method: 'POST', body: JSON.stringify({ username: 'new', fullname: 'N', password: 'longpassword', role: 'field' }) });
  t('create user → admin function', calls.at(-1).fn === 'admin-users' && calls.at(-1).body.action === 'create' && calls.at(-1).body.role === 'field');
  await f('api/users.php', { method: 'PUT', body: JSON.stringify({ id: 25, action: 'toggle_block', is_blocked: 1 }) }); t('block → admin function', calls.at(-1).body.action === 'toggle_block' && calls.at(-1).body.is_blocked === true && calls.at(-1).body.id === 25);
  await f('api/users.php', { method: 'PUT', body: JSON.stringify({ id: 25, action: 'change_password', password: 'newpassword' }) }); t('password → admin function', calls.at(-1).body.action === 'change_password');
  await f('api/users.php?id=25', { method: 'DELETE' }); t('delete user → admin function', calls.at(-1).body.action === 'delete' && calls.at(-1).body.id === '25');
  scenario = { invoke: () => ({ data: null, error: { context: { json: async () => ({ status: 'error', message: 'هذه العملية للمدير فقط' }) } } }) };
  r = await (await f('api/users.php?id=25', { method: 'DELETE' })).json(); t('admin function error message reaches the UI', r.status === 'error' && r.message === 'هذه العملية للمدير فقط', r);

  scenario = { query: () => ({ data: [{ id: 772, user_id: 25, action: 'Add Project', details: 'd', timestamp: '2026-08-23T06:39:05.123', user_name: 'Full' }], error: null }) };
  r = await (await f('api/activities.php')).json(); t('activities contract + limit 50', r[0].id === '772' && r[0].timestamp === '2026-08-23 06:39:05' && calls.at(-1).ops.some(o => o[0] === 'limit' && o[1] === 50));
  scenario = { query: () => ({ data: null, error: null }) };
  await f('api/activities.php', { method: 'POST', body: JSON.stringify({ user_id: 999, action: 'A', details: 'D' }) });
  const ai = calls.at(-1).ops.find(o => o[0] === 'insert')[1]; t('activity insert ignores browser-supplied identity', !('user_id' in ai) && ai.action === 'A');

  const fd = new FormData(); fd.append('image', new Blob(['x'], { type: 'image/jpeg' }), 'img_1.jpg');
  r = await (await f('api/upload.php', { method: 'POST', body: fd })).json(); const up = calls.filter(c => c.storage).at(-1);
  t('upload goes to storage bucket and returns public URL', r.status === 'success' && up.bucket === 'project-images' && /^projects\/img_\d+_[a-z0-9]+\.jpg$/.test(up.name) && r.url.includes('/object/public/project-images/projects/img_'), r);
  r = await (await f('api/setup_check.php')).json(); t('setup_check', r.status === 'success');
  t('logout listener registered (capture)', listeners.some(l => l[0] === 'click' && l[2] === true));
  console.log(`\n${pass} passed, ${failN} failed`); process.exit(failN ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
