import { useEffect, useRef, useState } from "react";
import type { Photo } from "../../shared/types.ts";
import { Icon } from "./Icon.tsx";

/** Swipeable on touch, arrow-key and button driven elsewhere. Each photo keeps its alt text. */
export function Gallery({ photos }: { photos: Photo[] }) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const count = photos.length;

  const goTo = (i: number) => {
    const next = (i + count) % count;
    const el = track.current;
    if (el) {
      const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollTo({ left: next * el.clientWidth, behavior: smooth ? "smooth" : "auto" });
    }
    setIndex(next);
  };

  // Keep the counter in sync when the renter swipes.
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth))), 60);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      clearTimeout(timer);
      el.removeEventListener("scroll", onScroll);
    };
  }, []);

  if (!count) return null;
  return (
    <div className="gallery">
      <div className="gmain">
        <div
          className="gtrack"
          ref={track}
          tabIndex={0}
          role="region"
          aria-roledescription="carousel"
          aria-label={`Photo gallery, ${count} photos. Use the arrow keys to browse.`}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") { e.preventDefault(); goTo(index + 1); }
            if (e.key === "ArrowLeft") { e.preventDefault(); goTo(index - 1); }
          }}
        >
          {photos.map((p, i) => (
            <img key={p.src} src={p.src} alt={p.alt} decoding="async" loading={i === 0 ? "eager" : "lazy"} />
          ))}
        </div>
        {count > 1 && (
          <>
            <button className="gnav prev" onClick={() => goTo(index - 1)} aria-label="Previous photo"><Icon name="chevronLeft" size={20} /></button>
            <button className="gnav next" onClick={() => goTo(index + 1)} aria-label="Next photo"><Icon name="chevronRight" size={20} /></button>
            <span className="gidx" aria-live="polite">{index + 1} / {count}</span>
          </>
        )}
      </div>
      {count > 1 && (
        <div className="gthumbs">
          {photos.map((p, i) => (
            <button key={p.src} onClick={() => goTo(i)} aria-label={`Show photo ${i + 1}`} aria-current={i === index}>
              <img src={p.src} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
