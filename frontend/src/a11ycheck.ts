// Accessibility check for email HTML. The email is rendered in a hidden, sandboxed
// iframe so colours and font sizes are the computed values a reader would see,
// not guesses from the markup.

import { emailDocument, supportsDarkMode } from "./emailDoc";

export type Severity = "error" | "warning";

export interface A11ySample {
  text: string;
  fg?: string;
  bg?: string;
  ratio?: number;
}

export interface A11yFinding {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  count: number;
  samples: A11ySample[];
}

export interface A11yReport {
  score: number;
  findings: A11yFinding[];
  darkMode: boolean;
}

const MAX_SAMPLES = 3;
const VAGUE_LINKS = new Set(["click here", "here", "click", "read more", "more", "learn more", "link", "this", "this link", "go"]);

interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(s: string): RGBA | null {
  const m = s.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/);
  if (!m) return null;
  let a = m[4] === undefined ? 1 : parseFloat(m[4]);
  if (m[4]?.endsWith("%")) a /= 100;
  return { r: +m[1], g: +m[2], b: +m[3], a };
}

const blend = (top: RGBA, bottom: RGBA): RGBA => ({
  r: top.r * top.a + bottom.r * (1 - top.a),
  g: top.g * top.a + bottom.g * (1 - top.a),
  b: top.b * top.a + bottom.b * (1 - top.a),
  a: 1,
});

function luminance({ r, g, b }: RGBA) {
  const ch = (v: number) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

export function contrast(a: RGBA, b: RGBA) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const hex = ({ r, g, b }: RGBA) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/** The solid colour behind an element, or null when a background image makes it unknowable. */
function backgroundOf(el: Element, win: Window): RGBA | null {
  const layers: RGBA[] = [];
  for (let e: Element | null = el; e; e = e.parentElement) {
    const cs = win.getComputedStyle(e);
    if (cs.backgroundImage && cs.backgroundImage !== "none") return null;
    const c = parseColor(cs.backgroundColor);
    if (c && c.a > 0) {
      layers.push(c);
      if (c.a >= 1) break;
    }
  }
  return layers.reduceRight<RGBA>((under, layer) => blend(layer, under), { r: 255, g: 255, b: 255, a: 1 });
}

function isHidden(el: Element, win: Window) {
  if (el.getClientRects().length === 0) return true;
  const cs = win.getComputedStyle(el);
  if (cs.visibility === "hidden" || parseFloat(cs.opacity) === 0 || parseFloat(cs.fontSize) === 0) return true;
  // Preheaders are often hidden with max-height: 0 / overflow: hidden rather than display: none.
  for (let e: Element | null = el; e && e !== e.ownerDocument.body; e = e.parentElement) {
    const s = win.getComputedStyle(e);
    if (s.overflow !== "visible" && e.getBoundingClientRect().height < 1) return true;
    if (parseFloat(s.opacity) === 0) return true;
  }
  return false;
}

const clip = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 60 ? t.slice(0, 57) + "…" : t;
};

function render(html: string): Promise<{ frame: HTMLIFrameElement; doc: Document; win: Window }> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    // A typical email client reading pane width, off screen.
    Object.assign(frame.style, { position: "fixed", left: "-10000px", top: "0", width: "600px", height: "800px", border: "0", colorScheme: "light" });
    frame.onload = () => {
      const doc = frame.contentDocument;
      const win = frame.contentWindow;
      if (doc && win) resolve({ frame, doc, win });
      else reject(new Error("Couldn't render the email"));
    };
    frame.srcdoc = emailDocument(html, "light");
    document.body.appendChild(frame);
  });
}

export async function checkAccessibility(html: string): Promise<A11yReport> {
  const { frame, doc, win } = await render(html);
  try {
    return analyze(html, doc, win);
  } finally {
    frame.remove();
  }
}

function analyze(html: string, doc: Document, win: Window): A11yReport {
  const found = new Map<string, A11yFinding>();
  const report = (id: string, severity: Severity, title: string, detail: string, sample?: A11ySample) => {
    let f = found.get(id);
    if (!f) found.set(id, (f = { id, severity, title, detail, count: 0, samples: [] }));
    f.count++;
    if (sample && f.samples.length < MAX_SAMPLES && !f.samples.some((s) => s.text === sample.text)) f.samples.push(sample);
  };

  // Images
  const images = [...doc.querySelectorAll("img")];
  for (const img of images) {
    if (img.hasAttribute("alt")) continue;
    const name = (img.getAttribute("src") ?? "").split(/[/?#]/).filter(Boolean).pop() ?? "image";
    const tiny = img.width <= 2 && img.height <= 2;
    if (tiny) {
      report("pixel-alt", "warning", "Tracking pixel without alt text",
        'Screen readers may read out the file name. Add alt="" so they skip it.', { text: clip(name) });
    } else {
      report("img-alt", "error", "Image without alt text",
        'Screen readers announce the file name instead of what the image shows. Describe it in alt, or use alt="" if it is decorative.', { text: clip(name) });
    }
  }

  // Links
  for (const a of doc.querySelectorAll("a[href]")) {
    const text = (a.textContent ?? "").replace(/\s+/g, " ").trim();
    const imgAlt = [...a.querySelectorAll("img[alt]")].map((i) => i.getAttribute("alt")).join(" ").trim();
    const label = a.getAttribute("aria-label") ?? a.getAttribute("title") ?? "";
    if (!text && !imgAlt && !label) {
      report("link-name", "error", "Link with no text",
        "Screen readers can only read the URL. Give the link visible text, or alt text on its image.", { text: clip(a.getAttribute("href") ?? "") });
    } else if (VAGUE_LINKS.has(text.toLowerCase())) {
      report("vague-link", "warning", "Link text doesn't say where it goes",
        'People using screen readers often jump between links, so "click here" tells them nothing. Name the destination, like "Reset your password".', { text: clip(text) });
    }
  }

  // Text: contrast and size
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let visibleText = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    if (!text.trim()) continue;
    const el = node.parentElement;
    if (!el || ["STYLE", "SCRIPT", "TITLE"].includes(el.tagName) || isHidden(el, win)) continue;
    visibleText += " " + text;

    const cs = win.getComputedStyle(el);
    const size = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    const large = size >= 24 || (bold && size >= 18.66);
    const fg = parseColor(cs.color);
    const bg = backgroundOf(el, win);
    if (fg && bg) {
      const solid = fg.a < 1 ? blend(fg, bg) : fg;
      const ratio = contrast(solid, bg);
      const needed = large ? 3 : 4.5;
      if (ratio < needed) {
        report("contrast", "error", "Text with low contrast",
          `Hard to read for people with low vision, or on a phone in sunlight. Body text needs a contrast ratio of at least 4.5:1, and large text 3:1.`,
          { text: clip(text), fg: hex(solid), bg: hex(bg), ratio: Math.round(ratio * 100) / 100 });
      }
    }
    if (size < 12 && text.trim().length > 2) {
      report("small-text", "warning", "Very small text",
        "Text under 12px is hard to read, and iOS Mail enlarges it anyway, which can break the layout. Use at least 14px for body text.", { text: `${clip(text)} (${Math.round(size * 10) / 10}px)` });
    }
  }

  if (images.length > 0 && visibleText.replace(/\s+/g, "").length < 50) {
    report("image-only", "error", "Email is mostly images",
      "If images are blocked, which many clients do by default, the reader sees an almost empty email, and screen readers have nothing to read. Put the key message in real text.");
  }

  // Document structure, read from the original markup.
  const source = new DOMParser().parseFromString(html, "text/html");
  if (!source.documentElement.getAttribute("lang")) {
    report("lang", "warning", "Language not set",
      'Without lang on the <html> element, screen readers may read the email with the wrong accent and pronunciation. Add, for example, <html lang="en">.');
  }
  if (!source.querySelector("h1, h2, h3, h4, h5, h6, [role=heading]")) {
    report("headings", "warning", "No headings",
      "Screen reader users navigate by headings. Mark up the main title with <h1> rather than only making text big and bold.");
  }
  for (const table of source.querySelectorAll("table")) {
    const role = table.getAttribute("role");
    if (role === "presentation" || role === "none" || table.querySelector("th")) continue;
    report("layout-table", "warning", "Layout table without role=\"presentation\"",
      'Screen readers announce layout tables as data ("table with 3 rows…"), which is noise. Add role="presentation" to tables used for layout.');
  }

  const findings = [...found.values()].sort((a, b) => (a.severity === b.severity ? b.count - a.count : a.severity === "error" ? -1 : 1));
  const penalty = findings.reduce((sum, f) => sum + (f.severity === "error" ? 15 : 5), 0);
  return { score: Math.max(0, 100 - penalty), findings, darkMode: supportsDarkMode(html) };
}
