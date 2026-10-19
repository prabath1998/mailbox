import type { CSSProperties } from "react";
import { avatarHue, initials } from "../format";

export function Avatar({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  const dims = size === "lg" ? "size-10 text-[13px]" : "size-8 text-[11px]";
  return (
    <div
      aria-hidden
      style={{ "--h": avatarHue(name) } as CSSProperties}
      className={`${dims} flex shrink-0 items-center justify-center rounded-full bg-[hsl(var(--h)_75%_93%)] font-semibold tracking-wide text-[hsl(var(--h)_55%_34%)] dark:bg-[hsl(var(--h)_35%_22%)] dark:text-[hsl(var(--h)_80%_82%)]`}
    >
      {initials(name)}
    </div>
  );
}
