import { useEffect, useRef, useState } from "react";
import { useAccount } from "../lib/account.tsx";
import { Icon } from "./Icon.tsx";

/**
 * A payment screenshot. It's private, so it's fetched with the user's token rather than loaded
 * by an <img src> the browser could share. Tap to see it full size.
 */
export function ProofImage({ url, alt }: { url: string; alt: string }) {
  const { api } = useAccount();
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    api.proofImage(url, controller.signal).then(
      (u) => {
        objectUrl = u;
        setSrc(u);
      },
      (err: Error) => err.name !== "AbortError" && setFailed(true),
    );
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [api, url]);

  if (failed) return <div className="proof missing"><Icon name="alert" size={16} />Couldn't load</div>;
  if (!src) return <div className="proof skeleton" aria-busy="true" />;
  return (
    <>
      <button type="button" className="proof" onClick={() => dialog.current?.showModal()} aria-label={`${alt}. Open full size`}>
        <img src={src} alt={alt} />
      </button>
      <dialog ref={dialog} className="lightbox" onClick={(e) => e.target === dialog.current && dialog.current?.close()}>
        <img src={src} alt={alt} />
        <button type="button" className="btn btn-ghost lightbox-close" onClick={() => dialog.current?.close()}>
          <Icon name="x" size={16} />Close
        </button>
      </dialog>
    </>
  );
}
