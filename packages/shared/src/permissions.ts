import type { Role } from "./schemas.js";

export type Action =
  | "member.manage"
  | "event.manage"
  | "task.manage"
  | "task.complete"
  | "task.reassign"
  | "checklist.manage"
  | "checklist.check"
  | "settings.manage";

const CHILD_ALLOWED: ReadonlySet<Action> = new Set([
  "task.complete",
  "task.reassign",
  "checklist.check",
]);

/** Parents can do everything; children can complete/swap chores and check lists. */
export function can(role: Role, action: Action): boolean {
  return role === "parent" || CHILD_ALLOWED.has(action);
}

/** Actions a kiosk/device session may perform (attributed to the display). */
const DEVICE_ALLOWED: ReadonlySet<Action> = new Set(["task.complete", "checklist.check"]);

export function deviceCan(action: Action): boolean {
  return DEVICE_ALLOWED.has(action);
}
