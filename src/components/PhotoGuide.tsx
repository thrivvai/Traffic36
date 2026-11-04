import { useId, type ReactNode } from "react";
import { Icon } from "./Icon.tsx";

/** A driver's license, drawn simply: photo, name lines, and a stripe or barcode on the back. */
function Card({ x, y, back = false, w = 64, h = 41 }: { x: number; y: number; back?: boolean; w?: number; h?: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect className="pg-card" width={w} height={h} rx="4" />
      {back ? (
        <>
          <rect className="pg-ink" x="6" y="7" width={w - 12} height="5" rx="1" />
          {Array.from({ length: 14 }, (_, i) => (
            <rect key={i} className="pg-ink" x={7 + i * ((w - 14) / 14)} y="18" width={i % 3 ? 1.6 : 2.6} height="15" />
          ))}
        </>
      ) : (
        <>
          <rect className="pg-heat" x="0" y="0" width={w} height="6" rx="2" />
          <rect className="pg-face" x="6" y="11" width="15" height="19" rx="2" />
          <rect className="pg-ink" x="26" y="13" width={w - 33} height="3" rx="1.5" />
          <rect className="pg-ink" x="26" y="20" width={w - 40} height="3" rx="1.5" />
          <rect className="pg-ink" x="26" y="27" width={w - 37} height="3" rx="1.5" />
          <rect className="pg-ink" x="6" y="34" width={w - 30} height="2.5" rx="1.25" />
        </>
      )}
    </g>
  );
}

/** The four corner marks of a camera viewfinder. */
function Frame() {
  const c = "pg-frame";
  return (
    <g className={c}>
      <path d="M14 18v-6h8M106 18v-6h-8M14 62v6h8M106 62v6h-8" />
    </g>
  );
}

function Tile({ ok, label, children }: { ok: boolean; label: string; children: ReactNode }) {
  return (
    <figure className={`pg-tile ${ok ? "ok" : "no"}`}>
      <svg viewBox="0 0 120 80" role="img" aria-label={label}>
        <rect className="pg-surface" width="120" height="80" rx="8" />
        {children}
      </svg>
      <figcaption>
        <span className="pg-mark" aria-hidden="true"><Icon name={ok ? "check" : "x"} size={12} /></span>
        {label}
      </figcaption>
    </figure>
  );
}

/**
 * How to take license photos the host can read the first time. Pictures first, because most
 * renters will glance at this on a phone in a parking lot.
 */
export function PhotoGuide() {
  const blur = useId().replace(/:/g, "");
  const glare = `${blur}g`;
  return (
    <section className="pg" aria-labelledby={`${blur}-title`}>
      <h3 id={`${blur}-title`}>How to take clear photos</h3>
      <svg width="0" height="0" aria-hidden="true" style={{ position: "absolute" }}>
        <defs>
          <filter id={blur}><feGaussianBlur stdDeviation="2.2" /></filter>
          <radialGradient id={glare}>
            <stop offset="0" stopColor="#fff" stopOpacity="0.95" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        </defs>
      </svg>

      <div className="pg-grid">
        <Tile ok label="Front, all four corners">
          <Frame />
          <Card x={28} y={20} />
        </Tile>
        <Tile ok label="Back, same way">
          <Frame />
          <Card x={28} y={20} back />
        </Tile>
        <Tile ok label="Selfie holding it">
          <circle className="pg-face" cx="44" cy="34" r="14" />
          <path className="pg-face" d="M20 80c2-17 12-24 24-24s22 7 24 24z" />
          <g transform="rotate(-6 86 44)"><Card x={66} y={30} w={40} h={26} /></g>
          <rect className="pg-hand" x="70" y="53" width="12" height="14" rx="5" />
        </Tile>
        <Tile ok={false} label="Corners cut off">
          <Frame />
          <Card x={2} y={14} w={104} h={66} />
        </Tile>
        <Tile ok={false} label="Glare on the text">
          <Frame />
          <Card x={28} y={20} />
          <ellipse cx="66" cy="38" rx="26" ry="15" fill={`url(#${glare})`} />
        </Tile>
        <Tile ok={false} label="Blurry or shaky">
          <Frame />
          <g filter={`url(#${blur})`}><Card x={28} y={20} /></g>
        </Tile>
      </div>

      <ul className="pg-tips">
        <li><Icon name="check" size={14} />Lay the license flat on a dark, plain surface, like a table or a car seat.</li>
        <li><Icon name="check" size={14} />Use bright, even light. Turn the flash off and tilt the license slightly if you see a shine.</li>
        <li><Icon name="check" size={14} />Fill the frame, keep all four corners in view, and hold still until the text is sharp.</li>
        <li><Icon name="check" size={14} />For the selfie, hold the license next to your face with the photo side out. Take off hats and sunglasses.</li>
      </ul>
    </section>
  );
}
