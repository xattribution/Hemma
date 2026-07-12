import { useState } from "react";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === "dark");
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "";
    localStorage.setItem("coord.theme", next ? "dark" : "light");
  };
  return (
    <button type="button" onClick={toggle} title={dark ? "Light mode" : "Dark mode"}
      className="rounded-xl bg-card p-2 text-ink-soft shadow-card transition hover:text-ink active:scale-95">
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
