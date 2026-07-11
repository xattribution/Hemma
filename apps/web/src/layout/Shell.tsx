import { NavLink, Outlet } from "react-router";
import { CalendarDays, ClipboardList, History, ListChecks, Settings } from "lucide-react";
import type { Me } from "@coord/shared";
import { Avatar } from "../components/Avatar";
import { useLogout } from "../api/queries";

const tabs = [
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/chores", label: "Chores", icon: ClipboardList },
  { to: "/lists", label: "Lists", icon: ListChecks },
  { to: "/history", label: "History", icon: History },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function Shell({ me }: { me: Extract<Me, { kind: "member" }> }) {
  const logout = useLogout();

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col">
      <header className="flex items-center justify-between px-4 pb-2 pt-4 sm:px-6">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🏡</span>
          <div>
            <h1 className="text-lg font-extrabold leading-tight">{me.household.name}</h1>
            <p className="text-xs font-semibold text-ink-soft">Hi, {me.member.name}!</p>
          </div>
        </div>
        <nav className="hidden gap-1 sm:flex">
          {tabs.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-bold transition ${
                  isActive ? "bg-coral text-white shadow-card" : "text-ink-soft hover:bg-line"
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>
        <button
          type="button"
          onClick={() => logout.mutate()}
          title="Switch person"
          className="transition hover:scale-105 active:scale-95"
        >
          <Avatar member={me.member} />
        </button>
      </header>

      <main className="flex-1 px-3 pb-24 sm:px-6 sm:pb-8">
        <Outlet />
      </main>

      {/* Mobile bottom nav — big, thumb-friendly targets */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t-2 border-line bg-card/95 px-2 py-1.5 backdrop-blur sm:hidden">
        {tabs.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 text-[11px] font-bold ${
                isActive ? "text-coral" : "text-ink-soft"
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
