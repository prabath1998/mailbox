export interface Address {
  name: string;
  address: string;
}

export interface Summary {
  id: number;
  messageId: string;
  from: Address;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  replyTo: Address[];
  subject: string;
  snippet: string;
  date: string;
  received: string;
  size: number;
  read: boolean;
  attachments: number;
  tags: string[];
}

export interface TagCount {
  name: string;
  count: number;
}

export interface Attachment {
  id: number;
  partId: string;
  fileName: string;
  contentType: string;
  contentId: string;
  inline: boolean;
  size: number;
}

export interface Message extends Summary {
  text: string;
  html: string;
  headers: { name: string; value: string }[];
  attachmentParts: Attachment[];
}

export interface Page {
  messages: Summary[];
  total: number;
  unread: number;
}

export interface SpamReport {
  score: number;
  threshold: number;
  isSpam: boolean;
  rules: { name: string; score: number; description: string }[];
}

export interface LinkReport {
  links: { url: string; kind: "link" | "image"; status: number; statusText: string; ok: boolean; error?: string }[];
  broken: number;
}

export interface InboxEvent {
  type: "new" | "read" | "deleted";
  ids?: number[];
  read?: boolean;
  message?: Summary;
}

export interface Info {
  smtpAddr: string;
}
