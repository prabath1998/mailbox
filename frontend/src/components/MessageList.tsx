import { Paperclip } from "lucide-react";
import { useEffect, useRef } from "react";
import { displayName, formatListDate } from "../format";
import type { Summary } from "../types";
import { Avatar } from "./Avatar";

interface Props {
  messages: Summary[];
  selectedId: number | null;
  checked: Set<number>;
  fresh: Set<number>;
  onSelect: (id: number) => void;
  onToggle: (id: number) => void;
}

export function MessageList({ messages, selectedId, checked, fresh, onSelect, onToggle }: Props) {
  const selectedRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  return (
    <ul role="listbox" aria-label="Messages" className="flex-1 overflow-y-auto">
      {messages.map((m) => {
        const active = m.id === selectedId;
        const isChecked = checked.has(m.id);
        const name = displayName(m.from);
        return (
          <li
            key={m.id}
            ref={active ? selectedRef : undefined}
            role="option"
            aria-selected={active}
            onClick={() => onSelect(m.id)}
            className={`group relative flex cursor-pointer gap-3 border-b border-line px-4 py-3 transition-colors ${
              fresh.has(m.id) ? "animate-arrive" : ""
            } ${active ? "bg-accent-soft" : isChecked ? "bg-sunken" : "hover:bg-sunken/70"}`}
          >
            {active && <span aria-hidden className="absolute inset-y-0 left-0 w-0.75 bg-accent" />}
            <div className="relative mt-0.5 size-8 shrink-0" onClick={(e) => e.stopPropagation()}>
              <div className={`transition-opacity ${isChecked ? "opacity-0" : "group-hover:opacity-0"}`}>
                <Avatar name={name} />
              </div>
              <label
                className={`absolute inset-0 flex cursor-pointer items-center justify-center transition-opacity ${
                  isChecked ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"
                }`}
              >
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={isChecked}
                  onChange={() => onToggle(m.id)}
                  aria-label={`Select message from ${name}`}
                />
              </label>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {!m.read && <span className="size-2 shrink-0 rounded-full bg-postal" aria-label="Unread" />}
                <span className={`truncate text-[13px] ${m.read ? "text-ink-2" : "font-semibold text-ink"}`}>{name}</span>
                <time
                  dateTime={m.received}
                  className={`ml-auto shrink-0 text-xs tabular-nums ${m.read ? "text-faint" : "font-medium text-ink-2"}`}
                >
                  {formatListDate(m.received)}
                </time>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className={`truncate text-[13px] ${m.read ? "text-muted" : "font-medium text-ink"}`}>{m.subject || "(no subject)"}</span>
                {m.attachments > 0 && <Paperclip className="size-3.5 shrink-0 text-faint" aria-label="Has attachments" />}
              </div>
              <p className="mt-0.5 line-clamp-1 text-xs text-faint">{m.snippet || "No text content"}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
