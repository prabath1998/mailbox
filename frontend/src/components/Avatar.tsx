import { avatarHue, initials } from "../format";

export function Avatar({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  const hue = avatarHue(name);
  const dims = size === "lg" ? "size-11 text-sm" : "size-9 text-xs";
  return (
    <div
      className={`${dims} flex shrink-0 items-center justify-center rounded-full font-semibold text-white`}
      style={{ background: `linear-gradient(135deg, hsl(${hue} 75% 60%), hsl(${hue + 30} 70% 50%))` }}
    >
      {initials(name)}
    </div>
  );
}
