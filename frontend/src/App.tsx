import { AlertTriangle, Bell, BellOff, CheckCheck, ChevronLeft, ChevronRight, Inbox, Mail, MailOpen, RefreshCw, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Logo } from "./components/Logo";
import { MessageList } from "./components/MessageList";
import { MessageView } from "./components/MessageView";
import { ShortcutsDialog } from "./components/ShortcutsDialog";
import { ConnectCard, FOLDERS, LiveStatus, Sidebar, type Folder } from "./components/Sidebar";
import { ThemeToggle } from "./components/ThemeToggle";
import { Toasts, type Toast } from "./components/Toasts";
import { displayName } from "./format";
import type { InboxEvent, Page, TagCount } from "./types";

const PAGE_SIZE = 50;

function idFromHash(): number | null {
  const m = location.hash.match(/^#\/message\/(\d+)$/);
  return m ? Number(m[1]) : null;
}

/** Turns the server's listen address (":1025", "0.0.0.0:1025") into something you can paste into an app config. */
function smtpAddress(addr: string): string {
  const i = addr.lastIndexOf(":");
  const host = addr.slice(0, i).replace(/^\[|\]$/g, "");
  const shown = !host || host === "0.0.0.0" || host === "::" ? location.hostname || "localhost" : host;
  return `${shown}:${addr.slice(i + 1)}`;
}

export default function App() {
  const [page, setPage] = useState<Page>({ messages: [], total: 0, unread: 0 });
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [smtp, setSmtp] = useState<string | null>(null);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [folder, setFolder] = useState<Folder>("all");
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(idFromHash);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirm, setConfirm] = useState<null | { title: string; body: string; label: string; action: () => void }>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [notify, setNotify] = useState(() => typeof Notification !== "undefined" && Notification.permission === "granted");
  const searchRef = useRef<HTMLInputElement>(null);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const query = [FOLDERS.find((f) => f.id === folder)!.query, search].filter(Boolean).join(" ");

  const load = useCallback(async () => {
    try {
      const [list, tagList] = await Promise.all([api.list(query, PAGE_SIZE, offset), api.tags()]);
      setPage(list);
      setTags(tagList);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load messages");
    } finally {
      setLoading(false);
    }
  }, [query, offset]);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api
      .info()
      .then((i) => setSmtp(smtpAddress(i.smtpAddr)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    document.title = page.unread > 0 ? `(${page.unread}) MailBox` : "MailBox";
  }, [page.unread]);

  // Keep the open message in the URL so it can be linked and the back button works.
  useEffect(() => {
    const hash = selectedId === null ? "" : `#/message/${selectedId}`;
    if (location.hash !== hash) history.pushState(null, "", hash || location.pathname);
  }, [selectedId]);

  useEffect(() => {
    const onPop = () => setSelectedId(idFromHash());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Debounce typing into the search box.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(input.trim());
      setOffset(0);
    }, 250);
    return () => clearTimeout(t);
  }, [input]);

  const changeFolder = (f: Folder) => {
    setFolder(f);
    setOffset(0);
    setChecked(new Set());
  };

  // Tags filter through the search box, so the filter stays visible and editable.
  const showTag = (tag: string) => {
    setFolder("all");
    setInput(`tag:${tag}`);
    setChecked(new Set());
  };

  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 6000);
  }, []);

  // Live updates over Server-Sent Events. EventSource reconnects on its own.
  useEffect(() => {
    const es = new EventSource("/api/events");
    let refetch: ReturnType<typeof setTimeout>;
    es.onopen = () => {
      setConnected(true);
      loadRef.current();
    };
    es.onerror = () => setConnected(false);
    es.onmessage = (msg) => {
      let e: InboxEvent;
      try {
        e = JSON.parse(msg.data);
      } catch {
        return;
      }
      clearTimeout(refetch);
      refetch = setTimeout(() => loadRef.current(), 100);
      if (e.type === "new" && e.message) {
        const m = e.message;
        setFresh((prev) => new Set(prev).add(m.id));
        setTimeout(
          () =>
            setFresh((prev) => {
              const next = new Set(prev);
              next.delete(m.id);
              return next;
            }),
          1800,
        );
        toast({ title: displayName(m.from), body: m.subject || "(no subject)", onClick: () => setSelectedId(m.id) });
        if (notifyRef.current && document.hidden) {
          const n = new Notification(displayName(m.from), { body: m.subject || "(no subject)", tag: String(m.id) });
          n.onclick = () => {
            window.focus();
            setSelectedId(m.id);
          };
        }
      }
      if (e.type === "deleted") {
        const gone = (id: number) => !e.ids?.length || e.ids.includes(id);
        setSelectedId((id) => (id !== null && gone(id) ? null : id));
        setChecked((prev) => new Set([...prev].filter((id) => !gone(id))));
      }
    };
    return () => {
      clearTimeout(refetch);
      es.close();
    };
  }, [toast]);

  const ids = useMemo(() => page.messages.map((m) => m.id), [page.messages]);
  const allChecked = ids.length > 0 && ids.every((id) => checked.has(id));
  const checkedIds = [...checked];

  const toggle = (id: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    }
  };

  const deleteIds = useCallback(
    (list: number[]) =>
      run(async () => {
        if (selectedId !== null && list.includes(selectedId)) {
          // Move to the next message so you can triage quickly.
          const i = ids.indexOf(selectedId);
          const next = ids.filter((id) => !list.includes(id))[Math.min(i, ids.length - list.length - 1)];
          setSelectedId(next ?? null);
        }
        await api.remove(list);
        setChecked(new Set());
      }),
    [ids, selectedId],
  );

  const markUnread = useCallback(
    (id: number) =>
      run(async () => {
        await api.setRead([id], false);
        setSelectedId(null);
      }),
    [],
  );

  const confirmDeleteAll = () =>
    setConfirm({
      title: "Delete all messages?",
      body: "This permanently deletes every message in MailBox. You can't undo this.",
      label: "Delete all",
      action: () => run(() => api.removeAll()),
    });

  const toggleNotify = async () => {
    if (notify) return setNotify(false);
    if (typeof Notification === "undefined") return;
    setNotify((await Notification.requestPermission()) === "granted");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (confirm || showShortcuts) return;
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === "Escape") {
        if (typing) (e.target as HTMLElement).blur();
        else if (checked.size) setChecked(new Set());
        else setSelectedId(null);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const i = ids.indexOf(selectedId ?? -1);
      switch (e.key) {
        case "/":
          e.preventDefault();
          searchRef.current?.focus();
          break;
        case "?":
          setShowShortcuts(true);
          break;
        case "j":
        case "ArrowDown":
          e.preventDefault();
          if (ids.length) setSelectedId(ids[Math.min(ids.length - 1, i + 1)]);
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          if (ids.length) setSelectedId(ids[Math.max(0, i - 1)]);
          break;
        case "x":
          if (selectedId !== null) toggle(selectedId);
          break;
        case "e":
        case "Delete":
          if (checked.size) deleteIds(checkedIds);
          else if (selectedId !== null) deleteIds([selectedId]);
          break;
        case "u":
          if (selectedId !== null) markUnread(selectedId);
          break;
        case "r":
          load();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const from = page.total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE_SIZE, page.total);
  const folderLabel = FOLDERS.find((f) => f.id === folder)!.label;
  const inboxEmpty = !loading && page.total === 0 && folder === "all" && !search;

  return (
    <div className="flex h-full flex-col">
      <div aria-hidden className="airmail h-0.75 shrink-0" />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          folder={folder}
          onFolder={changeFolder}
          unread={page.unread}
          connected={connected}
          smtp={smtp}
          notify={notify}
          onToggleNotify={toggleNotify}
          onShortcuts={() => setShowShortcuts(true)}
          tags={tags}
          activeTag={search.match(/^tag:(\S+)$/)?.[1] ?? null}
          onTag={showTag}
        />

        <section
          aria-label={folderLabel}
          className={`w-full shrink-0 flex-col border-r border-line bg-surface md:flex md:w-88 xl:w-100 ${selectedId !== null ? "hidden" : "flex"}`}
        >
          <div className="flex h-14 shrink-0 items-center gap-2 px-3 lg:hidden">
            <Logo className="size-7" />
            <span className="font-semibold tracking-tight">MailBox</span>
            <LiveStatus connected={connected} className="ml-1" />
            <div className="ml-auto flex items-center gap-1">
              <button onClick={toggleNotify} className="icon-btn" aria-pressed={notify} aria-label={notify ? "Turn off desktop notifications" : "Turn on desktop notifications"}>
                {notify ? <Bell className="size-4" /> : <BellOff className="size-4" />}
              </button>
              <ThemeToggle />
            </div>
          </div>

          <div className="shrink-0 px-3 pt-0 pb-2 lg:pt-3">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
              <input
                ref={searchRef}
                type="search"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Search mail"
                aria-label="Search mail. Filters: from:, to:, subject:, tag:, is:unread, has:attachment"
                title="Filters: from:, to:, subject:, tag:, is:unread, is:read, has:attachment"
                className="h-9 w-full rounded-lg border border-line bg-paper pr-9 pl-9 text-[13px] outline-none transition placeholder:text-faint focus:border-accent focus:bg-surface focus:ring-3 focus:ring-accent/15 [&::-webkit-search-cancel-button]:hidden"
              />
              {input ? (
                <button onClick={() => setInput("")} className="icon-btn absolute top-1/2 right-1 size-7 -translate-y-1/2" aria-label="Clear search">
                  <X className="size-3.5" />
                </button>
              ) : (
                <kbd className="kbd absolute top-1/2 right-2.5 -translate-y-1/2 max-sm:hidden">/</kbd>
              )}
            </div>
            <div role="tablist" aria-label="Mailboxes" className="mt-2 flex gap-1 lg:hidden">
              {FOLDERS.map((f) => (
                <button
                  key={f.id}
                  role="tab"
                  aria-selected={folder === f.id}
                  onClick={() => changeFolder(f.id)}
                  className={`h-7 rounded-md px-2.5 text-xs font-medium transition-colors ${
                    folder === f.id ? "bg-ink text-surface" : "text-muted hover:bg-sunken hover:text-ink"
                  }`}
                >
                  {f.label}
                  {f.id === "unread" && page.unread > 0 && <span className="ml-1 tabular-nums opacity-70">{page.unread}</span>}
                </button>
              ))}
            </div>
          </div>

          <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-3">
            <label className="flex size-8 cursor-pointer items-center justify-center">
              <input
                type="checkbox"
                className="checkbox"
                aria-label="Select all on this page"
                checked={allChecked}
                disabled={ids.length === 0}
                ref={(el) => {
                  if (el) el.indeterminate = checked.size > 0 && !allChecked;
                }}
                onChange={() => setChecked(allChecked ? new Set() : new Set(ids))}
              />
            </label>
            {checked.size > 0 ? (
              <>
                <span className="text-[13px] font-medium">{checked.size} selected</span>
                <div className="ml-auto flex items-center">
                  <button onClick={() => run(() => api.setRead(checkedIds, true))} className="icon-btn" aria-label="Mark selected read" title="Mark read">
                    <MailOpen className="size-4" />
                  </button>
                  <button onClick={() => run(() => api.setRead(checkedIds, false))} className="icon-btn" aria-label="Mark selected unread" title="Mark unread">
                    <Mail className="size-4" />
                  </button>
                  <button onClick={() => deleteIds(checkedIds)} className="icon-btn hover:bg-postal-soft! hover:text-postal!" aria-label="Delete selected" title="Delete">
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-[13px] font-semibold">{search ? "Results" : folderLabel}</h2>
                {page.total > 0 && <span className="text-xs text-faint tabular-nums">{page.total}</span>}
                <div className="ml-auto flex items-center">
                  <button onClick={load} className="icon-btn" aria-label="Refresh" title="Refresh (r)">
                    <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
                  </button>
                  <button onClick={() => run(() => api.setRead([], true))} disabled={page.unread === 0} className="icon-btn" aria-label="Mark all read" title="Mark all read">
                    <CheckCheck className="size-4" />
                  </button>
                  <button
                    onClick={confirmDeleteAll}
                    disabled={page.total === 0}
                    className="icon-btn hover:bg-postal-soft! hover:text-postal!"
                    aria-label="Delete all messages"
                    title="Delete all"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </>
            )}
          </div>

          {error && (
            <div role="alert" className="flex items-center gap-2 border-b border-line bg-postal-soft px-4 py-2 text-[13px] text-postal">
              <AlertTriangle className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{error}</span>
              <button onClick={load} className="font-semibold underline underline-offset-2">
                Retry
              </button>
            </div>
          )}

          {loading && page.messages.length === 0 ? (
            <ListSkeleton />
          ) : page.messages.length === 0 ? (
            <EmptyList folder={folder} search={search} onClear={() => setInput("")} />
          ) : (
            <MessageList
              messages={page.messages}
              selectedId={selectedId}
              checked={checked}
              fresh={fresh}
              onSelect={setSelectedId}
              onToggle={toggle}
              onTag={showTag}
            />
          )}

          {page.total > PAGE_SIZE && (
            <div className="flex h-11 shrink-0 items-center justify-between border-t border-line px-4 text-xs text-muted">
              <span className="tabular-nums">
                {from}–{to} of {page.total}
              </span>
              <div className="flex gap-0.5">
                <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} className="icon-btn size-7" aria-label="Previous page">
                  <ChevronLeft className="size-4" />
                </button>
                <button disabled={to >= page.total} onClick={() => setOffset(offset + PAGE_SIZE)} className="icon-btn size-7" aria-label="Next page">
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </div>
          )}
        </section>

        <main className={`min-w-0 flex-1 bg-surface ${selectedId !== null ? "flex" : "hidden md:flex"}`}>
          {selectedId === null ? (
            <ReaderEmpty inboxEmpty={inboxEmpty} smtp={smtp} />
          ) : (
            <ErrorBoundary
              key={selectedId}
              fallback={(reset) => (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
                  <p className="font-medium">This message couldn't be displayed</p>
                  <button onClick={reset} className="btn-outline mt-2">
                    Try again
                  </button>
                </div>
              )}
            >
              <MessageView
                id={selectedId}
                onBack={() => setSelectedId(null)}
                onDelete={(id) => deleteIds([id])}
                onMarkUnread={markUnread}
                onTag={showTag}
              />
            </ErrorBoundary>
          )}
        </main>
      </div>

      <Toasts toasts={toasts} dismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
      {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          body={confirm.body}
          confirmLabel={confirm.label}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            confirm.action();
            setConfirm(null);
          }}
        />
      )}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div aria-busy aria-label="Loading messages">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="flex gap-3 border-b border-line px-4 py-3.5">
          <div className="size-8 animate-pulse rounded-full bg-sunken" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-2/5 animate-pulse rounded bg-sunken" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-sunken" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyList({ folder, search, onClear }: { folder: Folder; search: string; onClear: () => void }) {
  const text = search
    ? { title: "No matches", body: `Nothing matches "${search}".` }
    : folder === "unread"
      ? { title: "You're all caught up", body: "There's no unread mail." }
      : folder === "attachments"
        ? { title: "No attachments", body: "Messages with files attached will be listed here." }
        : { title: "No mail yet", body: "Messages your app sends will land here the moment they arrive." };
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <div className="mb-1 flex size-11 items-center justify-center rounded-xl bg-sunken text-faint">
        <Inbox className="size-5" />
      </div>
      <p className="font-semibold">{text.title}</p>
      <p className="max-w-60 text-[13px] text-muted">{text.body}</p>
      {search && (
        <button onClick={onClear} className="btn-outline mt-2">
          Clear search
        </button>
      )}
    </div>
  );
}

function ReaderEmpty({ inboxEmpty, smtp }: { inboxEmpty: boolean; smtp: string | null }) {
  if (inboxEmpty) {
    const [host, port] = smtp ? [smtp.slice(0, smtp.lastIndexOf(":")), smtp.slice(smtp.lastIndexOf(":") + 1)] : ["localhost", "1025"];
    return (
      <div className="flex flex-1 items-center justify-center overflow-y-auto bg-paper p-8">
        <div className="w-full max-w-md">
          <div className="airmail rounded-2xl p-1.5 shadow-pop">
            <div className="rounded-[11px] bg-surface p-6">
              <Logo className="size-10" />
              <h1 className="mt-5 text-xl font-semibold tracking-tight">Waiting for your first email</h1>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
                Point your app's SMTP settings at MailBox. Every message it sends is caught here instead of being delivered.
              </p>
              {smtp && (
                <div className="mt-5">
                  <ConnectCard smtp={smtp} />
                </div>
              )}
              <p className="mt-5 mb-1.5 text-xs font-medium text-muted">Send a test message</p>
              <pre className="overflow-x-auto rounded-lg bg-sunken px-3 py-2.5 font-mono text-xs leading-relaxed text-ink-2">
                swaks --to dev@example.com \{"\n"}  --server {host} --port {port}
              </pre>
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-paper text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl border border-line bg-surface text-faint">
        <Mail className="size-5" />
      </div>
      <p className="text-[13px] font-medium text-ink-2">Select a message to read it</p>
      <p className="flex items-center gap-1.5 text-xs text-faint">
        <kbd className="kbd">j</kbd>
        <kbd className="kbd">k</kbd> to move, <kbd className="kbd">?</kbd> for all shortcuts
      </p>
    </div>
  );
}
