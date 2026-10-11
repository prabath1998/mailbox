import { Mail, X } from "lucide-react";

export interface Toast {
  id: number;
  title: string;
  body: string;
  onClick?: () => void;
}

export function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="animate-toast pointer-events-auto flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-200 bg-white/95 p-3 shadow-lg shadow-zinc-900/10 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95"
          onClick={() => {
            t.onClick?.();
            dismiss(t.id);
          }}
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500">
            <Mail className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{t.title}</p>
            <p className="truncate text-xs text-zinc-500">{t.body}</p>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              dismiss(t.id);
            }}
            className="text-zinc-400 hover:text-zinc-600"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
