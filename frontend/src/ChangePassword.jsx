import { useState } from 'react';
import { api } from './api.js';
import { ErrorBox, Modal } from './ui.jsx';

// must_change_pw ise kapatilamaz uyari; onDone() sonrasi kullanici yenilenir.
export default function ChangePassword({ forced, onDone, onClose }) {
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (newPw.length < 6) return setError(new Error('Yeni şifre en az 6 karakter olmalı.'));
    setBusy(true);
    setError(null);
    try {
      await api.changePassword(oldPw, newPw);
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={forced ? 'Şifreni değiştir' : 'Şifre değiştir'} onClose={forced ? () => {} : onClose} hideClose={forced}>
      {forced && <p>Güvenliğin için şimdi kendi şifreni belirlemelisin.</p>}
      <form onSubmit={submit}>
        <label className="field">
          <span>Şu anki şifre</span>
          <input type="password" autoComplete="current-password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} required />
        </label>
        <label className="field">
          <span>Yeni şifre (en az 6 karakter)</span>
          <input type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} required minLength={6} />
        </label>
        <ErrorBox error={error} />
        <button className="btn" disabled={busy}>
          Kaydet
        </button>
      </form>
    </Modal>
  );
}
