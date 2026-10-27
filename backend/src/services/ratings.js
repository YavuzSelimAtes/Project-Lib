import { bad, err, round1, nowIso, publicUser } from '../util.js';

// Kitap puanlama: tur (genre) katalog seviyesindedir (catalog.genre); metrikler sunucuda sabittir.
export const GENRES = {
  kurgu: {
    label: 'Kurgu',
    metrics: [
      { key: 'senaryo', name: 'Senaryo', description: 'Olay orgusu, surprizler ve son ne kadar tutarli ve ilgi cekici?' },
      { key: 'akicilik', name: 'Akicilik', description: 'Sayfalar kendiliginden akip gidiyor mu, yoksa okurken takiliyor muyum?' },
      { key: 'karakterler', name: 'Karakterler', description: 'Karakterler inandirici, derin ve akilda kalici mi? Karakter gelisimi var mi? (Gelisim/degisim yoksa dusuk puan verilmeli)' },
      { key: 'dil', name: 'Dil ve Anlatim', description: 'Uslup, kelime secimi ve betimlemelerin kalitesi.' },
      { key: 'duygu', name: 'Duygusal Etki', description: 'Heyecan, huzun ya da kahkaha hissettirdi mi; bitince icimde iz birakti mi?' },
    ],
  },
  felsefe: {
    label: 'Felsefe',
    metrics: [
      { key: 'onem', name: 'Fikrin Onemi', description: 'Tartisilan dusunce felsefe ve insanlik icin ne kadar temel ve onemli?' },
      { key: 'anlasilirlik', name: 'Anlasilirlik', description: 'Zor konuyu rahatca takip edebildim mi?' },
      { key: 'arguman', name: 'Arguman Gucu', description: 'Savundugu seyi tutarli ve ikna edici sekilde temellendiriyor mu?' },
      { key: 'ornek', name: 'Ornek ve Anlatim', description: 'Ornekler, benzetmeler ve dil kalitesi.' },
      { key: 'butunluk', name: 'Butunluk', description: 'Konularin sirasi ve kitabin tek parca gibi ilerlemesi.' },
    ],
  },
};
export const GENRE_KEYS = Object.keys(GENRES);
export const SCALE = { 1: 'Cok kotu', 2: 'Kotu', 3: 'Idare eder', 4: 'Iyi', 5: 'Cok iyi' };

// Katalog turunu ayarla. Bu kitaba zaten puan verilmisse baska ture gecis 409 (metrikler uyusmaz).
export function setGenre(db, catalogId, genre) {
  const cat = db.prepare('SELECT id,type,genre FROM catalog WHERE id=?').get(catalogId);
  if (!cat) throw err(404, 'Katalog kaydi bulunamadi');
  if (genre === null || genre === undefined || genre === '') return cat.genre;
  if (!GENRE_KEYS.includes(genre)) throw bad(`genre su degerlerden biri olmali: ${GENRE_KEYS.join(', ')}`, { genre: 'gecersiz deger' });
  if (cat.type !== 'book') throw bad('Tur sadece kitaplar icin secilir', { genre: 'gecersiz' });
  if (cat.genre === genre) return genre;
  if (cat.genre && db.prepare('SELECT 1 FROM book_ratings WHERE catalog_id=?').get(catalogId)) {
    throw err(409, 'Bu kitaba puan verilmis; tur artik degistirilemez', { genre: 'puanli' });
  }
  db.prepare('UPDATE catalog SET genre=? WHERE id=?').run(genre, catalogId);
  return genre;
}

// Kitap puani ozeti: tum kullanici puanlarinin tum metriklerle ortalamasi + kullanici ve metrik bazli ortalamalar
export function ratingSummary(db, catalogId, meId = null) {
  const cat = db.prepare('SELECT id,genre FROM catalog WHERE id=?').get(catalogId);
  const rows = db.prepare('SELECT user_id,metric,score FROM book_ratings WHERE catalog_id=? ORDER BY user_id').all(catalogId);
  const users = new Map();
  const metricSum = {};
  let total = 0;
  for (const r of rows) {
    if (!users.has(r.user_id)) users.set(r.user_id, {});
    users.get(r.user_id)[r.metric] = r.score;
    (metricSum[r.metric] ||= []).push(r.score);
    total += r.score;
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const byUser = [...users].map(([uid, scores]) => ({
    user: publicUser(db.prepare('SELECT id,display_name,avatar,color FROM users WHERE id=?').get(uid)),
    scores, average: round1(mean(Object.values(scores))),
  }));
  const byMetric = {};
  for (const [k, a] of Object.entries(metricSum)) byMetric[k] = round1(mean(a));
  const mine = meId != null && users.has(meId) ? { scores: users.get(meId), average: round1(mean(Object.values(users.get(meId)))) } : null;
  return {
    catalog_id: catalogId, genre: cat?.genre ?? null,
    metrics: cat?.genre ? GENRES[cat.genre].metrics : [],
    average: rows.length ? Math.round((total / rows.length) * 100) / 100 : null, // tum puanlarin ortalamasi (2 basamak)
    count: users.size, by_user: byUser, by_metric: byMetric, mine,
  };
}

// Puan verme kurali: kitap, kullanicinin kayitlarinda 'devam' / 'bitti' / 'birakildi' durumunda olmali (planlandi yetmez)
export const canRate = (db, userId, catalogId) => !!db.prepare("SELECT 1 FROM entries e JOIN catalog c ON c.id=e.catalog_id WHERE e.user_id=? AND e.catalog_id=? AND c.type='book' AND e.status IN ('devam','bitti','birakildi')").get(userId, catalogId);

export function saveRatings(db, userId, catalogId, genre, scores) {
  const g = setGenre(db, catalogId, genre);
  if (!g) throw bad('Once kitabin turunu secin (genre: kurgu | felsefe)', { genre: 'gerekli' });
  if (!scores || typeof scores !== 'object' || Array.isArray(scores)) throw bad('scores nesne olmali', { scores: 'gecersiz' });
  const keys = GENRES[g].metrics.map((m) => m.key);
  for (const k of Object.keys(scores)) if (!keys.includes(k)) throw bad(`Bilinmeyen metrik: ${k}`, { scores: 'gecersiz metrik' });
  for (const k of keys) {
    const v = scores[k];
    if (!Number.isInteger(v) || v < 1 || v > 5) throw bad(`${k} icin 1-5 arasi tam sayi puan gerekli`, { scores: `${k}: 1-5` });
  }
  const now = nowIso();
  const up = db.prepare(`INSERT INTO book_ratings (user_id,catalog_id,metric,score,created_at,updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(user_id,catalog_id,metric) DO UPDATE SET score=excluded.score, updated_at=excluded.updated_at`);
  for (const k of keys) up.run(userId, catalogId, k, scores[k], now, now);
}
