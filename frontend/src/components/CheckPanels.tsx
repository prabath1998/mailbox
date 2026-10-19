import { CheckCircle2, ExternalLink, Image, Link2, Loader2, Play, RotateCw, ShieldCheck, XCircle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api } from "../api";
import { CLIENTS, type HtmlReport } from "../htmlcheck";
import type { LinkReport, SpamReport } from "../types";

export function scoreTone(good: boolean, warn: boolean) {
  if (good) return "text-ok";
  if (warn) return "text-warn";
  return "text-postal";
}

/** Headline result for a check: a ring that fills to `ratio`, the value, and what it means. */
function Summary({
  value,
  max,
  ratio,
  label,
  tone,
  caption,
  action,
}: {
  value: string;
  max?: string;
  ratio: number;
  label: string;
  tone: string;
  caption: string;
  action?: ReactNode;
}) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="panel flex items-center gap-5 p-5">
      <div className={`relative size-16 shrink-0 ${tone}`}>
        <svg viewBox="0 0 64 64" className="size-full -rotate-90" aria-hidden>
          <circle cx="32" cy="32" r={r} fill="none" stroke="var(--sunken)" strokeWidth="6" />
          <circle
            cx="32"
            cy="32"
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - Math.min(1, Math.max(0, ratio)))}
            className="transition-[stroke-dashoffset] duration-700"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[15px] font-semibold tabular-nums">{value}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {label}
          {max && <span className="ml-1.5 text-[13px] font-normal text-faint">{max}</span>}
        </p>
        <p className="mt-0.5 text-[13px] text-muted">{caption}</p>
      </div>
      {action}
    </div>
  );
}

const List = ({ children }: { children: ReactNode }) => <ul className="panel divide-y divide-line overflow-hidden">{children}</ul>;

const Footnote = ({ children }: { children: ReactNode }) => <p className="text-xs text-faint">{children}</p>;

export function HtmlCheckPanel({ report }: { report: HtmlReport }) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Summary
        value={`${report.score}`}
        ratio={report.score / 100}
        label={report.score >= 90 ? "Renders well everywhere" : report.score >= 70 ? "Mostly compatible" : "Rendering problems likely"}
        tone={scoreTone(report.score >= 90, report.score >= 70)}
        caption={
          report.findings.length === 0
            ? "No features with known client support problems were found."
            : `${report.findings.length} feature${report.findings.length === 1 ? "" : "s"} won't render the same in every client.`
        }
      />

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {CLIENTS.map((c) => {
          const { unsupported, partial } = report.perClient[c];
          return (
            <li key={c} className="panel flex items-center justify-between gap-2 px-3 py-2.5 text-[13px]">
              <span className="truncate">{c}</span>
              {unsupported + partial === 0 ? (
                <CheckCircle2 className="size-4 shrink-0 text-ok" aria-label="Fully supported" />
              ) : (
                <span className="shrink-0 text-xs font-medium tabular-nums">
                  {unsupported > 0 && <span className="text-postal">{unsupported} unsupported</span>}
                  {unsupported > 0 && partial > 0 && <span className="text-faint">, </span>}
                  {partial > 0 && <span className="text-warn">{partial} partial</span>}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {report.findings.length > 0 && (
        <List>
          {report.findings.map((f) => (
            <li key={f.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
              <a href={f.url} target="_blank" rel="noreferrer" className="group flex items-center gap-1.5 font-mono text-[13px] font-medium hover:text-accent">
                {f.title}
                <ExternalLink className="size-3 text-faint transition-colors group-hover:text-accent" />
              </a>
              <div className="flex flex-wrap gap-1 sm:justify-end">
                {f.unsupported.map((c) => (
                  <span key={c} className="rounded-md bg-postal-soft px-1.5 py-0.5 text-xs text-postal">
                    {c}
                  </span>
                ))}
                {f.partial.map((c) => (
                  <span key={c} className="rounded-md bg-sunken px-1.5 py-0.5 text-xs text-warn">
                    {c} (partial)
                  </span>
                ))}
              </div>
            </li>
          ))}
        </List>
      )}
      <Footnote>
        Based on a simplified set of{" "}
        <a href="https://www.caniemail.com" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-ink">
          caniemail.com
        </a>{" "}
        data. Open a feature for details.
      </Footnote>
    </div>
  );
}

export function SpamPanel({ report }: { report: SpamReport | null }) {
  if (!report) return <Loading />;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Summary
        value={report.score.toFixed(1)}
        max={`threshold ${report.threshold}`}
        ratio={report.score / report.threshold}
        label={report.isSpam ? "Likely to be flagged as spam" : report.score >= 2.5 ? "Some spam signals" : "Looks clean"}
        tone={scoreTone(report.score < 2.5, report.score < report.threshold)}
        caption="Lower is better. Mail at or above the threshold is usually filtered."
      />
      {report.rules.length > 0 ? (
        <List>
          {report.rules.map((r) => (
            <li key={r.name} className="flex items-start gap-4 px-4 py-3">
              <span className={`w-10 shrink-0 pt-px text-right text-[13px] font-semibold tabular-nums ${r.score >= 1.5 ? "text-postal" : "text-warn"}`}>
                +{r.score.toFixed(1)}
              </span>
              <div className="min-w-0">
                <p className="text-[13px]">{r.description}</p>
                <p className="mt-0.5 font-mono text-xs text-faint">{r.name}</p>
              </div>
            </li>
          ))}
        </List>
      ) : (
        <Empty icon={<ShieldCheck className="size-5" />} text="No spam rules matched." />
      )}
      <Footnote>Built-in heuristics modelled on common SpamAssassin rules. Nothing leaves your machine.</Footnote>
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
      <div className="panel mx-auto flex max-w-md flex-col items-center gap-2 px-6 py-10 text-center">
        <div className="mb-1 flex size-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Link2 className="size-5" />
        </div>
        <p className="font-semibold">Check every link and image</p>
        <p className="text-[13px] text-muted">MailBox requests each URL from your machine and reports broken links, 404s and images that don't load.</p>
        <button onClick={run} disabled={running} className="btn-primary mt-3">
          {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          {running ? "Checking links…" : "Check links"}
        </button>
        {error && <p className="text-[13px] text-postal">{error}</p>}
      </div>
    );
  }

  const total = report.links.length;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Summary
        value={String(report.broken)}
        max={`of ${total}`}
        ratio={total ? (total - report.broken) / total : 1}
        label={report.broken === 0 ? "All links work" : `${report.broken} broken`}
        tone={scoreTone(report.broken === 0, false)}
        caption="Links and images that failed or returned an error status."
        action={
          <button onClick={run} disabled={running} className="btn-outline">
            {running ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
            Check again
          </button>
        }
      />
      {total === 0 ? (
        <Empty icon={<Link2 className="size-5" />} text="This message has no http(s) links." />
      ) : (
        <List>
          {report.links.map((l) => (
            <li key={l.url} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
              {l.ok ? <CheckCircle2 className="size-4 shrink-0 text-ok" aria-label="Works" /> : <XCircle className="size-4 shrink-0 text-postal" aria-label="Broken" />}
              {l.kind === "image" ? <Image className="size-3.5 shrink-0 text-faint" aria-label="Image" /> : <Link2 className="size-3.5 shrink-0 text-faint" aria-label="Link" />}
              <a href={l.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-mono text-xs hover:text-accent">
                {l.url}
              </a>
              <span className={`shrink-0 text-xs tabular-nums ${l.ok ? "text-faint" : "font-medium text-postal"}`} title={l.error}>
                {l.status ? `${l.status} ${l.statusText}` : "Unreachable"}
              </span>
            </li>
          ))}
        </List>
      )}
      {error && <p className="text-[13px] text-postal">{error}</p>}
    </div>
  );
}

function Loading() {
  return (
    <div className="flex justify-center py-10 text-faint" aria-busy>
      <Loader2 className="size-5 animate-spin" />
    </div>
  );
}

function Empty({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="panel flex flex-col items-center gap-2 py-8 text-muted">
      <span className="text-ok">{icon}</span>
      <p className="text-[13px]">{text}</p>
    </div>
  );
}
