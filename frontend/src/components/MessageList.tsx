import { Inbox, Paperclip } from "lucide-react";
import { useEffect, useRef } from "react";
import { displayName, formatListDate } from "../format";
import type { Summary } from "../types";
import { Avatar } from "./Avatar";

interface Props {
  messages: Summary[];
  selectedId: number | null;
  checked: Set<number>;
  query: string;
  onSelect: (id: number) => void;
  onToggle: (id: number) => void;
}

export function MessageList({ messages, selectedId, checked, query, onSelect, onToggle }: Props) {
  const selectedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-500">
          <Inbox className="size-7" />
        </div>
        <p className="font-medium">{query ? "No matches" : "Inbox is empty"}</p>
        <p className="max-w-64 text-sm text-zinc-500">
          {query ? `Nothing matches "${query}".` : "Point your app's SMTP at localhost:1025 and mail will show up here instantly."}
        </p>
      </div>
    );
  }

  return (
    <ul className="flex-1 overflow-y-auto p-2">
      {messages.map((m) => {
        const active = m.id === selectedId;
        const isChecked = checked.has(m.id);
        const name = displayName(m.from);
        return (
          <li key={m.id}>
            <div
              ref={active ? selectedRef : undefined}
              role="button"
              tabIndex={-1}
              onClick={() => onSelect(m.id)}
              className={`group relative flex w-full cursor-pointer gap-3 rounded-xl px-3 py-3 text-left transition-colors ${
                active
                  ? "bg-indigo-50 ring-1 ring-indigo-200 dark:bg-indigo-500/10 dark:ring-indigo-500/30"
                  : isChecked
                    ? "bg-zinc-100 dark:bg-zinc-800/60"
                    : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
              }`}
            >
              {!m.read && <span className="absolute top-1/2 left-0.5 size-1.5 -translate-y-1/2 rounded-full bg-indigo-500" />}
              <div className="relative size-9 shrink-0" onClick={(e) => e.stopPropagation()}>
                <div className={`transition-opacity ${isChecked ? "opacity-0" : "group-hover:opacity-0"}`}>
                  <Avatar name={name} />
                </div>
                <label
                  className={`absolute inset-0 flex cursor-pointer items-center justify-center transition-opacity ${
                    isChecked ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  }`}
                >
                  <input type="checkbox" className="checkbox" checked={isChecked} onChange={() => onToggle(m.id)} />
                </label>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`truncate text-sm ${m.read ? "font-medium text-zinc-600 dark:text-zinc-300" : "font-semibold"}`}>
                    {name}
                  </span>
                  <span className="shrink-0 text-xs text-zinc-400">{formatListDate(m.received)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`truncate text-sm ${m.read ? "text-zinc-600 dark:text-zinc-400" : "font-medium"}`}>
                    {m.subject || "(no subject)"}
                  </span>
                  {m.attachments > 0 && <Paperclip className="size-3.5 shrink-0 text-zinc-400" aria-label="Has attachments" />}
                </div>
                <p className="mt-0.5 truncate text-xs text-zinc-500">{m.snippet || "No content"}</p>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
