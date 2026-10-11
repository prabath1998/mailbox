import { ArrowLeft, Check, Copy, Download, FileText, Loader2, Mail, MailOpen, Monitor, Smartphone, Trash2 } from "lucide-react";
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
  id: number | null;
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

  useEffect(() => {
    if (id === null) return;
    let cancelled = false;
    setMessage(null);
    setSpam(null);
    setRaw(null);
    setError(null);
    api
      .get(id)
      .then((m) => {
        if (cancelled) return;
        setMessage(m);
        setTab((t) => (t === "html" || t === "text" ? (m.html ? "html" : "text") : t));
      })
      .catch((e) => !cancelled && setError(e.message));
    api.spam(id).then((r) => !cancelled && setSpam(r)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (tab === "raw" && raw === null && id !== null) {
      fetch(api.rawUrl(id)).then((r) => r.text()).then(setRaw);
    }
  }, [tab, raw, id]);

  const compat = useMemo(() => (message?.html ? checkHtml(message.html) : null), [message?.html]);

  if (id === null) {
    return (
      <div className="hidden flex-1 flex-col items-center justify-center gap-3 text-zinc-400 md:flex">
        <Mail className="size-10 stroke-1" />
        <p className="text-sm">Select a message to read it</p>
        <p className="text-xs">
          <kbd className="kbd">j</kbd> <kbd className="kbd">k</kbd> move · <kbd className="kbd">/</kbd> search ·{" "}
          <kbd className="kbd">e</kbd> delete · <kbd className="kbd">u</kbd> unread
        </p>
      </div>
    );
  }

  if (error) return <div className="flex flex-1 items-center justify-center text-sm text-red-500">{error}</div>;
  if (!message)
    return (
      <div className="flex flex-1 items-center justify-center text-zinc-400">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );

  const files = message.attachmentParts.filter((a) => !a.inline || !message.html.includes(`/attachments/${a.id}`));
  const tabs: { id: Tab; label: string; badge?: { text: string; tone: string }; disabled?: boolean }[] = [
    { id: "html", label: "Preview", disabled: !message.html },
    { id: "text", label: "Text", disabled: !message.text },
    { id: "headers", label: "Headers" },
    { id: "raw", label: "Raw" },
    {
      id: "compat",
      label: "HTML check",
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

  return (
    <article className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="border-b border-zinc-200 px-4 pt-4 pb-5 sm:px-8 dark:border-zinc-800">
        <div className="mb-3 flex items-center justify-between">
          <button onClick={onBack} className="icon-btn -ml-2 md:invisible" title="Back">
            <ArrowLeft className="size-4" />
          </button>
          <div className="flex items-center gap-0.5">
            <button onClick={() => onMarkUnread(message.id)} className="icon-btn" title="Mark unread (u)">
              <MailOpen className="size-4" />
            </button>
            <a href={api.rawUrl(message.id, true)} className="icon-btn" title="Download .eml">
              <Download className="size-4" />
            </a>
            <button onClick={() => onDelete(message.id)} className="icon-btn hover:text-red-500!" title="Delete (e)">
              <Trash2 className="size-4" />
            </button>
          </div>
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-balance">{message.subject || "(no subject)"}</h2>
        <div className="mt-4 flex items-start gap-3">
          <Avatar name={displayName(message.from)} size="lg" />
          <div className="min-w-0 flex-1 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">{displayName(message.from)}</span>
              {message.from.name && <span className="truncate text-zinc-500">&lt;{message.from.address}&gt;</span>}
            </div>
            <Recipients label="to" list={message.to} />
            <Recipients label="cc" list={message.cc} />
            <Recipients label="bcc" list={message.bcc} />
            <Recipients label="reply-to" list={message.replyTo} />
          </div>
          <div className="hidden shrink-0 text-right text-xs text-zinc-500 sm:block">
            <time>{formatFullDate(message.date)}</time>
            <div className="mt-0.5">{formatBytes(message.size)}</div>
          </div>
        </div>
        {files.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {files.map((a) => (
              <a
                key={a.id}
                href={api.attachmentUrl(message.id, a.id, true)}
                className="group flex max-w-64 items-center gap-2.5 rounded-xl border border-zinc-200 py-2 pr-3 pl-2.5 text-sm transition-colors hover:border-indigo-300 hover:bg-indigo-50/50 dark:border-zinc-800 dark:hover:border-indigo-500/40 dark:hover:bg-indigo-500/5"
              >
                {a.contentType.startsWith("image/") ? (
                  <img src={api.attachmentUrl(message.id, a.id)} alt="" className="size-8 rounded-md object-cover" />
                ) : (
                  <div className="flex size-8 items-center justify-center rounded-md bg-zinc-100 text-zinc-500 dark:bg-zinc-800">
                    <FileText className="size-4" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate font-medium">{a.fileName || "Untitled"}</p>
                  <p className="text-xs text-zinc-500">{formatBytes(a.size)}</p>
                </div>
                <Download className="size-3.5 shrink-0 text-zinc-400 opacity-0 transition-opacity group-hover:opacity-100" />
              </a>
            ))}
          </div>
        )}
      </header>

      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 sm:px-8 dark:border-zinc-800">
        <nav className="-mb-px flex gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              disabled={t.disabled}
              onClick={() => setTab(t.id)}
              className={`relative flex shrink-0 items-center gap-1.5 px-3 py-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                tab === t.id ? "text-indigo-600 dark:text-indigo-400" : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              {t.label}
              {t.badge && <span className={`text-xs tabular-nums ${t.badge.tone}`}>{t.badge.text}</span>}
              {tab === t.id && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-indigo-500" />}
            </button>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-1">
          {tab === "html" && (
            <div className="flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800">
              {(["desktop", "mobile"] as const).map((w) => (
                <button
                  key={w}
                  onClick={() => setWidth(w)}
                  title={w === "desktop" ? "Desktop width" : "Mobile width (375px)"}
                  className={`rounded-md p-1.5 transition-colors ${
                    width === w ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100" : "text-zinc-500"
                  }`}
                >
                  {w === "desktop" ? <Monitor className="size-3.5" /> : <Smartphone className="size-3.5" />}
                </button>
              ))}
            </div>
          )}
          {(tab === "html" || tab === "text" || tab === "raw") && (
            <CopyButton value={tab === "html" ? message.html : tab === "text" ? message.text : (raw ?? "")} />
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-zinc-50/60 p-4 sm:p-8 dark:bg-zinc-900/40">
        {tab === "html" && <HtmlPreview key={message.id} html={message.html} width={width} />}
        {tab === "text" && <pre className="font-sans text-sm leading-relaxed break-words whitespace-pre-wrap">{message.text}</pre>}
        {tab === "headers" && (
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {message.headers.map((h, i) => (
                  <tr key={i} className="align-top">
                    <td className="w-1/4 px-4 py-2 font-mono text-xs font-medium whitespace-nowrap text-zinc-500">{h.name}</td>
                    <td className="px-4 py-2 font-mono text-xs break-all">{h.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tab === "raw" && (
          <pre className="overflow-x-auto rounded-2xl bg-zinc-900 p-4 font-mono text-xs leading-relaxed text-zinc-200 dark:bg-black/40">
            {raw ?? "Loading…"}
          </pre>
        )}
        {tab === "compat" && compat && <HtmlCheckPanel report={compat} />}
        {tab === "links" && <LinkCheckPanel key={message.id} id={message.id} />}
        {tab === "spam" && <SpamPanel report={spam} />}
      </div>
    </article>
  );
}

function Recipients({ label, list }: { label: string; list: Address[] }) {
  if (!list?.length) return null;
  return (
    <div className="truncate text-zinc-500" title={list.map(formatAddress).join(", ")}>
      <span className="text-zinc-400">{label} </span>
      {list.map(formatAddress).join(", ")}
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="icon-btn"
      title="Copy"
    >
      {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
    </button>
  );
}
