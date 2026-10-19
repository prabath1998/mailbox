import type { Info, LinkReport, Message, Page, SpamReport, TagCount } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (!res.ok) throw new Error((await res.text()) || `Server responded with ${res.status}`);
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  info: () => request<Info>("/info"),
  tags: () => request<TagCount[]>("/tags"),
  list: (q: string, limit: number, offset: number) =>
    request<Page>(`/messages?${new URLSearchParams({ q, limit: String(limit), offset: String(offset) })}`),
  get: (id: number) => request<Message>(`/messages/${id}`),
  setRead: (ids: number[], read: boolean) =>
    request<void>("/messages/read", { method: "PUT", body: JSON.stringify({ ids, read }) }),
  remove: (ids: number[]) => request<void>("/messages", { method: "DELETE", body: JSON.stringify({ ids }) }),
  removeAll: () => request<void>("/messages", { method: "DELETE" }),
  spam: (id: number) => request<SpamReport>(`/messages/${id}/spam`),
  links: (id: number) => request<LinkReport>(`/messages/${id}/links`),
  rawUrl: (id: number, download = false) => `/api/messages/${id}/raw${download ? "?download" : ""}`,
  attachmentUrl: (id: number, aid: number, download = false) =>
    `/api/messages/${id}/attachments/${aid}${download ? "?download" : ""}`,
};
