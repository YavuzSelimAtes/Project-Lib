import { useEffect, useState } from 'react';
import { api } from './api.js';
import { useAuth } from './auth.js';
import { Avatar, ErrorBox, Modal } from './ui.jsx';
import PushSettings from './PushSettings.jsx';
import DiceAvatarPicker from './DiceAvatarPicker.jsx';
import { isDice } from './diceAvatar.js';

export const COLORS = ['#f97316', '#ef4444', '#ec4899', '#8b5cf6', '#3b82f6', '#14b8a6', '#22c55e', '#eab308', '#64748b', '#a16207'];

// /api/avatars yoksa kucuk yedek liste (alan yoksa uygulama calismaya devam eder)
const FALLBACK = [{ id: 'hayvanlar', label: 'Hayvanlar', items: ['🦊', '🐼', '🐯', '🦁', '🐸', '🐙', '🦉', '🐰', '🐻', '🦄', '🐧', '🐱'] }];
let cache = null;
function useAvatarGroups() {
  const [groups, setGroups] = useState(cache || null);
  useEffect(() => {
    if (cache) return;
    let alive = true;
    api.avatars().then(
      (r) => {
        const g = Array.isArray(r?.groups) && r.groups.length ? r.groups : FALLBACK;
        cache = g;
        if (alive) setGroups(g);
      },
      () => alive && setGroups(FALLBACK),
    );
    return () => {
      alive = false;
    };
  }, []);
  return groups;
}

// Gruplu avatar izgarasi + "Rastgele"
export function AvatarPicker({ value, onChange }) {
  const [tab, setTab] = useState(isDice(value) ? 'dice' : 'emoji');
  return (
    <div>
      <div className="tabs" role="tablist" aria-label="Avatar türü" style={{ marginBottom: 8 }}>
        <button type="button" role="tab" aria-selected={tab === 'emoji'} className="tab sm" onClick={() => setTab('emoji')}>Emoji</button>
        <button type="button" role="tab" aria-selected={tab === 'dice'} className="tab sm" onClick={() => setTab('dice')}>Resim</button>
      </div>
      {tab === 'dice' ? <DiceAvatarPicker value={value} onChange={onChange} /> : <EmojiPicker value={isDice(value) ? '' : value} onChange={onChange} />}
    </div>
  );
}

function EmojiPicker({ value, onChange }) {
  const groups = useAvatarGroups();
  if (!groups) return <p className="muted small">Avatarlar yükleniyor…</p>;
  const all = groups.flatMap((g) => g.items || []);
  return (
    <div className="avpick">
      <div className="row" style={{ marginBottom: 6 }}>
        <button type="button" className="btn small ghost" onClick={() => all.length && onChange(all[Math.floor(Math.random() * all.length)])}>
          🎲 Rastgele
        </button>
      </div>
      <div className="avpick-scroll">
        {groups.map((g) => (
          <div key={g.id || g.label}>
            <div className="avpick-label">{g.label}</div>
            <div className="avpick-grid">
              {(g.items || []).map((a) => (
                <button type="button" key={a} className="av-opt" aria-pressed={value === a} aria-label={`Avatar ${a}`} onClick={() => onChange(a)}>
                  {a}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ColorPicker({ value, onChange }) {
  const custom = !COLORS.includes(value);
  return (
    <div className="row" style={{ gap: 8 }}>
      {COLORS.map((c) => (
        <button
          type="button"
          key={c}
          className="swatch"
          aria-label={`Renk ${c}`}
          aria-pressed={value === c}
          onClick={() => onChange(c)}
          style={{ background: c }}
        />
      ))}
      <label className={`swatch custom${custom ? ' on' : ''}`} title="Özel renk" style={custom ? { background: value } : undefined}>
        <span aria-hidden="true">{custom ? '' : '+'}</span>
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#f97316'} onChange={(e) => onChange(e.target.value)} aria-label="Özel renk seç" />
      </label>
    </div>
  );
}

// Backend ile ayni kural: bosluklar daraltilir/trim, 2-30 karakter, '<' '>' ve gorunmez/kontrol karakter yasak.
const BAD_INVISIBLE = /[\u0000-\u001f\u007f-\u009f­؜᠎​-‏‪-‮⁠-⁯﻿]/;
export function validateName(raw) {
  const norm = String(raw ?? '').replace(/\s+/g, ' ').trim();
  let error = null;
  if (/[<>]/.test(raw)) error = 'Ad “<” ve “>” karakterlerini içeremez.';
  else if (BAD_INVISIBLE.test(raw)) error = 'Ad görünmez ya da kontrol karakteri içeremez.';
  else if (norm.length < 2 || norm.length > 30) error = 'Ad 2 ile 30 karakter arasında olmalı.';
  return { norm, error };
}

export default function ProfileEdit({ onClose }) {
  const { user, refresh } = useAuth();
  const [avatar, setAvatar] = useState(user.avatar || '🙂');
  const [color, setColor] = useState(user.color || COLORS[0]);
  const [name, setName] = useState(user.display_name || '');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const locked = !!user.name_changed;
  // ad alani dokunulduysa dogrula; normalize hal mevcut adla ayniysa hak harcanmaz (onay gerekmez)
  const touched = !locked && name !== user.display_name;
  const { norm, error: nameError } = validateName(name);
  const nameDirty = touched && norm !== user.display_name;
  const nameInvalid = touched && !!nameError;
  const dirty = avatar !== user.avatar || color !== user.color || nameDirty;

  const tryClose = () => {
    if (done || !dirty || window.confirm('Kaydedilmemiş değişiklikler var. Yine de kapatılsın mı?')) onClose();
  };

  const save = async (e) => {
    e.preventDefault();
    if (nameInvalid) return setError(new Error(nameError));
    if (nameDirty && !ack) return setError(new Error('Görünen adı yalnızca bir kez değiştirebilirsin; devam etmek için kutuyu işaretle.'));
    setBusy(true);
    setError(null);
    try {
      const body = {};
      if (avatar !== user.avatar) body.avatar = avatar;
      if (color !== user.color) body.color = color;
      if (nameDirty) body.display_name = norm;
      await api.updateProfile(body);
      await refresh();
      setDone(true);
      setTimeout(onClose, 700);
    } catch (x) {
      setError(x);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Profili düzenle" onClose={tryClose}>
      <form onSubmit={save}>
        <div className="card ucard preview" style={{ '--c': color, marginBottom: 14 }} role="group" aria-label="Önizleme">
          <div className="ucard-head">
            <Avatar user={{ avatar, color }} size="lg" />
            <div className="grow">
              <b>{touched && !nameError ? norm : user.display_name}</b>
              <div className="small muted">Önizleme: kartlarda böyle görünürsün</div>
            </div>
          </div>
        </div>

        <div className="field" role="group" aria-label="Avatar seç">
          <span>Avatar</span>
          <AvatarPicker value={avatar} onChange={setAvatar} />
        </div>
        <div className="field" style={{ marginTop: 12 }} role="group" aria-label="Renk seç">
          <span>Renk</span>
          <div style={{ marginTop: 6 }}>
            <ColorPicker value={color} onChange={setColor} />
          </div>
        </div>

        <label className="field" style={{ marginTop: 12 }}>
          <span>Görünen ad</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} disabled={locked} aria-describedby="nm-note" aria-invalid={nameInvalid} />
        </label>
        <div id="nm-note" aria-live="polite" style={{ marginTop: -6, marginBottom: 12 }}>
          {locked ? (
            <p className="small muted" style={{ margin: 0 }}>
              🔒 Görünen adını daha önce değiştirdin; bir daha değiştirilemez. Gerekirse yöneticiden iste.
            </p>
          ) : (
            <>
              <p className="small muted" style={{ margin: '0 0 4px' }}>
                Görünen adı yalnızca <b>bir kez</b> değiştirebilirsin.
              </p>
              {nameInvalid && <p className="small" style={{ margin: '0 0 4px', color: 'var(--danger)', fontWeight: 700 }}>{nameError}</p>}
              {touched && !nameError && norm !== name && nameDirty && <p className="small muted" style={{ margin: '0 0 4px' }}>Kaydedilecek ad: “{norm}” (boşluklar düzenlendi)</p>}
              {nameDirty && !nameInvalid && (
                <label className="small" style={{ display: 'block' }}>
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> Bir kere değiştirebileceğimi biliyorum; “{norm}” adı kalıcı olacak
                </label>
              )}
            </>
          )}
        </div>

        <PushSettings uid={user.id} />

        <ErrorBox error={error} />
        <div role="status" aria-live="polite">{done && <p className="ok-note">✅ Kaydedildi</p>}</div>
        <div className="row">
          <button type="button" className="btn ghost" onClick={tryClose}>
            Vazgeç
          </button>
          <button className="btn" disabled={busy || !dirty || done || nameInvalid}>
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
