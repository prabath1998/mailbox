import { CheckCircle2, ExternalLink, Image, Link2, Loader2, Play, ShieldCheck, XCircle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api } from "../api";
import { CLIENTS, type HtmlReport } from "../htmlcheck";
import type { LinkReport, SpamReport } from "../types";

export function scoreTone(good: boolean, warn: boolean) {
  if (good) return "text-emerald-600 dark:text-emerald-400";
  if (warn) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function Gauge({ value, max, label, tone, caption }: { value: string; max?: string; label: string; tone: string; caption: string }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className={`text-4xl font-semibold tracking-tight tabular-nums ${tone}`}>
        {value}
        {max && <span className="text-lg text-zinc-400">{max}</span>}
      </div>
      <div>
        <p className="font-medium">{label}</p>
        <p className="text-sm text-zinc-500">{caption}</p>
      </div>
    </div>
  );
}

const Card = ({ children }: { children: ReactNode }) => (
  <div className="divide-y divide-zinc-200 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
    {children}
  </div>
);

export function HtmlCheckPanel({ report }: { report: HtmlReport }) {
  const tone = scoreTone(report.score >= 90, report.score >= 70);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Gauge
        value={`${report.score}%`}
        label="Email client compatibility"
        tone={tone}
        caption={
          report.findings.length === 0
            ? "No features with known support problems were found."
            : `${report.findings.length} feature${report.findings.length === 1 ? "" : "s"} won't render the same everywhere.`
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {CLIENTS.map((c) => {
          const { unsupported, partial } = report.perClient[c];
          return (
            <div key={c} className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm dark:border-zinc-800 dark:bg-zinc-900">
              <span className="truncate">{c}</span>
              {unsupported + partial === 0 ? (
                <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
              ) : (
                <span className="shrink-0 text-xs font-medium">
                  {unsupported > 0 && <span className="text-red-500">{unsupported} unsupported</span>}
                  {unsupported > 0 && partial > 0 && <span className="text-zinc-400"> · </span>}
                  {partial > 0 && <span className="text-amber-500">{partial} partial</span>}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {report.findings.length > 0 && (
        <Card>
          {report.findings.map((f) => (
            <div key={f.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
              <a href={f.url} target="_blank" rel="noreferrer" className="group flex items-center gap-1.5 font-mono text-sm font-medium hover:text-indigo-500">
                {f.title}
                <ExternalLink className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
              </a>
              <div className="flex flex-wrap gap-1 sm:justify-end">
                {f.unsupported.map((c) => (
                  <span key={c} className="rounded-md bg-red-500/10 px-1.5 py-0.5 text-xs text-red-600 dark:text-red-400">
                    {c}
                  </span>
                ))}
                {f.partial.map((c) => (
                  <span key={c} className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-700 dark:text-amber-400">
                    {c} · partial
                  </span>
                ))}
              </div>
            </div>
          ))}
        </Card>
      )}
      <p className="text-xs text-zinc-500">
        Based on a simplified set of{" "}
        <a href="https://www.caniemail.com" target="_blank" rel="noreferrer" className="underline underline-offset-2">
          caniemail.com
        </a>{" "}
        data. Click a feature for details.
      </p>
    </div>
  );
}

export function SpamPanel({ report }: { report: SpamReport | null }) {
  if (!report) return <Loading />;
  const tone = scoreTone(report.score < 2.5, report.score < report.threshold);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Gauge
        value={report.score.toFixed(1)}
        max={` / ${report.threshold}`}
        label={report.isSpam ? "Likely to be flagged as spam" : report.score >= 2.5 ? "Some spam signals" : "Looks clean"}
        tone={tone}
        caption="Lower is better. Messages at or above the threshold are usually filtered."
      />
      {report.rules.length > 0 ? (
        <Card>
          {report.rules.map((r) => (
            <div key={r.name} className="flex items-start gap-3 px-4 py-3">
              <span className={`w-10 shrink-0 pt-0.5 text-right font-mono text-sm tabular-nums ${r.score >= 1.5 ? "text-red-500" : "text-amber-500"}`}>
                +{r.score.toFixed(1)}
              </span>
              <div className="min-w-0">
                <p className="font-mono text-xs font-medium text-zinc-500">{r.name}</p>
                <p className="text-sm">{r.description}</p>
              </div>
            </div>
          ))}
        </Card>
      ) : (
        <Empty icon={<ShieldCheck className="size-6" />} text="No spam rules matched." />
      )}
      <p className="text-xs text-zinc-500">
        Built-in heuristics modelled on common SpamAssassin rules. No external service needed.
      </p>
    </div>
  );
}

export function LinkCheckPanel({ id }: { id: number }) {
  const [report, setReport] = useState<LinkReport | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      setReport(await api.links(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Link check failed");
    } finally {
      setRunning(false);
    }
  };

  if (!report) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-10 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-500">
          <Link2 className="size-6" />
        </div>
        <p className="font-medium">Check every link and image</p>
        <p className="text-sm text-zinc-500">
          MailBox will request each URL from your machine and report broken links, 404s and unreachable images.
        </p>
        <button onClick={run} disabled={running} className="btn mt-2 bg-indigo-600 text-white hover:bg-indigo-700">
          {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          {running ? "Checking…" : "Run link check"}
        </button>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <Gauge
          value={String(report.broken)}
          max={` / ${report.links.length}`}
          label={report.broken === 0 ? "All links work" : `${report.broken} broken`}
          tone={scoreTone(report.broken === 0, false)}
          caption="Links and images that failed or returned an error."
        />
        <button onClick={run} disabled={running} className="btn-ghost">
          {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          Re-run
        </button>
      </div>
      {report.links.length === 0 ? (
        <Empty icon={<Link2 className="size-6" />} text="This message has no http(s) links." />
      ) : (
        <Card>
          {report.links.map((l) => (
            <div key={l.url} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              {l.ok ? <CheckCircle2 className="size-4 shrink-0 text-emerald-500" /> : <XCircle className="size-4 shrink-0 text-red-500" />}
              {l.kind === "image" ? <Image className="size-3.5 shrink-0 text-zinc-400" /> : <Link2 className="size-3.5 shrink-0 text-zinc-400" />}
              <a href={l.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-mono text-xs hover:text-indigo-500">
                {l.url}
              </a>
              <span className={`shrink-0 text-xs tabular-nums ${l.ok ? "text-zinc-500" : "text-red-500"}`} title={l.error}>
                {l.status ? `${l.status} ${l.statusText}` : "Unreachable"}
              </span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function Loading() {
  return (
    <div className="flex justify-center py-10 text-zinc-400">
      <Loader2 className="size-5 animate-spin" />
    </div>
  );
}

function Empty({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-zinc-400">
      {icon}
      <p className="text-sm">{text}</p>
    </div>
  );
}
