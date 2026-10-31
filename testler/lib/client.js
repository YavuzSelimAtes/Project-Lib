// Kucuk HTTP istemcisi: cerez + (varsa) Bearer token tasir. Bagimlilik yok.
const BASE = process.env.TEST_API || 'http://localhost:4100';

class Client {
  constructor(base = BASE) { this.base = base; this.cookies = {}; this.token = null; }

  async raw(method, path, { body, headers = {}, rawBody } = {}) {
    // cok gruplu yapi: feed/liderlik ?group= ister; defGroup verilmisse otomatik eklenir
    if (this.defGroup && method === 'GET' && /^\/api\/(feed|leaderboards|library)/.test(path) && !/[?&]group=/.test(path)) path += (path.includes('?') ? '&' : '?') + 'group=' + this.defGroup;
    const h = { ...headers };
    if (Object.keys(this.cookies).length) h.cookie = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    if (this.token) h.authorization = `Bearer ${this.token}`;
    let payload;
    if (rawBody !== undefined) payload = rawBody;
    else if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] ??= 'application/json'; }
    const res = await fetch(this.base + path, { method, headers: h, body: payload });
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const [pair] = sc.split(';'); const i = pair.indexOf('=');
      const k = pair.slice(0, i).trim(), v = pair.slice(i + 1).trim();
      if (!v || /max-age=0/i.test(sc) || /expires=thu, 01 jan 1970/i.test(sc)) delete this.cookies[k]; else this.cookies[k] = v;
    }
    const text = await res.text();
    let json; try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: res.status, headers: res.headers, text, json };
  }
  get(p, o) { return this.raw('GET', p, o); }
  post(p, body, o) { return this.raw('POST', p, { body, ...o }); }
  patch(p, body, o) { return this.raw('PATCH', p, { body, ...o }); }
  put(p, body, o) { return this.raw('PUT', p, { body, ...o }); }
  del(p, o) { return this.raw('DELETE', p, o); }

  async login(username, password) {
    const r = await this.post('/api/auth/login', { username, password });
    if (r.status === 200 && r.json) this.token = r.json.token ?? r.json.accessToken ?? this.token;
    return r;
  }
}

async function waitForServer(base = BASE, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(base + '/api/health'); if (r.status < 500) return true; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Backend ${base} hazir degil (${ms}ms)`);
}

const ymd = (d) => d.toISOString().slice(0, 10);
// Backend "bugun"u Europe/Istanbul gunudur; UTC kullanmak 21:00-24:00 UTC arasinda 1 gun kayar (seri/ay gecisi testlerini bozar).
const daysAgo = (n) => new Intl.DateTimeFormat('sv', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() - n * 86400e3));

module.exports = { Client, BASE, waitForServer, ymd, daysAgo };
