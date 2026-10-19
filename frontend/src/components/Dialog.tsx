import { useEffect, useId, useRef, useState, type ReactNode } from "react";

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

/** Modal shell: traps Tab, closes on Escape or backdrop click, restores focus on close. */
export function Dialog({ title, onClose, children, className = "max-w-sm" }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Captured during render, before React moves focus to an autoFocus child.
  const [previous] = useState(() => document.activeElement as HTMLElement | null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const node = ref.current;
    // React focuses an autoFocus child itself; otherwise focus the dialog.
    if (!node?.contains(document.activeElement)) node?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      }
      if (e.key !== "Tab" || !node) return;
      const items = node.querySelectorAll<HTMLElement>("button, a[href], input, [tabindex]:not([tabindex='-1'])");
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      previous?.focus();
    };
  }, [previous]);

  return (
    <div className="animate-fade fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4 backdrop-blur-[2px] dark:bg-black/50" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`animate-pop w-full rounded-2xl border border-line bg-raised p-5 shadow-float outline-none ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-[15px] font-semibold">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
