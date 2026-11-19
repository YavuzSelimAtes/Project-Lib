import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, ChevronLeft } from 'lucide-react';

// Grup icindeyken sol ustteki grup adi: tiklayinca "Hesabima don" + diger gruplara gecis
export default function GroupSwitch({ group, groups }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    if (!open) return;
    const down = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    const key = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const close = () => setOpen(false);
  return (
    <div ref={box} className="gsw">
      <button className="brand brand-group gsw-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="true" aria-expanded={open} aria-label={`${group.name}: grup menüsü`}>
        <img className="brand-tile" src="/brand.png" alt="" width="28" height="28" />
        <span>{group.name}</span>
        <ChevronDown size={16} aria-hidden="true" className={'gsw-chev' + (open ? ' open' : '')} />
      </button>
      {open && (
        <div role="menu" aria-label="Grup menüsü" className="sw-menu gsw-menu">
          <Link role="menuitem" className="sw-item gsw-home" to="/ana" onClick={close}>
            <ChevronLeft size={18} aria-hidden="true" />
            <span className="sw-txt"><b>Hesabıma dön</b><span className="muted small">Ana sayfa, defterim, hedeflerim</span></span>
          </Link>
          {groups.length > 1 && <div className="sw-h">Gruplarım</div>}
          {groups.length > 1 &&
            groups.map((g) => (
              <Link key={g.id} role="menuitem" className="sw-item" to={`/g/${g.id}`} onClick={close} aria-current={g.id === group.id ? 'true' : undefined}>
                <span className="grow">{g.name}</span>
                {g.id === group.id && <Check size={16} aria-hidden="true" className="gsw-check" />}
              </Link>
            ))}
        </div>
      )}
    </div>
  );
}
