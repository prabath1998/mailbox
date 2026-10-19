import { Bell, BellOff, Check, Copy, Inbox, Keyboard, Mail, Paperclip, type LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { useState } from "react";
import { tagHue } from "../format";
import type { TagCount } from "../types";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

export type Folder = "all" | "unread" | "attachments";

export const FOLDERS: { id: Folder; label: string; query: string; icon: LucideIcon }[] = [
  { id: "all", label: "All mail", query: "", icon: Inbox },
  { id: "unread", label: "Unread", query: "is:unread", icon: Mail },
  { id: "attachments", label: "Attachments", query: "has:attachment", icon: Paperclip },
];

interface Props {
  folder: Folder;
  onFolder: (f: Folder) => void;
  unread: number;
  connected: boolean;
  smtp: string | null;
  notify: boolean;
  onToggleNotify: () => void;
  onShortcuts: () => void;
  tags: TagCount[];
  activeTag: string | null;
  onTag: (tag: string) => void;
}

export function Sidebar({ folder, onFolder, unread, connected, smtp, notify, onToggleNotify, onShortcuts, tags, activeTag, onTag }: Props) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-paper lg:flex">
      <div className="flex h-14 items-center gap-2.5 px-4">
        <Logo />
        <span className="text-[15px] font-semibold tracking-tight">MailBox</span>
        <LiveStatus connected={connected} className="ml-auto" />
      </div>

      <nav aria-label="Mailboxes" className="mt-2 space-y-0.5 px-2">
        {FOLDERS.map(({ id, label, icon: Icon }) => {
          const active = folder === id && !activeTag;
          return (
            <button
              key={id}
              onClick={() => onFolder(id)}
              aria-current={active ? "page" : undefined}
              className={`flex h-9 w-full items-center gap-3 rounded-lg px-2.5 text-[13px] font-medium transition-colors ${
                active ? "bg-surface text-ink shadow-[0_0_0_1px_var(--line)]" : "text-muted hover:bg-sunken hover:text-ink"
              }`}
            >
              <Icon className={`size-4 ${active ? "text-accent" : ""}`} />
              {label}
              {id !== "attachments" && unread > 0 && (
                <span className={`ml-auto text-xs tabular-nums ${id === "unread" ? "font-semibold text-postal" : "text-faint"}`}>{unread}</span>
              )}
            </button>
          );
        })}
      </nav>

      {tags.length > 0 && (
        <nav aria-label="Tags" className="mt-6 min-h-0 overflow-y-auto px-2">
          <h2 className="mb-1 px-2.5 text-xs font-medium text-faint">Tags</h2>
          {tags.map((t) => {
            const active = activeTag === t.name;
            return (
              <button
                key={t.name}
                onClick={() => onTag(t.name)}
                aria-current={active ? "page" : undefined}
                style={{ "--h": tagHue(t.name) } as CSSProperties}
                className={`flex h-8 w-full items-center gap-3 rounded-lg px-2.5 text-[13px] transition-colors ${
                  active ? "bg-surface font-medium text-ink shadow-[0_0_0_1px_var(--line)]" : "text-muted hover:bg-sunken hover:text-ink"
                }`}
              >
                <span aria-hidden className="flex size-4 items-center justify-center">
                  <span className="size-2 rounded-full bg-[hsl(var(--h)_65%_55%)]" />
                </span>
                <span className="truncate">{t.name}</span>
                <span className="ml-auto text-xs text-faint tabular-nums">{t.count}</span>
              </button>
            );
          })}
        </nav>
      )}

      <div className="mt-auto space-y-3 p-3">
        {smtp && <ConnectCard smtp={smtp} />}
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <button
            onClick={onToggleNotify}
            className="icon-btn ml-auto"
            aria-pressed={notify}
            aria-label={notify ? "Turn off desktop notifications" : "Turn on desktop notifications"}
            title={notify ? "Desktop notifications on" : "Desktop notifications off"}
          >
            {notify ? <Bell className="size-4" /> : <BellOff className="size-4" />}
          </button>
          <button onClick={onShortcuts} className="icon-btn" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
            <Keyboard className="size-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}

export function LiveStatus({ connected, className = "" }: { connected: boolean; className?: string }) {
  return (
    <span
      className={`flex items-center gap-1.5 text-xs font-medium ${connected ? "text-ok" : "text-warn"} ${className}`}
      title={connected ? "Connected. New mail appears instantly." : "Connection lost. Reconnecting…"}
    >
      <span className="relative flex size-1.5">
        {connected && <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" />}
        <span className="relative inline-flex size-1.5 rounded-full bg-current" />
      </span>
      {connected ? "Live" : "Offline"}
    </span>
  );
}

export function ConnectCard({ smtp }: { smtp: string }) {
  const [copied, setCopied] = useState(false);
  const [host, port] = [smtp.slice(0, smtp.lastIndexOf(":")), smtp.slice(smtp.lastIndexOf(":") + 1)];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(smtp);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  return (
    <div className="panel p-3">
      <p className="text-xs font-medium text-muted">SMTP server</p>
      <button
        onClick={copy}
        className="group mt-1.5 flex w-full items-center justify-between rounded-md bg-sunken px-2 py-1.5 font-mono text-[13px]"
        title="Copy address"
      >
        <span className="truncate">
          {host}
          <span className="text-faint">:</span>
          <span className="text-accent-ink">{port}</span>
        </span>
        {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5 text-faint group-hover:text-ink" />}
      </button>
      <p className="mt-2 text-xs leading-relaxed text-muted">Any username and password work. No TLS.</p>
    </div>
  );
}
