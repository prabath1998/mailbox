import { useRef, useState } from "react";
import { emailDocument, type PreviewTheme } from "../emailDoc";

// Rendered in a sandboxed iframe with scripts disabled, so email HTML can't run code
// or touch the app. allow-same-origin only lets us measure the content height.
export function HtmlPreview({ html, width, theme = "light" }: { html: string; width: "desktop" | "mobile"; theme?: PreviewTheme }) {
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
        className={`overflow-hidden shadow-pop transition-[width,border-radius] duration-300 ${theme === "dark" ? "bg-[#1c1c1e]" : "bg-white"} ${
          mobile ? "w-97.75 rounded-[28px] border-8 border-ink/90 dark:border-line-strong" : "w-full max-w-250 rounded-xl border border-line"
        }`}
      >
        <iframe
          ref={ref}
          title="Email preview"
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          srcDoc={emailDocument(html, theme)}
          onLoad={measure}
          // Set explicitly: otherwise the iframe inherits the app's dark theme, and the
          // email's dark-mode styles would apply in the light preview too.
          style={{ height, colorScheme: theme === "dark" ? "dark" : "light" }}
          className="block w-full"
        />
      </div>
    </div>
  );
}
