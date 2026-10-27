import { enqueue, isQueueable } from './offlineQueue.js';

// Tum backend cagrilari burada. Sozlesme: ajanlar/API_SOZLESMESI.txt
export class ApiError extends Error {
  constructor(message, status, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

// Backend bazi Turkce mesajlari ASCII yaziyor; bilinen sozcukleri duzgun Turkceye cevirir.
const TR_WORDS = {
  Gorunen: 'Görünen', gorunen: 'görünen', degistirilebilir: 'değiştirilebilir', bolumden: 'bölümden', Bolum: 'Bölüm', bolum: 'bölüm',
  olusuyor: 'oluşuyor', baskida: 'baskıda', baski: 'baskı', Baski: 'Baskı', sayfadasiniz: 'sayfadasınız', secin: 'seçin',
  sezonu: 'sezonu', icin: 'için', Icin: 'İçin', oldugu: 'olduğu', gecersiz: 'geçersiz', Gecersiz: 'Geçersiz', kucuk: 'küçük',
  buyuk: 'büyük', bulunamadi: 'bulunamadı', Kullanici: 'Kullanıcı', kullanici: 'kullanıcı', sifre: 'şifre', Sifre: 'Şifre',
  yok: 'yok', gun: 'gün', sayisi: 'sayısı', olmali: 'olmalı', olamaz: 'olamaz', hatali: 'hatalı', Bu: 'Bu',
};
function fixTr(m) {
  if (typeof m !== 'string') return m;
  return m.replace(/[A-Za-z]+/g, (w) => TR_WORDS[w] ?? w);
}

async function request(method, path, body, canQueue = false) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // Cevrimdisi: yalnizca gunluk ilerleme cagrilari kuyruga alinir, arayuze 'bekliyor' doner
    if (canQueue && isQueueable(method, path)) {
      try {
        await enqueue(method, path, body);
        return { queued: true };
      } catch {
        /* IndexedDB yok: normal hata */
      }
    }
    throw new ApiError('Sunucuya ulaşılamadı. Bağlantını kontrol edip tekrar dene.', 0);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* bos govde */
  }
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login' && path !== '/auth/me') window.dispatchEvent(new Event('auth-expired'));
    const msg =
      (typeof data?.error === 'string' && data.error) ||
      (res.status === 401
        ? 'Oturum gerekli.'
        : res.status === 403
          ? 'Bu işlem için yetkin yok.'
          : res.status >= 500
            ? 'Sunucuda bir sorun oluştu. Biraz sonra tekrar dene.'
            : 'İşlem tamamlanamadı.');
    throw new ApiError(fixTr(msg), res.status, data?.fields);
  }
  return data;
}

const qs = (o) => {
  const p = new URLSearchParams();
  Object.entries(o || {}).forEach(([k, v]) => v != null && v !== '' && p.set(k, v));
  const s = p.toString();
  return s ? '?' + s : '';
};

export const api = {
  login: (username, password) => request('POST', '/auth/login', { username, password }),
  logout: () => request('POST', '/auth/logout'),
  me: () => request('GET', '/auth/me'),
  linkedAccounts: () => request('GET', '/auth/linked'),
  switchAccount: (user_id) => request('POST', '/auth/switch', { user_id }),
  adminLinkGroups: () => request('GET', '/admin/link-groups'),
  adminSetLinkGroup: (user_ids) => request('PUT', '/admin/link-groups', { user_ids }),
  adminDeleteLinkGroup: (id) => request('DELETE', `/admin/link-groups/${id}`),
  pushKey: () => request('GET', '/push/key'),
  pushSubscribe: (sub) => request('POST', '/push/subscribe', sub),
  pushUnsubscribe: (endpoint) => request('POST', '/push/unsubscribe', { endpoint }),
  pushPrefs: () => request('GET', '/push/prefs'),
  pushSetPrefs: (p) => request('PUT', '/push/prefs', p),
  changePassword: (old_password, new_password) => request('POST', '/auth/change-password', { old_password, new_password }),

  feed: () => request('GET', '/feed'),
  leaderboard: (kind, period) => request('GET', `/leaderboards/${kind}${qs({ period })}`),

  search: (q, type, lang) => request('GET', '/catalog/search' + qs({ q, type, lang })),
  catalogItem: (id) => request('GET', `/catalog/${id}`),
  catalogEditions: (id, lang) => request('GET', `/catalog/${id}/editions${qs({ lang })}`),
  catalogSeasons: (id, refresh) => request('GET', `/catalog/${id}/seasons${qs({ refresh: refresh ? 1 : '' })}`),
  avatars: () => request('GET', '/avatars'),
  updateProfile: (data) => request('PATCH', '/me/profile', data),
  pickCatalog: (key) => request('POST', '/catalog/pick', { key }),
  createRequest: (data) => request('POST', '/requests', data),
  myRequests: () => request('GET', '/requests'),

  entries: (params) => request('GET', '/entries' + qs(params)),
  entry: (id) => request('GET', `/entries/${id}`),
  createEntry: (data) => request('POST', '/entries', data),
  updateEntry: (id, data) => request('PATCH', `/entries/${id}`, data),
  deleteEntry: (id) => request('DELETE', `/entries/${id}`),
  progress: (id, current_page, date, confirm) =>
    request('POST', `/entries/${id}/progress`, { current_page, ...(date ? { date } : {}), ...(confirm ? { confirm: true } : {}) }),
  openDays: (id) => request('GET', `/entries/${id}/open-days`),
  dayLogs: (id, body) => request('PUT', `/entries/${id}/day-logs`, body, body?.add === true),
  adminCatalog: (params) => request('GET', '/admin/catalog' + qs(params)),
  adminUpdateCatalog: (id, data) => request('PATCH', `/admin/catalog/${id}`, data),
  adminDeleteCatalog: (id) => request('DELETE', `/admin/catalog/${id}`),
  seriesProgress: (id, season, episode) => request('POST', `/entries/${id}/series-progress`, { season, episode }, true),

  comments: (id) => request('GET', `/entries/${id}/comments`),
  addComment: (id, body) => request('POST', `/entries/${id}/comments`, { body }),
  deleteComment: (cid) => request('DELETE', `/comments/${cid}`),
  questions: (id) => request('GET', `/entries/${id}/questions`),
  ask: (id, question) => request('POST', `/entries/${id}/questions`, { question }),
  answer: (qid, answer) => request('PATCH', `/questions/${qid}`, { answer }),
  pending: () => request('GET', '/me/pending-questions'),

  stats: (userId, period, type) => request('GET', `/users/${userId}/stats${qs({ period, type })}`),
  heatmap: (userId, days) => request('GET', `/users/${userId}/heatmap${qs({ days })}`),
  calendar: (userId, from, to) => request('GET', `/users/${userId}/calendar${qs({ from, to })}`),
  notifications: () => request('GET', '/notifications'),
  readNotifications: (data) => request('POST', '/notifications/read', data),

  adminUsers: () => request('GET', '/admin/users'),
  adminAddUser: (data) => request('POST', '/admin/users', data),
  adminDeleteUser: (id, hard) => request('DELETE', `/admin/users/${id}${hard ? '?hard=1' : ''}`),
  adminAddEdition: (catalogId, data) => request('POST', `/admin/catalog/${catalogId}/editions`, data),
  adminDeleteEdition: (id) => request('DELETE', `/admin/editions/${id}`),
  adminUpdateUser: (id, data) => request('PATCH', `/admin/users/${id}`, data),
  adminActivateUser: (id) => request('POST', `/admin/users/${id}/activate`),
  adminResetPassword: (id, password) => request('POST', `/admin/users/${id}/reset-password`, { password }),
  adminRequests: (status) => request('GET', '/admin/requests' + qs({ status })),
  adminUpdateRequest: (id, data) => request('PATCH', `/admin/requests/${id}`, data),
  adminAddCatalog: async (data, file) => {
    if (!file) return request('POST', '/admin/catalog', data);
    const fd = new FormData();
    Object.entries(data).forEach(([k, v]) => v != null && v !== '' && fd.append(k, v));
    fd.append('cover', file);
    let res;
    try {
      res = await fetch('/api/admin/catalog', { method: 'POST', body: fd, credentials: 'same-origin' });
    } catch {
      throw new ApiError('Sunucuya ulaşılamadı.', 0);
    }
    const j = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(j?.error || 'Katalog kaydı eklenemedi.', res.status, j?.fields);
    return j;
  },
  adminImport: (type, query) => request('POST', '/admin/catalog/import', { type, query }),
  congrats: (id) => request('POST', `/entries/${id}/congrats`),
  bookMetrics: () => request('GET', '/book-metrics'),
  ratings: (cid) => request('GET', `/catalog/${cid}/ratings`),
  saveRatings: (cid, genre, scores) => request('PUT', `/catalog/${cid}/ratings`, { ...(genre ? { genre } : {}), scores }),
  deleteRatings: (cid) => request('DELETE', `/catalog/${cid}/ratings`),
  react: (cid, emoji) => request('PUT', `/comments/${cid}/reaction`, { emoji }),
  library: (params) => request('GET', '/library' + qs(params)),
  libraryItem: (id) => request('GET', `/library/${id}`),
  libraryComments: (id, params) => request('GET', `/library/${id}/comments` + qs(params)),
  libraryQuestions: (id, params) => request('GET', `/library/${id}/questions` + qs(params)),
  adminReadingStatus: (all) => request('GET', '/admin/reading-status' + qs({ all: all ? 1 : '' })),
  adminNudge: (id) => request('POST', `/admin/users/${id}/nudge`),
};
