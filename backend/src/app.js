import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import fstatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { openDb, COVERS_DIR } from './db.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COOKIE, userFromToken, hashPassword } from './auth.js';
import { HttpError, nowIso } from './util.js';
import adminRoutes from './routes/admin.js';
import authRoutes from './routes/auth.js';
import catalogRoutes from './routes/catalog.js';
import requestRoutes from './routes/requests.js';
import entryRoutes from './routes/entries.js';
import socialRoutes from './routes/social.js';
import feedRoutes from './routes/feed.js';
import { cleanupUnlisted } from './services/catalog.js';
import { seedExtraDb, seedExtraCovers } from './services/seedExtra.js';

async function seedAdmin(db, log) {
  const row = db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin'").get();
  if (row.c > 0) {
    if (db.prepare("SELECT 1 FROM users WHERE role='admin' AND must_change=1").get()) log.warn('UYARI: Admin hesabi hala varsayilan sifreyi kullaniyor. Giris yapip sifreyi degistirin!');
    return;
  }
  let pw = process.env.ADMIN_PASSWORD;
  const isDefault = !pw;
  if (!pw) {
    pw = crypto.randomBytes(9).toString('base64url');
    log.warn(`ADMIN_PASSWORD ayarlanmamis: rastgele admin sifresi uretildi -> kullanici: admin  sifre: ${pw}  (ilk giriste degistirmeniz istenecek; bu sifre bir daha gosterilmez)`);
  }
  db.prepare('INSERT INTO users (username,display_name,password_hash,role,avatar,color,must_change,created_at) VALUES (?,?,?,?,?,?,?,?)').run(
    'admin', 'Yonetici', await hashPassword(pw), 'admin', '👑', '#0ea5e9', isDefault ? 1 : 0, nowIso(),
  );
  log.info('Admin hesabi olusturuldu (kullanici adi: admin).');
}

export async function buildApp({ logger = true } = {}) {
  const db = openDb();
  const app = Fastify({ logger, bodyLimit: 1024 * 1024, trustProxy: process.env.TRUST_PROXY === '1' });
  app.decorate('db', db);
  // Bos govdeli JSON isteklerini (DELETE vb.) hata saymaz
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    if (!body) return done(null, undefined);
    try { done(null, JSON.parse(body)); } catch { const e = new Error('Gecersiz JSON'); e.statusCode = 400; done(e); }
  });

  await app.register(cookie);
  // Arayuz ayni origin'den sunuldugu (ve Vite proxy kullandigi) icin CORS varsayilan KAPALI.
  // Baska bir origin'den erismek icin CORS_ORIGIN=http://adres:port (virgulle birden cok)
  if (process.env.CORS_ORIGIN) {
    const allowed = process.env.CORS_ORIGIN.split(',').map((s) => s.trim());
    await app.register(cors, { origin: allowed, credentials: true, methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'] });
  }
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  await app.register(fstatic, { root: COVERS_DIR, prefix: '/api/covers/', maxAge: '7d', immutable: false, decorateReply: false });

  // Kapak yolunda gezinme denemelerini (.., ters egik cizgi, kodlu ayiricilar) erkenden 404'le
  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/api/covers/') && /(\.\.|%2e|%2f|%5c|\\)/i.test(req.url)) {
      return reply.code(404).send({ error: 'Boyle bir adres yok', code: 'NOT_FOUND' });
    }
  });

  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    const token = req.cookies?.[COOKIE];
    req.user = token ? userFromToken(db, token) : null;
  });

  app.setErrorHandler((e, req, reply) => {
    if (e instanceof HttpError) {
      return reply.code(e.status).send({ error: e.message, code: e.code, ...(e.fields ? { fields: e.fields } : {}) });
    }
    if (e.code === 'FST_ERR_CTP_INVALID_JSON_BODY' || e.code === 'FST_ERR_CTP_EMPTY_JSON_BODY' || e.statusCode === 400) {
      return reply.code(400).send({ error: 'Gecersiz istek govdesi', code: 'VALIDATION' });
    }
    if (e.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(400).send({ error: 'Dosya cok buyuk (en fazla 5MB)', code: 'VALIDATION' });
    }
    if (e.statusCode === 413) {
      return reply.code(413).send({ error: 'Istek cok buyuk (en fazla 1MB)', code: 'VALIDATION' });
    }
    if (e.statusCode === 415) {
      return reply.code(415).send({ error: 'Desteklenmeyen icerik turu; JSON gonderin', code: 'VALIDATION' });
    }
    req.log.error(e);
    reply.code(500).send({ error: 'Beklenmeyen bir hata olustu', code: 'SERVER' });
  });
  // Derlenmis arayuz (frontend/dist) varsa ayni sunucudan sunulur; SPA yollari index.html'e duser
  const dist = process.env.FRONTEND_DIST ? path.resolve(process.env.FRONTEND_DIST) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend', 'dist');
  const hasDist = fs.existsSync(path.join(dist, 'index.html'));
  if (hasDist) {
    await app.register(fstatic, {
      root: dist, prefix: '/', cacheControl: false,
    });
    // Vite ciktilari ozet (hash) adli: /assets uzun sure onbellek, index.html hep taze
    app.addHook('onSend', async (req, reply) => {
      if (req.method !== 'GET' || req.url.startsWith('/api/')) return;
      reply.header('Cache-Control', req.url.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
    });
    app.log.info(`Arayuz frontend/dist'ten sunuluyor (${dist})`);
  } else {
    app.log.warn('frontend/dist yok: arayuz sunulmuyor. Aileye kurulum icin once `npm run build` calistirin.');
  }
  app.setNotFoundHandler((req, reply) => {
    if (hasDist && req.method === 'GET' && !req.url.startsWith('/api/') && (req.headers.accept || '').includes('text/html')) {
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    }
    reply.code(404).send({ error: 'Boyle bir adres yok', code: 'NOT_FOUND' });
  });

  app.get('/api/health', async () => ({ ok: true, time: nowIso() }));
  for (const r of [adminRoutes, authRoutes, catalogRoutes, requestRoutes, entryRoutes, socialRoutes, feedRoutes]) await app.register(r);

  await seedAdmin(db, app.log);
  // Kurator listesi (aranan ama bulunamayan kitaplar): veritabani kismi aninda, kapaklar arka planda. SEED_EXTRA=0 ile kapatilir.
  if (process.env.SEED_EXTRA !== '0') {
    try {
      const r = seedExtraDb(db);
      if (r.touched) app.log.info(`seed-extra: ${r.touched} kitap islendi (${r.added} yeni katalog kaydi)`);
    } catch (e) { app.log.warn(`seed-extra calismadi: ${e.message}`); }
    if (process.env.SEED_EXTRA_COVERS !== '0') {
      let closing = false;
      app.addHook('onClose', async () => { closing = true; });
      const t = setTimeout(() => { if (!closing) seedExtraCovers(db, app.log).catch(() => {}); }, 3000);
      t.unref();
    }
  }
  const housekeeping = () => {
    try { db.prepare('DELETE FROM sessions WHERE expires_at<?').run(nowIso()); } catch { /* onemsiz */ }
    try { cleanupUnlisted(db, 14); } catch { /* onemsiz */ } // kullanilmayan onizleme (pick) kayitlari 14 gunde silinir
  };
  housekeeping();
  const timer = setInterval(housekeeping, 12 * 3600 * 1000);
  timer.unref();
  app.addHook('onClose', async () => db.close());
  return app;
}
