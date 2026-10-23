// Tum backend cagrilari burada. Sozlesme: ajanlar/API_SOZLESMESI.txt
export class ApiError extends Error {
  constructor(message, status, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
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
    throw new ApiError(msg, res.status, data?.fields);
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
  changePassword: (old_password, new_password) => request('POST', '/auth/change-password', { old_password, new_password }),

  feed: () => request('GET', '/feed'),
  leaderboard: (kind, period) => request('GET', `/leaderboards/${kind}${qs({ period })}`),

  search: (q, type) => request('GET', '/catalog/search' + qs({ q, type })),
  catalogItem: (id) => request('GET', `/catalog/${id}`),
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
  adminCatalog: (params) => request('GET', '/admin/catalog' + qs(params)),
  adminUpdateCatalog: (id, data) => request('PATCH', `/admin/catalog/${id}`, data),
  adminDeleteCatalog: (id) => request('DELETE', `/admin/catalog/${id}`),
  seriesProgress: (id, season, episode) => request('POST', `/entries/${id}/series-progress`, { season, episode }),

  comments: (id) => request('GET', `/entries/${id}/comments`),
  addComment: (id, body) => request('POST', `/entries/${id}/comments`, { body }),
  deleteComment: (cid) => request('DELETE', `/comments/${cid}`),
  questions: (id) => request('GET', `/entries/${id}/questions`),
  ask: (id, question) => request('POST', `/entries/${id}/questions`, { question }),
  answer: (qid, answer) => request('PATCH', `/questions/${qid}`, { answer }),
  pending: () => request('GET', '/me/pending-questions'),

  stats: (userId, period) => request('GET', `/users/${userId}/stats${qs({ period })}`),
  heatmap: (userId, days) => request('GET', `/users/${userId}/heatmap${qs({ days })}`),
  notifications: () => request('GET', '/notifications'),
  readNotifications: (data) => request('POST', '/notifications/read', data),

  adminUsers: () => request('GET', '/admin/users'),
  adminAddUser: (data) => request('POST', '/admin/users', data),
  adminDeleteUser: (id, hard) => request('DELETE', `/admin/users/${id}${hard ? '?hard=1' : ''}`),
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
};
