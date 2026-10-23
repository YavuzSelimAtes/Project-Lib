// Gercekci aile test verisi. Idempotent: onceki demo kullanicilari silip yeniden kurar.
// Kullanim: node testler/seed-demo.js   (backend 4100'de calismali, bkz. start-backend.js)
// Alan adlari ajanlar/1_BACKEND.txt'ye gore; API_SOZLESMESI.txt gelince uyarlanir.
const { Client, waitForServer, daysAgo } = require('./lib/client');
const ADMIN_PW = process.env.ADMIN_PASSWORD || 'test-admin-123';
const PW = 'Deneme123!';

let seed = 42;
const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (a) => a[ri(0, a.length - 1)];
const unwrap = (j, k) => (j && j[k]) ?? j;

const FAMILY = [
  { username: 'ayse', display_name: 'Ayşe Yılmaz', avatar: '👩', color: '#e11d48' },
  { username: 'mehmet', display_name: 'Mehmet Yılmaz', avatar: '👨', color: '#2563eb' },
  { username: 'elif', display_name: 'Elif Yılmaz', avatar: '👧', color: '#9333ea' },
  { username: 'can', display_name: 'Can Yılmaz', avatar: '🧒', color: '#16a34a' },
  { username: 'anneanne', display_name: 'Şükran Anneanne', avatar: '👵', color: '#d97706' },
  { username: 'dede', display_name: 'İsmail Dede', avatar: '👴', color: '#0891b2' },
];

const BOOKS = [
  ['Suç ve Ceza', 'Fyodor Dostoyevski', 550], ['Küçük Prens', 'Antoine de Saint-Exupéry', 96],
  ['Sefiller', 'Victor Hugo', 1488], ['Tutunamayanlar', 'Oğuz Atay', 724], ['İnce Memed', 'Yaşar Kemal', 436],
  ['Kürk Mantolu Madonna', 'Sabahattin Ali', 160], ['Simyacı', 'Paulo Coelho', 184], ['1984', 'George Orwell', 352],
  ['Şeker Portakalı', 'José Mauro de Vasconcelos', 182], ['Saatleri Ayarlama Enstitüsü', 'Ahmet Hamdi Tanpınar', 408],
  ['Hayvan Çiftliği', 'George Orwell', 152], ['Sineklerin Tanrısı', 'William Golding', 288],
  ['Dönüşüm', 'Franz Kafka', 96], ['Beyaz Diş', 'Jack London', 280], ['Çalıkuşu', 'Reşat Nuri Güntekin', 480],
  ['Harry Potter ve Felsefe Taşı', 'J.K. Rowling', 336], ['Yüzüklerin Efendisi', 'J.R.R. Tolkien', 1178],
  ['Ağrı Dağı Efsanesi', 'Yaşar Kemal', 120],
  ['Uzun İsimli Kitap: ' + 'Çok '.repeat(30) + 'Uzun Bir Başlık', 'Yazar Ğ. İ. Ş.', 300],
  ['Tek Sayfalık Deneme', 'Anonim', 1],
];
const MOVIES = ['Hababam Sınıfı', 'Eşkıya', 'Babam ve Oğlum', 'Recep İvedik', 'Inception', 'Coco', 'Titanic', 'Kurtlar Vadisi'];
const SERIES = ['Breaking Bad', 'Çarpışma', 'Avrupa Yakası', 'Muhteşem Yüzyıl', 'The Office', 'Friends', 'Leyla ile Mecnun'];

async function main() {
  await waitForServer();
  const admin = new Client();
  let r = await admin.login('admin', ADMIN_PW);
  if (r.status !== 200) throw new Error(`Admin girisi basarisiz: ${r.status} ${r.text}`);

  // idempotent: onceki demo kullanicilarini sil (kayitlari cascade silinmeli)
  const list = await admin.get('/api/admin/users');
  const existing = unwrap(list.json, 'users') || [];
  for (const u of existing) if (FAMILY.some((f) => f.username === u.username)) await admin.del(`/api/admin/users/${u.id}?hard=1`);

  const users = {};
  for (const f of FAMILY) {
    r = await admin.post('/api/admin/users', { ...f, password: PW, role: 'member' });
    if (r.status >= 300) throw new Error(`Kullanici eklenemedi ${f.username}: ${r.status} ${r.text}`);
    users[f.username] = { ...f, id: unwrap(r.json, 'user').id, c: new Client() };
    r = await users[f.username].c.login(f.username, PW);
    if (r.status !== 200) throw new Error(`Giris basarisiz ${f.username}: ${r.status} ${r.text}`);
  }

  const addCat = async (type, title, creator, pages) => {
    r = await admin.post('/api/admin/catalog', { type, title, author_or_creator: creator, year: ri(1950, 2023), pages, description: 'Test verisi' });
    if (r.status === 409) { const q = await admin.get('/api/catalog/search?q=' + encodeURIComponent(title.slice(0, 60)) + '&type=' + type); const f = (q.json.items || []).find((i) => i.title === title && i.id); if (f) return f.id; }
    if (r.status >= 300) throw new Error(`Katalog eklenemedi ${title}: ${r.status} ${r.text}`);
    return unwrap(r.json, 'item').id;
  };
  const cat = { book: [], movie: [], series: [] };
  for (const [t, a, p] of BOOKS) cat.book.push({ id: await addCat('book', t, a, p), pages: p, title: t });
  for (const t of MOVIES) cat.movie.push({ id: await addCat('movie', t, 'Yönetmen X'), title: t });
  for (const t of SERIES) cat.series.push({ id: await addCat('series', t, 'Yapımcı Y'), title: t });

  const stats = { entries: 0, logs: 0, comments: 0, questions: 0, requests: 0 };
  const entries = [];
  const mk = async (un, body, meta) => {
    const rr = await users[un].c.post('/api/entries', body);
    if (rr.status >= 300) { console.warn('entry hata', un, meta.title, rr.status, rr.text); return null; }
    stats.entries++;
    const e = { uname: un, id: unwrap(rr.json, 'entry').id, ...meta };
    entries.push(e);
    return e;
  };

  const plan = {
    ayse: ['bitti', 'bitti', 'bitti', 'devam', 'birakildi', 'planlandi'],
    mehmet: ['bitti', 'bitti', 'devam', 'devam', 'planlandi'],
    elif: ['bitti', 'devam', 'devam', 'bitti', 'bitti', 'bitti', 'planlandi'],
    can: ['devam', 'birakildi', 'planlandi', 'bitti'],
    anneanne: ['bitti', 'devam', 'planlandi'], // 'devam' icin gunluk guncelleme yok
    dede: [], // sifir durumu
  };
  let bi = 0;
  for (const [un, statuses] of Object.entries(plan)) {
    for (const st of statuses) {
      const b = cat.book[bi++ % (cat.book.length - 2)];
      const startAgo = st === 'planlandi' ? 0 : ri(10, 85);
      await mk(un, { catalog_id: b.id, type: 'book', status: st === 'bitti' ? 'devam' : st, start_date: st === 'planlandi' ? null : daysAgo(startAgo), total_pages: b.pages },
        { st, startAgo, pages: b.pages, title: b.title });
    }
  }
  const longB = cat.book[cat.book.length - 2], oneP = cat.book[cat.book.length - 1];
  await mk('can', { catalog_id: longB.id, type: 'book', status: 'devam', start_date: daysAgo(1), total_pages: longB.pages }, { st: 'uzun', startAgo: 1, pages: longB.pages, title: longB.title });
  await mk('dede', { catalog_id: oneP.id, type: 'book', status: 'devam', start_date: daysAgo(1), total_pages: 1 }, { st: 'tek-sayfa', startAgo: 1, pages: 1, title: oneP.title });

  const progress = async (e, page, date) => {
    const rr = await users[e.uname].c.post(`/api/entries/${e.id}/progress`, { current_page: page, date });
    if (rr.status >= 300) console.warn('progress hata', e.title, page, date, rr.status, rr.text); else stats.logs++;
    return rr;
  };
  for (const e of [...entries]) {
    if (e.uname === 'anneanne' && e.st === 'devam') continue;
    if (['planlandi', 'tek-sayfa'].includes(e.st)) continue;
    let page = 0;
    const fin = e.st === 'bitti';
    for (let d = e.startAgo; d >= (fin ? 1 : 0); d--) {
      if (rnd() < 0.3) continue; // okumasiz gun
      let step = ri(8, 45);
      if (fin) step = Math.max(step, Math.ceil((e.pages - page) / Math.max(1, d * 0.6)));
      if (e.uname === 'elif' && e.pages > 400 && d === Math.min(12, e.startAgo)) step = 187; // rekor (tek gun)
      const times = rnd() < 0.2 ? 3 : 1; // ayni gun 3 guncelleme
      for (let k = 0; k < times; k++) {
        const target = Math.min(page + Math.ceil(step / times), fin ? e.pages : e.pages - 1);
        if (target <= page) break;
        await progress(e, target, daysAgo(d));
        page = target;
      }
      if (e.st === 'birakildi' && page > e.pages * 0.3) break;
    }
    if (fin && page < e.pages) await progress(e, e.pages, daysAgo(1));
    if (e.st === 'birakildi') await users[e.uname].c.patch(`/api/entries/${e.id}`, { status: 'birakildi' });
  }
  // Beraberlik: iki kisi ayni gun 96 sayfa
  for (const un of ['mehmet', 'can']) {
    const e = await mk(un, { catalog_id: cat.book[1].id, type: 'book', status: 'devam', start_date: daysAgo(3), total_pages: 96 }, { st: 'bera', pages: 96, title: 'Küçük Prens (beraberlik)' });
    if (e) { await progress(e, 60, daysAgo(2)); await progress(e, 96, daysAgo(2)); }
  }
  // Bitmis, gunluk guncellemesiz (sadece tarih araligi)
  await mk('mehmet', { catalog_id: cat.book[6].id, type: 'book', status: 'bitti', start_date: daysAgo(40), end_date: daysAgo(30), total_pages: 184 }, { st: 'tarihli', title: 'Simyacı (tarihli)' });

  // Filmler: bugun, dun, 3+ gun once
  const mv = [['ayse', 0, 0], ['mehmet', 1, 1], ['elif', 0, 2], ['can', 3, 3], ['anneanne', 10, 4], ['dede', 60, 5]];
  for (const [un, ago, mi] of mv) {
    await mk(un, { catalog_id: cat.movie[mi].id, type: 'movie', status: 'bitti', start_date: daysAgo(ago), end_date: daysAgo(ago), rating: ri(1, 5) }, { st: 'film', title: cat.movie[mi].title });
  }
  const sr = [['ayse', 0, 'devam', 2, 5], ['mehmet', 1, 'devam', 1, 3], ['elif', 2, 'bitti', 4, 12], ['dede', 3, 'devam', 1, 1], ['can', 4, 'bitti', 3, 9]];
  for (const [un, si, st, season, ep] of sr) {
    await mk(un, { catalog_id: cat.series[si].id, type: 'series', status: st, start_date: daysAgo(ri(5, 60)), season, episode: ep }, { st: 'dizi', title: cat.series[si].title });
  }

  // Yorumlar ve sorular
  const yorum = ['Çok güzeldi, herkese tavsiye ederim 👏', 'İlk bölümleri sıkıcı ama sonra açılıyor.', 'Şiir gibi bir anlatım: ışık, ağaç, çığlık!', 'Yarın bitiririm inşallah', 'Ğ ı İ ş Ş ç Ö ü karakter denemesi'];
  const names = Object.keys(users);
  for (const e of entries.slice(0, 20)) {
    r = await users[pick(names)].c.post(`/api/entries/${e.id}/comments`, { body: pick(yorum) });
    if (r.status < 300) stats.comments++;
  }
  let qi = 0;
  for (const e of entries.slice(0, 12)) {
    const asker = users[pick(names.filter((k) => k !== e.uname))];
    r = await asker.c.post(`/api/entries/${e.id}/questions`, { question: pick(['Sonu nasıl bitiyor, spoiler vermeden söyler misin?', 'Kaç saatte bitirdin?', 'Çocuklara uygun mu?', 'Neden bu kadar beğendin?']) });
    if (r.status >= 300) continue;
    stats.questions++;
    if (qi++ % 2 === 0) {
      const a = await users[e.uname].c.patch(`/api/questions/${unwrap(r.json, 'question').id}`, { answer: 'Bence değer, merak etme.' });
      if (a.status >= 300) console.warn('cevap', a.status, a.text);
    }
  }

  const talep = [['elif', 'book', 'Kayıp Hazine: Çocuklar İçin', 'Katalogda yok, 2019 baskısı'], ['can', 'movie', 'Aile Arasında', ''], ['anneanne', 'series', 'Kuruluş Osman 1. sezon', 'Tüm bölümler'], ['mehmet', 'book', 'Nutuk', 'Sadeleştirilmiş çeviri olan'], ['ayse', 'book', 'Ç', '']];
  for (const [un, type, title, note] of talep) {
    r = await users[un].c.post('/api/requests', { type, title, note });
    if (r.status < 300) stats.requests++; else console.warn('talep', r.status, r.text);
  }
  console.log('SEED TAMAM', stats, '\nGiris: admin /', ADMIN_PW, '; aile:', FAMILY.map((f) => f.username).join(', '), '/', PW);
}
main().catch((e) => { console.error(e); process.exit(1); });
