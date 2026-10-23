// v5 turu (YENI_ISTEKLER 1-8) uctan uca API testleri. GERCEK backend (4100) gerekir.
// Calistirma: ELECTRON_RUN_AS_NODE=1 <Cursor.exe> --test --test-concurrency=1 testler/v5.test.js   (ya da Node 20/22/24 ile node --test)
// Yan etkisi: kendi olusturdugu "v5x*" kullanicilari sonda kalici siler; seed-demo verisine DOKUNMAZ (yalniz okur).
// Dis internet (Open Library, TVMaze, Wikidata) kullanan testler agi yoksa atlanir/uyari verir.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Client, waitForServer, daysAgo } = require('./lib/client');

const ADMIN_PW = process.env.ADMIN_PASSWORD || 'test-admin-123';
const PW = 'Deneme123!';
const RUN = Date.now().toString(36).slice(-5);
const created = [];
let admin;

async function mkUser(label, extra = {}) {
  const username = `v5x${label}${RUN}`;
  const r = await admin.post('/api/admin/users', { username, display_name: `V5 ${label} ${RUN}`, password: PW, role: 'member', ...extra });
  assert.equal(r.status, 201, r.text);
  created.push(r.json.user.id);
  const c = new Client();
  const l = await c.login(username, PW);
  assert.equal(l.status, 200, l.text);
  return { c, id: r.json.user.id, username, user: r.json.user };
}

before(async () => {
  await waitForServer();
  admin = new Client();
  const r = await admin.login('admin', ADMIN_PW);
  assert.equal(r.status, 200, 'admin girisi: ' + r.text);
});
after(async () => {
  for (const id of created) await admin.del(`/api/admin/users/${id}?hard=1`);
});

// ---------------------------------------------------------------- 1) PROFIL
describe('v5-1 profil', () => {
  test('GET /avatars: giris ister, 4 grup, hayvanlar >= 40', async () => {
    assert.equal((await new Client().get('/api/avatars')).status, 401);
    const u = await mkUser('av');
    const r = await u.c.get('/api/avatars');
    assert.equal(r.status, 200);
    assert.equal(r.json.groups.length, 4);
    const animals = r.json.groups.find((g) => g.id === 'animals');
    assert.ok(animals.items.length >= 40, 'hayvan sayisi ' + animals.items.length);
    for (const g of r.json.groups) assert.ok(g.label && g.items.length > 0);
  });

  test('avatar: listede olmayan/gecersiz tipler 400, listedekiler 200 (FE0F farki yok sayilir)', async () => {
    const u = await mkUser('avt');
    const list = (await u.c.get('/api/avatars')).json.groups.flatMap((g) => g.items);
    for (const bad of ['abc', '<script>alert(1)</script>', '', null, 5, ['🦊'], '🦊🐼', '🦊‍', 'x'.repeat(50)]) {
      const r = await u.c.patch('/api/me/profile', { avatar: bad });
      assert.equal(r.status, 400, `avatar=${JSON.stringify(bad)} -> ${r.status}`);
    }
    // listede olmadigi icin reddedilmesi gereken gercek emojiler
    const outside = ['💩', '🛸', '🧿'].filter((e) => !list.includes(e));
    for (const e of outside) assert.equal((await u.c.patch('/api/me/profile', { avatar: e })).status, 400, e);
    assert.ok(outside.length >= 1, 'test icin listede olmayan emoji bulunamadi');
    const ok = list[3];
    let r = await u.c.patch('/api/me/profile', { avatar: ok });
    assert.equal(r.status, 200); assert.equal(r.json.user.avatar, ok);
    r = await u.c.patch('/api/me/profile', { avatar: '🦊️' });
    assert.equal(r.status, 200); assert.equal(r.json.user.avatar, '🦊');
    // reddedilen istek durumu bozmadi
    assert.equal((await u.c.get('/api/auth/me')).json.user.avatar, '🦊');
  });

  test('renk: sadece #rrggbb; buyuk harf kucuge cevrilir; CSS enjeksiyonu reddedilir', async () => {
    const u = await mkUser('col');
    for (const bad of ['red', '#fff', '#12345g', '#1234567', 123, 'ffaa00', '#fff;background:url(x)', '', null, 'rgb(1,2,3)', '#ffaa0']) {
      const r = await u.c.patch('/api/me/profile', { color: bad });
      assert.equal(r.status, 400, `color=${JSON.stringify(bad)} -> ${r.status}`);
    }
    const r = await u.c.patch('/api/me/profile', { color: '#FFAA00' });
    assert.equal(r.status, 200); assert.equal(r.json.user.color, '#ffaa00');
  });

  test('bos govde / bilinmeyen alan 400; giris yoksa 401', async () => {
    const u = await mkUser('emp');
    assert.equal((await u.c.patch('/api/me/profile', {})).status, 400);
    assert.equal((await u.c.patch('/api/me/profile', { foo: 1 })).status, 400);
    assert.equal((await new Client().patch('/api/me/profile', { color: '#112233' })).status, 401);
  });

  test('gorunen ad: ilk degisiklik 200 + name_changed, ikinci 409; ayni ad sayilmaz; 409 istegi avatar da kaydetmez', async () => {
    const u = await mkUser('nm');
    assert.equal(u.user.name_changed, false);
    // gecersiz uzunluklar hak harcamaz
    for (const bad of ['A', '   ', 'A'.repeat(31), 12345, ['a'], null, '']) {
      assert.equal((await u.c.patch('/api/me/profile', { display_name: bad })).status, 400, JSON.stringify(bad));
    }
    assert.equal((await u.c.get('/api/auth/me')).json.user.name_changed, false);
    // degismemis ad: hak harcanmaz (bosluklu/ayni)
    let r = await u.c.patch('/api/me/profile', { display_name: `  ${u.user.display_name}  ` });
    assert.equal(r.status, 200); assert.equal(r.json.user.name_changed, false);
    // v5.1 (E-35): '<' '>' iceren ad sessizce temizlenmez, 400 ile REDDEDILIR ve hak harcanmaz
    assert.equal((await u.c.patch('/api/me/profile', { display_name: '  <b>Yeni   Ad</b> ' })).status, 400);
    assert.equal((await u.c.get('/api/auth/me')).json.user.name_changed, false);
    // gercek degisiklik (ic bosluk daraltma)
    r = await u.c.patch('/api/me/profile', { display_name: '  Yeni   Ad ' });
    assert.equal(r.status, 200); assert.equal(r.json.user.display_name, 'Yeni Ad'); assert.equal(r.json.user.name_changed, true);
    assert.equal((await u.c.get('/api/auth/me')).json.user.name_changed, true);
    // ikinci deneme 409 + Turkce hata
    r = await u.c.patch('/api/me/profile', { display_name: 'Baska Ad' });
    assert.equal(r.status, 409); assert.match(r.json.error, /bir kez/i);
    // avatar/renk ayni istekte olsa da TUMU reddedilir
    r = await u.c.patch('/api/me/profile', { display_name: 'Baska Ad', color: '#010203', avatar: '🐼' });
    assert.equal(r.status, 409);
    const me = (await u.c.get('/api/auth/me')).json.user;
    assert.equal(me.display_name, 'Yeni Ad'); assert.notEqual(me.color, '#010203'); assert.notEqual(me.avatar, '🐼');
    // hak bittikten sonra ayni ad (temiz hali ayni) 200 ve avatar/renk serbest
    r = await u.c.patch('/api/me/profile', { display_name: 'Yeni Ad', color: '#010203' });
    assert.equal(r.status, 200); assert.equal(r.json.user.color, '#010203');
    // ad degisince feed/liderlikte yeni ad gorunur (kisa kullanici nesnesi)
    r = await u.c.get('/api/feed'); assert.equal(r.status, 200);
  });

  test('gorunen ad: ayni anda iki farkli istek -> tam biri 200, digeri 409 (yaris yok)', async () => {
    const u = await mkUser('race');
    const rs = await Promise.all([
      u.c.patch('/api/me/profile', { display_name: 'Yaris Bir' }),
      u.c.patch('/api/me/profile', { display_name: 'Yaris Iki' }),
      u.c.patch('/api/me/profile', { display_name: 'Yaris Uc' }),
    ]);
    const codes = rs.map((r) => r.status).sort();
    assert.deepEqual(codes, [200, 409, 409], 'kodlar ' + codes);
    const winner = rs.find((r) => r.status === 200).json.user.display_name;
    assert.equal((await u.c.get('/api/auth/me')).json.user.display_name, winner);
  });

  test('admin reset_name_change: yalniz admin; hak yeniden doner', async () => {
    const u = await mkUser('rst');
    await u.c.patch('/api/me/profile', { display_name: 'Ilk Ad' });
    assert.equal((await u.c.patch('/api/me/profile', { display_name: 'Ikinci Ad' })).status, 409);
    // uye kendi hakkini sifirlayamaz
    assert.equal((await u.c.patch(`/api/admin/users/${u.id}`, { reset_name_change: true })).status, 403);
    assert.equal((await u.c.patch('/api/me/profile', { display_name: 'Ikinci Ad', reset_name_change: true })).status, 409);
    const r = await admin.patch(`/api/admin/users/${u.id}`, { reset_name_change: true });
    assert.equal(r.status, 200, r.text);
    assert.equal((r.json.user || r.json).name_changed, false);
    const r2 = await u.c.patch('/api/me/profile', { display_name: 'Ikinci Ad' });
    assert.equal(r2.status, 200); assert.equal(r2.json.user.display_name, 'Ikinci Ad');
  });

  test('admin kullanici ekleme/duzenleme: listede olmayan avatar 400', async () => {
    let r = await admin.post('/api/admin/users', { username: `v5xbadav${RUN}`, display_name: 'Kotu Avatar', password: PW, avatar: 'abc' });
    assert.equal(r.status, 400, r.text);
    if (r.status === 201) created.push(r.json.user.id);
    const u = await mkUser('admav');
    r = await admin.patch(`/api/admin/users/${u.id}`, { avatar: '<img src=x>' });
    assert.equal(r.status, 400, r.text);
    r = await admin.patch(`/api/admin/users/${u.id}`, { avatar: '🐼' });
    assert.equal(r.status, 200);
  });

  test('profil ucu baska kullanicinin kaydini etkilemez (id parametresi yok sayilir)', async () => {
    const a = await mkUser('ia'), b = await mkUser('ib');
    const r = await a.c.patch('/api/me/profile', { color: '#0a0b0c', id: b.id, user_id: b.id });
    assert.equal(r.status, 200);
    assert.equal(r.json.user.id, a.id);
    assert.notEqual((await b.c.get('/api/auth/me')).json.user.color, '#0a0b0c');
  });
});
