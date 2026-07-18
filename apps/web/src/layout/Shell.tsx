import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet } from "react-router";
import { CalendarDays, ClipboardList, History, ListChecks, LogOut, Settings, Star, UsersRound } from "lucide-react";
import type { Me } from "@coord/shared";
import { Avatar } from "../components/Avatar";
import { SwitchPersonModal } from "../components/SwitchPersonModal";
import { ThemeToggle } from "../components/ThemeToggle";
import { useLogout } from "../api/queries";

const ALL_TABS = [
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/chores", label: "Chores", icon: ClipboardList },
  { to: "/lists", label: "Lists", icon: ListChecks },
  { to: "/points", label: "Points", icon: Star },
  { to: "/history", label: "History", icon: History },
  { to: "/settings", label: "Settings", icon: Settings },
];
// Kids get the essentials: calendar, chores, lists, points. History and
// every setting (including their own sign-in) stays parent-controlled.
const KID_TABS = ALL_TABS.slice(0, 4);

export function Shell({ me }: { me: Extract<Me, { kind: "member" }> }) {
  const logout = useLogout();
  const tabs = me.member.role === "child" ? KID_TABS : ALL_TABS;
  const [menuOpen, setMenuOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  return (
    <div className="shell-frame mx-auto flex min-h-dvh max-w-7xl flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 pb-3 pt-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-2xl">🏡</span>
          <h1 className="truncate text-lg font-extrabold leading-tight">{me.household.name}</h1>
        </div>
        <nav className="hidden gap-5 sm:flex">
          {tabs.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `-mb-3 flex items-center gap-1.5 border-b-2 px-0.5 pb-3 text-sm font-bold transition ${
                  isActive ? "border-sky text-ink" : "border-transparent text-ink-soft hover:text-ink"
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>
        <ThemeToggle />
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            title="Account"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="transition hover:scale-105 active:scale-95"
          >
            <Avatar member={me.member} />
          </button>
          {menuOpen && (
            <div role="menu" className="animate-slide-up absolute right-0 top-12 z-40 w-48 rounded-card bg-card p-1.5 shadow-card">
              <div className="flex items-center gap-2 border-b-2 border-line px-2.5 pb-2 pt-1">
                <Avatar member={me.member} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-extrabold">{me.member.name}</p>
                  <p className="text-[11px] font-bold capitalize text-ink-soft">{me.member.role}</p>
                </div>
              </div>
              {/* On phones the bottom bar keeps only the daily four — the
                  rest lives here instead of crowding the thumb row. */}
              {me.member.role !== "child" && (
                <div className="sm:hidden">
                  <NavLink to="/history" onClick={() => setMenuOpen(false)}
                    className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-sm font-bold hover:bg-cream">
                    <History size={16} className="text-ink-soft" /> History
                  </NavLink>
                  <NavLink to="/settings" onClick={() => setMenuOpen(false)}
                    className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-sm font-bold hover:bg-cream">
                    <Settings size={16} className="text-ink-soft" /> Settings
                  </NavLink>
                </div>
              )}
              <button type="button" role="menuitem"
                onClick={() => { setMenuOpen(false); setSwitching(true); }}
                className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-sm font-bold hover:bg-cream">
                <UsersRound size={16} className="text-ink-soft" /> Switch person
              </button>
              <button type="button" role="menuitem"
                onClick={() => { setMenuOpen(false); logout.mutate(); }}
                className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-sm font-bold text-coral hover:bg-coral-soft">
                <LogOut size={16} /> Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      {switching && <SwitchPersonModal currentId={me.member.id} onClose={() => setSwitching(false)} />}

      <main className="flex-1 px-3 pb-24 sm:px-6 sm:pb-8">
        <Outlet />
      </main>

      {/* Mobile bottom nav — the daily four only; the rest is in the avatar menu */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-line bg-card/95 px-2 py-1.5 backdrop-blur sm:hidden">
        {tabs.slice(0, 4).map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[11px] font-bold ${
                isActive ? "text-sky" : "text-ink-soft"
              }`
            }
          >
            <Icon size={22} />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
