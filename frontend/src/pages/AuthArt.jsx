// Gercek 3B kitap (CSS 3D): doner, kapagi acilir, sayfalari cevrilir
export function BookArt() {
  const lines = [0, 1, 2, 3, 4].map((n) => <i key={n} />);
  return (
    <div className="reg-art" aria-hidden="true">
      <div className="b3-scene">
        <div className="b3">
          <div className="b3-face b3-back" />
          <div className="b3-face b3-spine" />
          <div className="b3-face b3-pages" />
          <div className="b3-face b3-top" />
          <div className="b3-face b3-bottom" />
          <div className="b3-face b3-sheet">{lines}</div>
          <div className="b3-leaf"><div className="b3-leaf-f">{lines}</div></div>
          <div className="b3-cover">
            <div className="b3-cover-f"><span className="b3-emb" /><span className="b3-t" /><span className="b3-t s" /></div>
            <div className="b3-cover-b">{lines}</div>
          </div>
        </div>
      </div>
      <div className="b3-shadow" />
    </div>
  );
}
