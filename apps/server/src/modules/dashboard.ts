import type { DashboardToday } from "@coord/shared";
import type { CoreModule } from "../core/plugin-host.js";
import { requireAccess, toMember, type MemberRow } from "../core/auth.js";
import { getHousehold } from "../core/household.js";
import { now } from "../core/db.js";
import { isoDateOf, utcOfWall, wallPartsOf } from "../core/tz.js";
import { listInstances } from "./calendar/service.js";
import { listTasksFor } from "./tasks.js";
import { loadChecklists } from "./checklists.js";

export const dashboardModule: CoreModule = {
  id: "core.dashboard",
  name: "Kitchen dashboard",
  description: "The always-on family view: today at a glance.",
  register({ app, db }) {
    app.get("/api/dashboard/today", (req, reply) => {
      if (!requireAccess(db, req, reply)) return;
      const household = getHousehold(db)!;
      const tz = household.timezone;
      const nowMs = now();

      const today = wallPartsOf(nowMs, tz);
      const dayStart = utcOfWall({ ...today, hour: 0, minute: 0, second: 0 }, tz);
      const tomorrowStart = utcOfWall({ ...today, day: today.day + 1, hour: 0, minute: 0, second: 0 }, tz);
      const dayAfterStart = utcOfWall({ ...today, day: today.day + 2, hour: 0, minute: 0, second: 0 }, tz);

      const isoDate = isoDateOf(nowMs, tz);
      const tasks = listTasksFor(db, household.id, isoDate, tz);
      const members = (
        db.prepare("SELECT * FROM members WHERE deleted_at IS NULL ORDER BY sort_order, created_at").all() as MemberRow[]
      ).map(toMember);

      const payload: DashboardToday = {
        date: isoDate,
        household: { name: household.name, timezone: tz },
        events: listInstances(db, household.id, dayStart, tomorrowStart),
        tomorrowEvents: listInstances(db, household.id, tomorrowStart, dayAfterStart),
        choresByMember: members.map((member) => ({
          member,
          tasks: tasks.filter((t) => t.assigneeId === member.id && t.dueToday),
        })),
        pinnedLists: loadChecklists(db, household.id, true),
      };
      return payload;
    });
  },
};
