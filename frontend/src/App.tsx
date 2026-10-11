import { AlertTriangle, Bell, BellOff, CheckCheck, ChevronLeft, ChevronRight, Mail, MailOpen, RefreshCw, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { MessageList } from "./components/MessageList";
import { MessageView } from "./components/MessageView";
import { ThemeToggle } from "./components/ThemeToggle";
import { Toasts, type Toast } from "./components/Toasts";
import { displayName } from "./format";
import type { InboxEvent, Page } from "./types";

const PAGE_SIZE = 50;

function idFromHash(): number | null {
  const m = location.hash.match(/^#\/message\/(\d+)$/);
  return m ? Number(m[1]) : null;
}

export default function App() {
  const [page, setPage] = useState<Page>({ messages: [], total: 0, unread: 0 });
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(idFromHash);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirm, setConfirm] = useState<null | { title: string; body: string; label: string; action: () => void }>(null);
  const [notify, setNotify] = useState(() => typeof Notification !== "undefined" && Notification.permission === "granted");
  const searchRef = useRef<HTMLInputElement>(null);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const load = useCallback(async () => {
    try {
      setPage(await api.list(query, PAGE_SIZE, offset));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load messages");
    } finally {
      setLoading(false);
    }
  }, [query, offset]);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    load();
  }, [load]);

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
      setQuery(input.trim());
      setOffset(0);
    }, 250);
    return () => clearTimeout(t);
  }, [input]);

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
      const e: InboxEvent = JSON.parse(msg.data);
      clearTimeout(refetch);
      refetch = setTimeout(() => loadRef.current(), 100);
      if (e.type === "new" && e.message) {
        const m = e.message;
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

  const ids = page.messages.map((m) => m.id);
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
      body: `This permanently deletes all ${page.total} messages in the inbox.`,
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
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === "Escape") {
        if (typing) (e.target as HTMLElement).blur();
        else if (checked.size) setChecked(new Set());
        else setSelectedId(null);
        return;
      }
      if (typing || confirm || e.metaKey || e.ctrlKey || e.altKey) return;
      const i = ids.indexOf(selectedId ?? -1);
      switch (e.key) {
        case "/":
          e.preventDefault();
          searchRef.current?.focus();
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

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-zinc-200 bg-white/80 px-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm shadow-indigo-500/30">
            <Mail className="size-4" />
          </div>
          <span className="hidden font-semibold tracking-tight sm:inline">MailBox</span>
        </div>

        <div className="relative mx-auto w-full max-w-lg">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            ref={searchRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search · try from:, to:, subject:, is:unread, has:attachment"
            className="h-9 w-full rounded-lg border border-transparent bg-zinc-100 pr-10 pl-9 text-sm outline-none transition placeholder:text-zinc-400 focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 dark:bg-zinc-900 dark:focus:bg-zinc-900"
          />
          <kbd className="kbd absolute top-1/2 right-2.5 -translate-y-1/2 max-sm:hidden">/</kbd>
        </div>

        <div className="flex items-center gap-1">
          <span
            className="flex h-9 items-center gap-2 px-2 text-xs font-medium text-zinc-500"
            title={connected ? "Connected: new mail appears instantly" : "Disconnected, reconnecting…"}
          >
            <span className="relative flex size-2">
              {connected && <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />}
              <span className={`relative inline-flex size-2 rounded-full ${connected ? "bg-emerald-500" : "bg-amber-500"}`} />
            </span>
            <span className="max-sm:hidden">{connected ? "Live" : "Offline"}</span>
          </span>
          <button onClick={toggleNotify} className="icon-btn" title={notify ? "Desktop notifications on" : "Enable desktop notifications"}>
            {notify ? <Bell className="size-4" /> : <BellOff className="size-4" />}
          </button>
          <ThemeToggle />
        </div>
      </header>

      {error && (
        <div className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          <AlertTriangle className="size-4 shrink-0" />
          {error}
          <button onClick={load} className="ml-auto font-medium underline underline-offset-2">
            Retry
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside
          className={`w-full flex-col border-r border-zinc-200 bg-white md:flex md:w-80 lg:w-[26rem] dark:border-zinc-800 dark:bg-zinc-950 ${
            selectedId !== null ? "hidden" : "flex"
          }`}
        >
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-200 px-3 dark:border-zinc-800">
            <label className="flex size-8 cursor-pointer items-center justify-center" title="Select all on this page">
              <input
                type="checkbox"
                className="checkbox"
                checked={allChecked}
                ref={(el) => {
                  if (el) el.indeterminate = checked.size > 0 && !allChecked;
                }}
                onChange={() => setChecked(allChecked ? new Set() : new Set(ids))}
              />
            </label>
            {checked.size > 0 ? (
              <>
                <span className="text-sm font-medium">{checked.size} selected</span>
                <div className="ml-auto flex items-center gap-0.5">
                  <button onClick={() => run(() => api.setRead(checkedIds, true))} className="icon-btn" title="Mark read">
                    <MailOpen className="size-4" />
                  </button>
                  <button onClick={() => run(() => api.setRead(checkedIds, false))} className="icon-btn" title="Mark unread">
                    <Mail className="size-4" />
                  </button>
                  <button onClick={() => deleteIds(checkedIds)} className="icon-btn hover:text-red-500!" title="Delete">
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="text-sm font-semibold">Inbox</span>
                {page.unread > 0 && (
                  <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-xs font-medium text-indigo-600 dark:text-indigo-400">
                    {page.unread} new
                  </span>
                )}
                <div className="ml-auto flex items-center gap-0.5">
                  <button onClick={load} className="icon-btn" title="Refresh (r)">
                    <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
                  </button>
                  <button onClick={() => run(() => api.setRead([], true))} disabled={page.unread === 0} className="icon-btn disabled:opacity-30" title="Mark all read">
                    <CheckCheck className="size-4" />
                  </button>
                  <button onClick={confirmDeleteAll} disabled={page.total === 0} className="icon-btn hover:text-red-500! disabled:opacity-30" title="Delete all">
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </>
            )}
          </div>

          {loading && page.messages.length === 0 ? (
            <div className="space-y-1 p-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex gap-3 rounded-xl px-3 py-3">
                  <div className="size-9 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-1/2 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
                    <div className="h-3 w-4/5 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <MessageList
              messages={page.messages}
              selectedId={selectedId}
              checked={checked}
              query={query}
              onSelect={setSelectedId}
              onToggle={toggle}
            />
          )}

          {page.total > 0 && (
            <div className="flex h-11 shrink-0 items-center justify-between border-t border-zinc-200 px-4 text-xs text-zinc-500 dark:border-zinc-800">
              <span className="tabular-nums">
                {from}–{to} of {page.total}
              </span>
              <div className="flex gap-0.5">
                <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} className="icon-btn size-7! disabled:opacity-30">
                  <ChevronLeft className="size-4" />
                </button>
                <button disabled={to >= page.total} onClick={() => setOffset(offset + PAGE_SIZE)} className="icon-btn size-7! disabled:opacity-30">
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </div>
          )}
        </aside>

        <main className={`min-w-0 flex-1 bg-white dark:bg-zinc-950 ${selectedId !== null ? "flex" : "hidden md:flex"}`}>
          <MessageView id={selectedId} onBack={() => setSelectedId(null)} onDelete={(id) => deleteIds([id])} onMarkUnread={markUnread} />
        </main>
      </div>

      <Toasts toasts={toasts} dismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
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
