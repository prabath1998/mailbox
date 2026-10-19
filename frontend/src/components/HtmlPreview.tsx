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
  const mobile = width === "mobile";

  const measure = () => {
    const doc = ref.current?.contentDocument;
    if (doc?.body) setHeight(Math.max(240, doc.body.offsetHeight));
  };

  return (
    <div className="flex justify-center">
      <div
        className={`overflow-hidden bg-white shadow-pop transition-[width,border-radius] duration-300 ${
          mobile ? "w-97.75 rounded-[28px] border-8 border-ink/90 dark:border-line-strong" : "w-full max-w-250 rounded-xl border border-line"
        }`}
      >
        <iframe
          ref={ref}
          title="Email preview"
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          srcDoc={wrap(html)}
          onLoad={measure}
          style={{ height }}
          className="block w-full"
        />
      </div>
    </div>
  );
}
