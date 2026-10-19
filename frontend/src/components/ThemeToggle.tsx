import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

const OPTIONS = [
  { id: "light", label: "Light", icon: Sun },
  { id: "system", label: "System", icon: Monitor },
  { id: "dark", label: "Dark", icon: Moon },
] as const;

function stored(): Theme {
  try {
    const t = localStorage.getItem("theme");
    if (t === "light" || t === "dark") return t;
  } catch {}
  return "system";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(stored);

  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0f1217" : "#f5f6f8");
    };
    apply();
    try {
      if (theme === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", theme);
    } catch {}
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  return (
    <div role="radiogroup" aria-label="Theme" className="flex rounded-lg bg-sunken p-0.5">
      {OPTIONS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          role="radio"
          aria-checked={theme === id}
          aria-label={label}
          title={label}
          onClick={() => setTheme(id)}
          className={`flex size-7 items-center justify-center rounded-md transition-colors ${
            theme === id ? "bg-raised text-ink shadow-sm" : "text-faint hover:text-ink"
          }`}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}
