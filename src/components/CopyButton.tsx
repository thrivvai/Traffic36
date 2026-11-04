import { useEffect, useState } from "react";
import { Icon } from "./Icon.tsx";

/** Copies a value and says so for two seconds. Falls back to selecting the text if the clipboard is blocked. */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      className="copy"
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      onClick={() => navigator.clipboard?.writeText(value).then(() => setCopied(true), () => window.prompt(`Copy ${label}`, value))}
    >
      <Icon name={copied ? "check" : "copy"} size={15} />
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}
