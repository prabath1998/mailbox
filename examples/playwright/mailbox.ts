// Copy this file into your Playwright project to read caught email in tests.
// Set MAILBOX_URL if MailBox isn't on http://localhost:8025, and MAILBOX_AUTH
// ("user:pass") if it was started with -ui-auth.

const BASE = process.env.MAILBOX_URL ?? "http://localhost:8025";
const AUTH = process.env.MAILBOX_AUTH;

export interface Email {
  id: number;
  subject: string;
  from: { name: string; address: string };
  to: { name: string; address: string }[];
  text: string;
  html: string;
  tags: string[];
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {};
  if (AUTH) headers.Authorization = "Basic " + Buffer.from(AUTH).toString("base64");
  return fetch(BASE + "/api" + path, { ...init, headers });
}

/** Deletes every caught message. Call it before a test for a clean inbox. */
export async function clearInbox(): Promise<void> {
  const res = await api("/messages", { method: "DELETE" });
  if (!res.ok) throw new Error(`MailBox: couldn't clear the inbox (${res.status})`);
}

/**
 * Waits for an email matching a MailBox search, e.g. "to:ana@example.com subject:welcome",
 * and returns it. Only mail received after `since` counts (default: the moment you call it
 * minus a few seconds, to absorb clock differences).
 */
export async function waitForEmail(query: string, opts: { since?: Date; timeoutMs?: number } = {}): Promise<Email> {
  const since = opts.since ?? new Date(Date.now() - 5000);
  const params = new URLSearchParams({ q: query, since: String(since.getTime()), timeout: String((opts.timeoutMs ?? 15000) / 1000) });
  const res = await api(`/messages/wait?${params}`);
  if (res.status === 404) throw new Error(`MailBox: no email matching "${query}" arrived in time`);
  if (!res.ok) throw new Error(`MailBox: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Links (with their text) and likely one-time codes found in an email, best guess first. */
export async function extract(email: Email): Promise<{ links: { url: string; text: string }[]; codes: string[] }> {
  const res = await api(`/messages/${email.id}/extract`);
  if (!res.ok) throw new Error(`MailBox: ${res.status} ${await res.text()}`);
  return res.json();
}
