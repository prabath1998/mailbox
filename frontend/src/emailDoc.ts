export type PreviewTheme = "light" | "dark" | "invert";

const BASE = `body{margin:0;padding:16px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.5}img{max-width:100%;height:auto}`;

const THEME_CSS: Record<PreviewTheme, string> = {
  light: "body{color:#18181b;background:#fff}",
  // Like Apple Mail and Outlook for Mac: unstyled mail turns dark, and the email's own
  // prefers-color-scheme: dark rules apply.
  dark: "body{color:#f2f2f7;background:#1c1c1e}",
  // Like the Gmail and Outlook apps, which invert colours the email didn't plan for.
  // Images are flipped back so photos and logos keep their colours.
  invert:
    'body{color:#18181b;background:#fff}html{filter:invert(1) hue-rotate(180deg)}img,picture,video,[style*="background-image"]{filter:invert(1) hue-rotate(180deg)}',
};

// The email's own prefers-color-scheme queries are rewritten to always or never
// match, so the preview shows the chosen scheme whatever the app's theme is and
// regardless of how the browser propagates color-scheme into iframes.
const ALWAYS = "(min-width: 0px)";
const NEVER = "(max-width: 0px)";

function forceScheme(html: string, dark: boolean) {
  return html.replace(/\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)/gi, (_, scheme: string) =>
    (scheme.toLowerCase() === "dark") === dark ? ALWAYS : NEVER,
  );
}

/** Wraps email HTML in a standalone document for a sandboxed iframe. */
export function emailDocument(html: string, theme: PreviewTheme = "light"): string {
  html = forceScheme(html, theme === "dark");
  return `<!doctype html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<base target="_blank">
<style>${BASE}${THEME_CSS[theme]}</style>
</head><body>${html}</body></html>`;
}

/** Whether the email ships its own dark-mode styles. */
export const supportsDarkMode = (html: string) =>
  /prefers-color-scheme\s*:\s*dark/i.test(html) || /<meta[^>]+name=["']?(supported-)?color-scheme/i.test(html);
