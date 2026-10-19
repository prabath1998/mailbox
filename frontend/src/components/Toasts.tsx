import { X } from "lucide-react";
import { Avatar } from "./Avatar";

export interface Toast {
  id: number;
  title: string;
  body: string;
  onClick?: () => void;
}

export function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 z-40 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="animate-pop pointer-events-auto relative flex items-center gap-3 overflow-hidden rounded-xl border border-line bg-raised p-3 pl-4 shadow-pop"
        >
          <span aria-hidden className="airmail absolute inset-y-0 left-0 w-1" />
          <button
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
            onClick={() => {
              t.onClick?.();
              dismiss(t.id);
            }}
          >
            <Avatar name={t.title} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold">{t.title}</span>
              <span className="block truncate text-xs text-muted">{t.body}</span>
            </span>
          </button>
          <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="icon-btn size-7">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
