import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon.tsx";

/** A titled card in the main column of a trip or host page. */
export function Panel({ icon, title, children, tone, aside }: { icon: IconName; title: string; children: ReactNode; tone?: "ok" | "warn"; aside?: ReactNode }) {
  return (
    <section className={`panel${tone ? ` ${tone}` : ""}`}>
      <h2><Icon name={icon} size={18} />{title}{aside && <span className="panel-aside">{aside}</span>}</h2>
      {children}
    </section>
  );
}
