import { useEffect, useRef, useState } from "react";

const THEMES = [
  { id: "light", icon: "☀️", label: "Light" },
  { id: "paper", icon: "📄", label: "Paper" },
  { id: "earth", icon: "🌾", label: "Earth" },
  { id: "midnight", icon: "🌙", label: "Midnight" },
  { id: "forest", icon: "🌲", label: "Forest" },
  { id: "plum", icon: "🍇", label: "Plum" },
] as const;

/** Per-person/per-device theme picker: tap → choose by icon. */
export function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || "light");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0];

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const pick = (id: string) => {
    setTheme(id);
    document.documentElement.dataset.theme = id === "light" ? "" : id;
    localStorage.setItem("coord.theme", id);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} title={`Theme: ${current.label}`}
        className="rounded-xl bg-card px-2.5 py-2 text-base shadow-card transition active:scale-95">
        {current.icon}
      </button>
      {open && (
        <div className="animate-slide-up absolute right-0 top-12 z-40 flex gap-1 rounded-card bg-card p-1.5 shadow-card">
          {THEMES.map((t) => (
            <button key={t.id} type="button" onClick={() => pick(t.id)} title={t.label}
              className={`flex h-11 w-11 items-center justify-center rounded-xl text-xl transition active:scale-90 ${
                t.id === current.id ? "bg-coral-soft ring-2 ring-coral" : "hover:bg-cream"
              }`}>
              {t.icon}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
