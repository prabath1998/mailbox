// Email client HTML/CSS compatibility check. Support data is a simplified subset of
// caniemail.com; each rule links to its caniemail page for the full picture.

export const CLIENTS = ["Gmail", "Outlook (Windows)", "Outlook.com", "Apple Mail", "Yahoo", "Samsung Email"] as const;
export type Client = (typeof CLIENTS)[number];
type Support = "no" | "partial";

interface Rule {
  id: string;
  title: string;
  slug: string;
  detect: (ctx: Ctx) => boolean;
  support: Partial<Record<Client, Support>>;
}

interface Ctx {
  doc: Document;
  css: string;
}

const cssHas = (re: RegExp) => (c: Ctx) => re.test(c.css);
const has = (selector: string) => (c: Ctx) => c.doc.querySelector(selector) !== null;

const RULES: Rule[] = [
  { id: "flex", title: "display: flex", slug: "css-display-flex", detect: cssHas(/display\s*:\s*(inline-)?flex/i),
    support: { "Outlook (Windows)": "no", Gmail: "partial", Yahoo: "partial" } },
  { id: "grid", title: "display: grid", slug: "css-display-grid", detect: cssHas(/display\s*:\s*(inline-)?grid/i),
    support: { "Outlook (Windows)": "no", Gmail: "no", "Outlook.com": "no", Yahoo: "no" } },
  { id: "position", title: "position", slug: "css-position", detect: cssHas(/(^|[;{\s])position\s*:\s*(absolute|fixed|relative|sticky)/i),
    support: { "Outlook (Windows)": "no", Gmail: "no", "Outlook.com": "no", Yahoo: "no" } },
  { id: "radius", title: "border-radius", slug: "css-border-radius", detect: cssHas(/border(-[a-z]+)*-radius\s*:/i),
    support: { "Outlook (Windows)": "no" } },
  { id: "bgimage", title: "CSS background images", slug: "css-background-image", detect: cssHas(/background(-image)?\s*:[^;]*url\(/i),
    support: { "Outlook (Windows)": "no" } },
  { id: "fontface", title: "@font-face web fonts", slug: "css-at-font-face", detect: cssHas(/@font-face/i),
    support: { Gmail: "no", "Outlook (Windows)": "partial", "Outlook.com": "no", Yahoo: "no" } },
  { id: "media", title: "@media queries", slug: "css-at-media", detect: cssHas(/@media/i),
    support: { "Outlook (Windows)": "no", Gmail: "partial", "Outlook.com": "partial" } },
  { id: "vars", title: "CSS variables", slug: "css-variables", detect: cssHas(/var\(\s*--/i),
    support: { Gmail: "no", "Outlook (Windows)": "no", "Outlook.com": "no", Yahoo: "no" } },
  { id: "animation", title: "CSS animations", slug: "css-at-keyframes", detect: cssHas(/@keyframes|animation\s*:/i),
    support: { Gmail: "no", "Outlook (Windows)": "no", "Outlook.com": "no", Yahoo: "no" } },
  { id: "objectfit", title: "object-fit", slug: "css-object-fit", detect: cssHas(/object-fit\s*:/i),
    support: { Gmail: "no", "Outlook (Windows)": "no" } },
  { id: "hover", title: ":hover", slug: "css-pseudo-class-hover", detect: cssHas(/:hover/i),
    support: { "Outlook (Windows)": "no" } },
  { id: "svg", title: "<svg> elements", slug: "html-svg", detect: has("svg"),
    support: { Gmail: "no", "Outlook (Windows)": "no", "Outlook.com": "no", Yahoo: "partial" } },
  { id: "svgimg", title: "SVG images", slug: "image-svg", detect: (c) =>
      [...c.doc.querySelectorAll("img")].some((i) => /\.svg(\?|#|$)/i.test(i.getAttribute("src") ?? "")),
    support: { Gmail: "no", "Outlook (Windows)": "no", "Outlook.com": "no", Yahoo: "no" } },
  { id: "webp", title: "WebP images", slug: "image-webp", detect: (c) =>
      [...c.doc.querySelectorAll("img")].some((i) => /\.webp(\?|#|$)/i.test(i.getAttribute("src") ?? "")),
    support: { "Outlook (Windows)": "no" } },
  { id: "video", title: "<video>", slug: "html-video", detect: has("video"),
    support: { Gmail: "no", "Outlook (Windows)": "no", "Outlook.com": "no", Yahoo: "no", "Samsung Email": "partial" } },
  { id: "form", title: "Forms and inputs", slug: "html-form", detect: has("form, input, select, textarea"),
    support: { Gmail: "no", "Outlook (Windows)": "no", "Outlook.com": "no", Yahoo: "partial" } },
  { id: "script", title: "JavaScript", slug: "html-script", detect: has("script"),
    support: { Gmail: "no", "Outlook (Windows)": "no", "Outlook.com": "no", "Apple Mail": "no", Yahoo: "no", "Samsung Email": "no" } },
  { id: "link", title: "External stylesheets (<link>)", slug: "html-link", detect: has('link[rel~="stylesheet" i]'),
    support: { Gmail: "no", "Outlook (Windows)": "no", "Outlook.com": "no", Yahoo: "no" } },
];

export interface Finding {
  id: string;
  title: string;
  url: string;
  unsupported: Client[];
  partial: Client[];
}

export interface HtmlReport {
  score: number; // 0–100, share of client × feature combinations that render as written
  findings: Finding[];
  perClient: Record<Client, { unsupported: number; partial: number }>;
}

export function checkHtml(html: string): HtmlReport {
  // DOMParser builds an inert document: no scripts run and nothing is fetched.
  const doc = new DOMParser().parseFromString(html, "text/html");
  const css = [
    ...[...doc.querySelectorAll("style")].map((s) => s.textContent ?? ""),
    ...[...doc.querySelectorAll("[style]")].map((e) => `{${e.getAttribute("style")}}`),
  ].join("\n");

  const findings: Finding[] = [];
  const perClient = Object.fromEntries(CLIENTS.map((c) => [c, { unsupported: 0, partial: 0 }])) as HtmlReport["perClient"];
  for (const rule of RULES) {
    if (!rule.detect({ doc, css })) continue;
    const unsupported = CLIENTS.filter((c) => rule.support[c] === "no");
    const partial = CLIENTS.filter((c) => rule.support[c] === "partial");
    unsupported.forEach((c) => perClient[c].unsupported++);
    partial.forEach((c) => perClient[c].partial++);
    findings.push({ id: rule.id, title: rule.title, url: `https://www.caniemail.com/features/${rule.slug}/`, unsupported, partial });
  }

  const penalty = findings.reduce((n, f) => n + f.unsupported.length + f.partial.length * 0.5, 0);
  const possible = Math.max(1, findings.length) * CLIENTS.length;
  const score = findings.length === 0 ? 100 : Math.round(100 * (1 - penalty / possible));
  findings.sort((a, b) => b.unsupported.length + b.partial.length / 2 - (a.unsupported.length + a.partial.length / 2));
  return { score, findings, perClient };
}
