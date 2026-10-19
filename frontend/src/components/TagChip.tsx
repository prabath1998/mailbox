import type { CSSProperties } from "react";
import { tagHue } from "../format";

/** A tag label with a stable colour dot; clicking it filters the inbox by that tag. */
export function TagChip({ tag, onClick }: { tag: string; onClick?: (tag: string) => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(tag);
      }}
      title={`Show messages tagged ${tag}`}
      aria-label={`Show messages tagged ${tag}`}
      style={{ "--h": tagHue(tag) } as CSSProperties}
      className="inline-flex h-5 max-w-32 shrink-0 items-center gap-1 rounded-md border border-line bg-surface px-1.5 text-[11px] font-medium text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[hsl(var(--h)_65%_55%)]" />
      <span className="truncate">{tag}</span>
    </button>
  );
}
