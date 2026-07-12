import { useState } from "react";

const THEMES = [
  { id: "light", icon: "☀️", label: "Light" },
  { id: "midnight", icon: "🌙", label: "Midnight" },
  { id: "forest", icon: "🌲", label: "Forest" },
  { id: "plum", icon: "🍇", label: "Plum" },
] as const;

export function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || "light");
  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0];
  const cycle = () => {
    const next = THEMES[(THEMES.findIndex((t) => t.id === current.id) + 1) % THEMES.length]!;
    setTheme(next.id);
    document.documentElement.dataset.theme = next.id === "light" ? "" : next.id;
    localStorage.setItem("coord.theme", next.id);
  };
  return (
    <button type="button" onClick={cycle} title={`Theme: ${current.label} — tap to change`}
      className="rounded-xl bg-card px-2.5 py-2 text-base shadow-card transition active:scale-95">
      {current.icon}
    </button>
  );
}
