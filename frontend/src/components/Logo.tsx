import { Mail } from "lucide-react";

/** An air-mail envelope: striped border, plain centre. */
export function Logo({ className = "size-8" }: { className?: string }) {
  return (
    <div aria-hidden className={`airmail shrink-0 rounded-[9px] p-[3px] ${className}`}>
      <div className="flex size-full items-center justify-center rounded-[6px] bg-surface text-accent">
        <Mail className="size-[55%]" strokeWidth={2.25} />
      </div>
    </div>
  );
}
