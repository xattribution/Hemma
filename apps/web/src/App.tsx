import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "./api/client";
import { useMe, useSetupStatus } from "./api/queries";
import { WsProvider } from "./api/ws";
import { Shell } from "./layout/Shell";
import { SetupPage } from "./features/auth/SetupPage";
import { LoginPage } from "./features/auth/LoginPage";
import { CalendarPage } from "./features/calendar/CalendarPage";
import { TasksPage } from "./features/tasks/TasksPage";
import { ListsPage } from "./features/lists/ListsPage";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import { HistoryPage } from "./features/history/HistoryPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { KidApp } from "./features/kid/KidApp";
import { PointsPage } from "./features/points/PointsPage";

export function App() {
  const qc = useQueryClient();
  const setup = useSetupStatus();
  const [deviceAuthPending, setDeviceAuthPending] = useState(
    () => new URLSearchParams(location.search).has("device"),
  );
  // Hold the session query until a pending kiosk-token exchange has set the
  // cookie, so its 401 can't race the exchange and strand the kiosk on login.
  const me = useMe(!deviceAuthPending);

  // A kiosk opens /dashboard?device=<token> once; we exchange it for a
  // session cookie and strip the token from the URL/history.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const token = params.get("device");
    if (!token) return;
    void api("/api/auth/device", { method: "POST", body: { token } })
      .catch(() => undefined)
      .then(() => {
        params.delete("device");
        history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
        void qc.invalidateQueries();
        setDeviceAuthPending(false);
      });
  }, [qc]);

  if (setup.isLoading || me.isLoading || deviceAuthPending) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-5xl">
        <span className="animate-pop">🦡</span>
      </div>
    );
  }
  if (setup.data?.needed) return <SetupPage />;
  if (!me.data) return <LoginPage />;

  // Kiosk sessions get exactly one screen: the dashboard.
  if (me.data.kind === "device") {
    return (
      <WsProvider enabled>
        <Routes>
          <Route path="*" element={<DashboardPage />} />
        </Routes>
      </WsProvider>
    );
  }

  // Little kids get their own Fisher-Price-scale app: giant targets, no menus.
  if (me.data.member.role === "child" && me.data.member.uiLevel === "little") {
    return (
      <WsProvider enabled>
        <KidApp me={me.data} />
      </WsProvider>
    );
  }

  return (
    <WsProvider enabled>
      <Routes>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route element={<Shell me={me.data} />}>
          <Route path="/" element={<Navigate to="/calendar" replace />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/calendar/:view/:date" element={<CalendarPage />} />
          <Route path="/chores" element={<TasksPage me={me.data} />} />
          <Route path="/lists" element={<ListsPage me={me.data} />} />
          <Route path="/points" element={<PointsPage me={me.data} />} />
          {me.data.member.role !== "child" && <Route path="/history" element={<HistoryPage />} />}
          {me.data.member.role !== "child" && <Route path="/settings" element={<SettingsPage me={me.data} />} />}
          <Route path="*" element={<Navigate to="/calendar" replace />} />
        </Route>
      </Routes>
    </WsProvider>
  );
}
