import { AlertTriangle, ArrowLeft, Check, Copy, Download, FileText, MailOpen, Monitor, Smartphone, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { displayName, formatAddress, formatBytes, formatFullDate } from "../format";
import { checkHtml } from "../htmlcheck";
import type { Address, Message, SpamReport } from "../types";
import { Avatar } from "./Avatar";
import { HtmlCheckPanel, LinkCheckPanel, SpamPanel, scoreTone } from "./CheckPanels";
import { HtmlPreview } from "./HtmlPreview";

type Tab = "html" | "text" | "headers" | "raw" | "compat" | "links" | "spam";

interface Props {
  id: number;
  onBack: () => void;
  onDelete: (id: number) => void;
  onMarkUnread: (id: number) => void;
}

export function MessageView({ id, onBack, onDelete, onMarkUnread }: Props) {
  const [message, setMessage] = useState<Message | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("html");
  const [width, setWidth] = useState<"desktop" | "mobile">("desktop");
  const [spam, setSpam] = useState<SpamReport | null>(null);
  const [raw, setRaw] = useState<string | null>(null);
  const [rawError, setRawError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMessage(null);
    setSpam(null);
    setRaw(null);
    setRawError(null);
    setError(null);
    api
      .get(id)
      .then((m) => {
        if (cancelled) return;
        setMessage(m);
        setTab((t) => (t === "html" || t === "text" ? (m.html ? "html" : "text") : t));
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Could not load this message"));
    api.spam(id).then((r) => !cancelled && setSpam(r)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (tab !== "raw" || raw !== null) return;
    let cancelled = false;
    fetch(api.rawUrl(id))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`Server responded with ${r.status}`))))
      .then((t) => !cancelled && setRaw(t))
      .catch((e) => !cancelled && setRawError(e.message));
    return () => {
      cancelled = true;
    };
  }, [tab, raw, id]);

  const compat = useMemo(() => (message?.html ? checkHtml(message.html) : null), [message?.html]);

  const toolbar = (
    <div className="flex h-14 shrink-0 items-center gap-1 border-b border-line px-3 sm:px-6">
      <button onClick={onBack} className="icon-btn -ml-1 md:hidden" aria-label="Back to inbox">
        <ArrowLeft className="size-4" />
      </button>
      {message && (
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => onMarkUnread(message.id)} className="btn-ghost" title="Mark unread (u)">
            <MailOpen className="size-4" />
            <span className="max-sm:hidden">Mark unread</span>
          </button>
          <a href={api.rawUrl(message.id, true)} className="btn-ghost" title="Download as .eml">
            <Download className="size-4" />
            <span className="max-sm:hidden">.eml</span>
          </a>
          <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          <button onClick={() => onDelete(message.id)} className="icon-btn hover:bg-postal-soft! hover:text-postal!" aria-label="Delete" title="Delete (e)">
            <Trash2 className="size-4" />
          </button>
        </div>
      )}
    </div>
  );

  if (error)
    return (
      <article className="flex min-w-0 flex-1 flex-col">
        {toolbar}
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <AlertTriangle className="size-5 text-postal" />
          <p className="font-medium">Couldn't open this message</p>
          <p className="text-[13px] text-muted">{error}</p>
        </div>
      </article>
    );

  if (!message)
    return (
      <article className="flex min-w-0 flex-1 flex-col" aria-busy>
        {toolbar}
        <div className="space-y-4 px-6 py-6 sm:px-10">
          <div className="h-6 w-2/3 animate-pulse rounded-md bg-sunken" />
          <div className="flex gap-3">
            <div className="size-10 animate-pulse rounded-full bg-sunken" />
            <div className="flex-1 space-y-2 pt-1">
              <div className="h-3 w-1/3 animate-pulse rounded bg-sunken" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-sunken" />
            </div>
          </div>
        </div>
      </article>
    );

  const files = message.attachmentParts.filter((a) => !a.inline || !message.html.includes(`/attachments/${a.id}`));
  const views: TabDef[] = [
    { id: "html", label: "Preview", disabled: !message.html },
    { id: "text", label: "Plain text", disabled: !message.text },
    { id: "headers", label: "Headers" },
    { id: "raw", label: "Source" },
  ];
  const checks: TabDef[] = [
    {
      id: "compat",
      label: "Compatibility",
      disabled: !compat,
      badge: compat ? { text: `${compat.score}%`, tone: scoreTone(compat.score >= 90, compat.score >= 70) } : undefined,
    },
    { id: "links", label: "Links" },
    {
      id: "spam",
      label: "Spam",
      badge: spam ? { text: spam.score.toFixed(1), tone: scoreTone(spam.score < 2.5, spam.score < spam.threshold) } : undefined,
    },
  ];
  const copyValue = tab === "html" ? message.html : tab === "text" ? message.text : tab === "raw" ? raw : null;

  return (
    <article className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {toolbar}

      <div className="flex flex-1 flex-col overflow-y-auto">
        <header className="px-4 pt-6 pb-5 sm:px-10">
          <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.01em] text-balance">{message.subject || "(no subject)"}</h1>
          <div className="mt-5 flex items-start gap-3">
            <Avatar name={displayName(message.from)} size="lg" />
            <div className="min-w-0 flex-1 text-[13px]">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold text-ink">{displayName(message.from)}</span>
                {message.from.name && <span className="truncate text-muted">{message.from.address}</span>}
              </div>
              <dl className="mt-0.5 space-y-0.5">
                <Recipients label="To" list={message.to} />
                <Recipients label="Cc" list={message.cc} />
                <Recipients label="Bcc" list={message.bcc} />
                <Recipients label="Reply-To" list={message.replyTo} />
              </dl>
            </div>
            <div className="hidden shrink-0 text-right text-xs text-muted sm:block">
              <time dateTime={message.date}>{formatFullDate(message.date)}</time>
              <div className="mt-0.5 text-faint">{formatBytes(message.size)}</div>
            </div>
          </div>

          {files.length > 0 && (
            <ul className="mt-5 flex flex-wrap gap-2" aria-label="Attachments">
              {files.map((a) => (
                <li key={a.id}>
                  <a
                    href={api.attachmentUrl(message.id, a.id, true)}
                    className="group flex max-w-64 items-center gap-2.5 rounded-lg border border-line bg-surface py-1.5 pr-3 pl-1.5 text-[13px] transition-colors hover:border-accent/50"
                  >
                    {a.contentType.startsWith("image/") ? (
                      <img src={api.attachmentUrl(message.id, a.id)} alt="" className="size-8 rounded-md object-cover" />
                    ) : (
                      <span className="flex size-8 items-center justify-center rounded-md bg-sunken text-muted">
                        <FileText className="size-4" />
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{a.fileName || "Untitled"}</span>
                      <span className="block text-xs text-faint">{formatBytes(a.size)}</span>
                    </span>
                    <Download className="size-3.5 shrink-0 text-faint transition-colors group-hover:text-accent" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </header>

        <div className="sticky top-0 z-10 flex items-center gap-2 border-y border-line bg-surface/90 px-4 py-2 backdrop-blur sm:px-10">
          <nav role="tablist" aria-label="Message views" className="flex min-w-0 items-center gap-1 overflow-x-auto">
            <TabGroup tabs={views} active={tab} onChange={setTab} />
            <span className="mx-1.5 h-5 w-px shrink-0 bg-line" aria-hidden />
            <TabGroup tabs={checks} active={tab} onChange={setTab} />
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {tab === "html" && (
              <div role="radiogroup" aria-label="Preview width" className="flex rounded-lg bg-sunken p-0.5 max-sm:hidden">
                {(["desktop", "mobile"] as const).map((w) => (
                  <button
                    key={w}
                    role="radio"
                    aria-checked={width === w}
                    onClick={() => setWidth(w)}
                    aria-label={w === "desktop" ? "Desktop width" : "Mobile width, 375 pixels"}
                    title={w === "desktop" ? "Desktop width" : "Mobile width (375px)"}
                    className={`flex size-7 items-center justify-center rounded-md transition-colors ${
                      width === w ? "bg-raised text-ink shadow-sm" : "text-faint hover:text-ink"
                    }`}
                  >
                    {w === "desktop" ? <Monitor className="size-3.5" /> : <Smartphone className="size-3.5" />}
                  </button>
                ))}
              </div>
            )}
            {copyValue && <CopyButton value={copyValue} />}
          </div>
        </div>

        <div role="tabpanel" className="flex-1 bg-paper px-4 py-6 sm:px-10 sm:py-8">
          {tab === "html" && <HtmlPreview key={message.id} html={message.html} width={width} />}
          {tab === "text" && (
            <pre className="panel mx-auto max-w-3xl p-6 font-sans text-sm leading-relaxed wrap-break-word whitespace-pre-wrap text-ink-2">
              {message.text}
            </pre>
          )}
          {tab === "headers" && (
            <div className="panel overflow-hidden">
              <table className="w-full text-[13px]">
                <tbody className="divide-y divide-line">
                  {message.headers.map((h, i) => (
                    <tr key={i} className="align-top">
                      <th scope="row" className="w-1/4 px-4 py-2 text-left font-mono text-xs font-medium whitespace-nowrap text-muted">
                        {h.name}
                      </th>
                      <td className="px-4 py-2 font-mono text-xs break-all text-ink-2">{h.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {tab === "raw" && (
            <pre className="overflow-x-auto rounded-xl border border-line bg-surface p-5 font-mono text-xs leading-relaxed text-ink-2">
              {rawError ? `Couldn't load the source: ${rawError}` : (raw ?? "Loading…")}
            </pre>
          )}
          {tab === "compat" && compat && <HtmlCheckPanel report={compat} />}
          {tab === "links" && <LinkCheckPanel key={message.id} id={message.id} />}
          {tab === "spam" && <SpamPanel report={spam} />}
        </div>
      </div>
    </article>
  );
}

interface TabDef {
  id: Tab;
  label: string;
  badge?: { text: string; tone: string };
  disabled?: boolean;
}

function TabGroup({ tabs, active, onChange }: { tabs: TabDef[]; active: Tab; onChange: (t: Tab) => void }) {
  return tabs.map((t) => (
    <button
      key={t.id}
      role="tab"
      aria-selected={active === t.id}
      disabled={t.disabled}
      onClick={() => onChange(t.id)}
      className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
        active === t.id ? "bg-ink text-surface" : "text-muted hover:bg-sunken hover:text-ink"
      }`}
    >
      {t.label}
      {t.badge && (
        <span className={`text-xs font-semibold tabular-nums ${active === t.id ? "opacity-80" : t.badge.tone}`}>{t.badge.text}</span>
      )}
    </button>
  ));
}

function Recipients({ label, list }: { label: string; list: Address[] }) {
  if (!list?.length) return null;
  const text = list.map(formatAddress).join(", ");
  return (
    <div className="flex gap-1.5 text-muted" title={text}>
      <dt className="shrink-0 text-faint">{label}</dt>
      <dd className="truncate">{text}</dd>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setState("copied");
        } catch {
          setState("failed");
        }
        setTimeout(() => setState("idle"), 1500);
      }}
      className="icon-btn"
      aria-label="Copy to clipboard"
      title={state === "failed" ? "Clipboard is unavailable" : "Copy"}
    >
      {state === "copied" ? <Check className="size-4 text-ok" /> : <Copy className={`size-4 ${state === "failed" ? "text-postal" : ""}`} />}
    </button>
  );
}
