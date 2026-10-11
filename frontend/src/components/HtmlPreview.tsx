import { useRef, useState } from "react";

const wrap = (body: string) => `<!doctype html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<base target="_blank">
<style>body{margin:0;padding:16px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.5;color:#18181b;background:#fff}img{max-width:100%;height:auto}</style>
</head><body>${body}</body></html>`;

// Rendered in a sandboxed iframe with scripts disabled, so email HTML can't run code
// or touch the app. allow-same-origin only lets us measure the content height.
export function HtmlPreview({ html, width }: { html: string; width: "desktop" | "mobile" }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(400);

  const measure = () => {
    const doc = ref.current?.contentDocument;
    if (doc) setHeight(Math.max(200, doc.documentElement.scrollHeight));
  };

  return (
    <div className="flex justify-center">
      <iframe
        ref={ref}
        title="HTML preview"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={wrap(html)}
        onLoad={measure}
        style={{ height }}
        className={`rounded-xl border border-zinc-200 bg-white shadow-sm transition-[width] duration-300 dark:border-zinc-800 ${
          width === "mobile" ? "w-[375px]" : "w-full"
        }`}
      />
    </div>
  );
}
