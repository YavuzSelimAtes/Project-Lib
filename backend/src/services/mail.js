import nodemailer from 'nodemailer';

// SMTP ayarlari ortamdan okunur (kod/dosyada sifre yok). SMTP_USER/SMTP_PASS yoksa mail atlanir.
// SMTP_TEST_JSON=1: gercek ag kullanmadan nodemailer jsonTransport (testler icin)
let cached = null;
export function mailTransport() {
  if (process.env.SMTP_TEST_JSON === '1') return (cached ||= nodemailer.createTransport({ jsonTransport: true }));
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  const port = Number(process.env.SMTP_PORT) || 465;
  return (cached ||= nodemailer.createTransport({ host: process.env.SMTP_HOST || 'smtp.gmail.com', port, secure: port === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }));
}

// Tek satir (CR/LF/satir ayiricilar temizlenir: header enjeksiyonu olmaz)
const oneLine = (s, n) => String(s).replace(/\s+/g, ' ').trim().slice(0, n); // \s: CR/LF ve satir ayiricilari da kapsar
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Geri bildirim maili; gonderildiyse true, atlandi/hata ise false (asla firlatmaz)
export async function sendFeedbackMail({ kind, message, user, page, createdAt }, log) {
  const tr = mailTransport();
  if (!tr) return false;
  try {
    const to = process.env.FEEDBACK_TO || 'yavuzslm60@gmail.com';
    const from = process.env.FEEDBACK_FROM || process.env.SMTP_USER || 'kutuphane@localhost';
    const rows = [['Tür', kind], ['Kullanıcı', `${user.display_name} (@${user.username})`], ['Hesap türü', user.kind === 'manager' ? 'grup yöneticisi' : 'kişisel'], ['Sayfa', page || '-'], ['Tarih', createdAt]];
    await tr.sendMail({
      from, to,
      subject: `[Kutuphane] ${oneLine(kind, 20)}: ${oneLine(message, 50)}`,
      text: `${message}\n\n${rows.map(([k, v]) => `${k}: ${oneLine(v, 200)}`).join('\n')}`,
      html: `<p style="white-space:pre-wrap">${esc(message)}</p><hr>${rows.map(([k, v]) => `<div><b>${esc(k)}:</b> ${esc(oneLine(v, 200))}</div>`).join('')}`,
    });
    return true;
  } catch (e) {
    log?.warn?.(`Geri bildirim maili gonderilemedi: ${e.code || e.message}`); // parola/icerik loglanmaz
    return false;
  }
}
