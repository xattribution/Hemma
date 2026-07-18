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

/** Extra capabilities a parent can grant a kid (the family "rwx"). */
export type Grant = "event.manage" | "task.manage" | "checklist.manage" | "messages.use";

export const GRANTS: { key: Grant; label: string }[] = [
  { key: "event.manage", label: "Add & edit calendar events" },
  { key: "task.manage", label: "Add & edit chores" },
  { key: "checklist.manage", label: "Create & manage lists" },
  { key: "messages.use", label: "Message other families (parents can read everything)" },
];

const CHILD_ALLOWED: ReadonlySet<Action> = new Set([
  "task.complete",
  "task.reassign",
  "checklist.check",
]);

/**
 * Parents can do everything; children can complete/swap chores and check
 * lists, plus whatever their parents have granted them.
 */
export function can(role: Role, action: Action, grants: readonly Grant[] = []): boolean {
  if (role === "parent") return true;
  if (CHILD_ALLOWED.has(action)) return true;
  return (grants as readonly Action[]).includes(action);
}

/** Actions a kiosk/device session may perform (attributed to the display). */
const DEVICE_ALLOWED: ReadonlySet<Action> = new Set(["task.complete", "checklist.check"]);

export function deviceCan(action: Action): boolean {
  return DEVICE_ALLOWED.has(action);
}
