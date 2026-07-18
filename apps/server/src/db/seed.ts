/**
 * Seeds a demo family so the app is explorable immediately after `pnpm dev`.
 * The family is picked at random from a few generic ones; the credentials
 * are always the same:
 *   Parents: password family123
 *   Teen:    PIN 1111 · Little kid: pattern cat → horse → cat → goat
 */
import { openDb, now, uid } from "../core/db.js";
import { hashCredential } from "../core/auth.js";
import { createBus } from "../core/bus.js";
import { createEvent } from "../modules/calendar/service.js";
import { utcOfWall, wallPartsOf } from "../core/tz.js";
import { config } from "../config.js";

const TZ = process.env.TZ_SEED ?? "America/New_York";
const db = openDb(process.env.DATABASE_PATH ?? config.databasePath);

if (db.prepare("SELECT 1 FROM households LIMIT 1").get()) {
  console.log("Database already has a household — nothing to seed.");
  process.exit(0);
}

// A different generic demo family each seed — same credentials always.
const FAMILIES = [
  { surname: "Johnson", parents: ["Dana", "Chris"], teen: "Riley", little: "Charlie" },
  { surname: "Smith", parents: ["Taylor", "Jordan"], teen: "Casey", little: "Frankie" },
  { surname: "Miller", parents: ["Morgan", "Jamie"], teen: "Avery", little: "Ollie" },
  { surname: "Rivera", parents: ["Alex", "Robin"], teen: "Nova", little: "Max" },
] as const;
const fam = FAMILIES[Math.floor(Math.random() * FAMILIES.length)]!;

const householdId = uid();
db.prepare("INSERT INTO households (id, name, timezone, created_at) VALUES (?, ?, ?, ?)").run(
  householdId, `The ${fam.surname} Family`, TZ, now(),
);

function addMember(
  name: string, role: "parent" | "child", color: string, avatar: string,
  credential: string, order: number,
  credentialType: "password" | "pin" | "pattern" = role === "child" ? "pin" : "password",
  grants: string[] = [],
  uiLevel: "little" | "teen" | null = null,
) {
  const id = uid();
  db.prepare(
    `INSERT INTO members (id, household_id, name, role, color, avatar, credential_hash, credential_type, sort_order, grants_json, ui_level, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, householdId, name, role, color, avatar, hashCredential(credential),
    credentialType, order, grants.length ? JSON.stringify(grants) : null, uiLevel, now());
  return id;
}

const parent1 = addMember(fam.parents[0], "parent", "#6f9ccb", "🦉", "family123", 0);
const parent2 = addMember(fam.parents[1], "parent", "#c98bb5", "🦊", "family123", 1);
// Teen tier: PIN + allowed to manage lists. Little-kid tier: a picture
// pattern (cat→horse→cat→goat).
const teen = addMember(fam.teen, "child", "#dda15e", "🦄", "1111", 2, "pin", ["checklist.manage"], "teen");
const little = addMember(fam.little, "child", "#7fb069", "🐸", "pat:0304", 3, "pattern", [], "little");

// ---- Events ----
const bus = createBus();
const actor = { memberId: parent1, name: fam.parents[0] };
const today = wallPartsOf(now(), TZ);
const at = (dayOffset: number, hour: number, minute = 0) =>
  utcOfWall({ ...today, day: today.day + dayOffset, hour, minute, second: 0 }, TZ);

createEvent(db, bus, householdId, actor, {
  title: "Soccer practice", description: "Bring water bottle and shin guards!", location: "Riverside Park",
  category: "sports", startAt: at(1, 17), endAt: at(1, 18, 30), allDay: false, timezone: TZ,
  rrule: "FREQ=WEEKLY", assigneeIds: [little], reminderMinutes: 60,
});
createEvent(db, bus, householdId, actor, {
  title: "Piano lesson", description: "", location: "the music studio",
  category: "school", startAt: at(2, 16), endAt: at(2, 16, 45), allDay: false, timezone: TZ,
  rrule: "FREQ=WEEKLY", assigneeIds: [teen], reminderMinutes: 30,
});
createEvent(db, bus, householdId, actor, {
  title: "Family pizza night", description: "Everyone picks one topping 🍕", location: "Home",
  category: "family", startAt: at(4, 18), endAt: at(4, 20), allDay: false, timezone: TZ,
  rrule: "FREQ=WEEKLY", assigneeIds: [], reminderMinutes: null,
});
createEvent(db, bus, householdId, actor, {
  title: `Dentist — ${fam.teen}`, description: "Checkup", location: "Bright Smiles Dental",
  category: "appointment", startAt: at(6, 10), endAt: at(6, 11), allDay: false, timezone: TZ,
  rrule: null, assigneeIds: [teen, parent2], reminderMinutes: 120,
});
createEvent(db, bus, householdId, actor, {
  title: "Grandma's birthday", description: "Call in the morning! 🎂", location: "",
  category: "birthday", startAt: at(9, 0), endAt: at(10, 0), allDay: true, timezone: TZ,
  rrule: null, assigneeIds: [], reminderMinutes: null,
});
// Private: only its creator (and other parents/AIs) ever receive this one.
createEvent(db, bus, householdId, actor, {
  title: "Mortgage payment due", description: "", location: "",
  category: "other", visibility: "private", startAt: at(3, 9), endAt: at(3, 9, 30), allDay: false,
  timezone: TZ, rrule: null, assigneeIds: [], reminderMinutes: 60,
});

// ---- Chores & to-dos ----
function addTask(title: string, icon: string, kind: "chore" | "todo", assignee: string | null, repeat: string | null, dueAt: number | null, points: number | null) {
  const id = uid();
  db.prepare(
    `INSERT INTO tasks (id, household_id, title, notes, icon, kind, assignee_id, due_at, repeat, points, created_by, created_at)
     VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, householdId, title, icon, kind, assignee, dueAt, repeat, points, parent1, now());
  return id;
}

addTask("Feed the dog", "🐶", "chore", teen, "daily", null, 5);
addTask("Set the table", "🍽️", "chore", teen, "weekdays", null, 5);
addTask("Take out the trash", "🗑️", "chore", little, "1,4", null, 10); // Mon & Thu
addTask("Make your bed", "🛏️", "chore", little, "daily", null, 5);
addTask("Water the plants", "🪴", "chore", null, "0", null, 5); // Sundays, up for grabs
addTask(`Sign ${fam.teen}'s permission slip`, "✍️", "todo", parent2, null, at(1, 8), null);

// Family chore: unassigned as a whole, each step belongs to a kid and
// carries its own points — it greens up only when every step is done.
db.prepare(
  `INSERT INTO tasks (id, household_id, title, notes, icon, kind, assignee_id, repeat, points, steps_json, created_by, created_at)
   VALUES (?, ?, 'Clean the kitchen', '', '🧽', 'chore', NULL, 'daily', NULL, ?, ?, ?)`,
).run(uid(), householdId, JSON.stringify([
  { text: "Sweep the floor", assigneeId: teen, points: 5 },
  { text: "Load the dishes", assigneeId: little, points: 5 },
  { text: "Wipe the counters", assigneeId: null, points: 3 },
]), parent1, now());

// ---- Points: a goal + a little history so the page isn't empty ----
db.prepare(
  `INSERT INTO point_goals (id, household_id, title, icon, mode, target, member_ids_json, starts_at, ends_at, repeat, reward, created_at)
   VALUES (?, ?, 'Movie night fund', '🍿', 'target', 40, NULL, ?, NULL, 'monthly', 'Pick the Friday movie', ?)`,
).run(uid(), householdId, now() - 3 * 86_400_000, now());
db.prepare(
  `INSERT INTO points_ledger (household_id, member_id, delta, reason, source, created_by, created_at)
   VALUES (?, ?, 8, 'Helped carry groceries', 'manual', ?, ?)`,
).run(householdId, teen, parent2, now() - 86_400_000);
db.prepare(
  `INSERT INTO points_ledger (household_id, member_id, delta, reason, source, created_by, created_at)
   VALUES (?, ?, 6, 'Read to a little cousin', 'manual', ?, ?)`,
).run(householdId, little, parent1, now() - 2 * 86_400_000);

// ---- Lists ----
function addList(title: string, icon: string, kind: string, pinned: boolean, needBy: number | null, items: [string, string | null, string | null][]) {
  const id = uid();
  db.prepare(
    "INSERT INTO checklists (id, household_id, title, icon, kind, pinned_to_dashboard, need_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, householdId, title, icon, kind, pinned ? 1 : 0, needBy, now());
  items.forEach(([text, quantity, store], i) => {
    db.prepare(
      "INSERT INTO checklist_items (id, checklist_id, text, quantity, store, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(uid(), id, text, quantity, store, i, now());
  });
  return id;
}

addList("Groceries", "🛒", "shopping", true, null, [
  ["Milk", "2 gal", "Costco"], ["Eggs", "1 dozen", "Costco"], ["Bananas", null, null],
  ["Bread", null, "Walmart"], ["Pizza dough", "2", null], ["Dog food", null, "Costco"],
]);
addList("Beach trip packing", "🏖️", "packing", false, at(5, 12), [
  ["Sunscreen", null, "Walmart"], ["Towels", "4", null], ["Snacks", null, null], ["Sand toys", null, null],
]);

console.log(`Seeded demo family: The ${fam.surname} Family ✔`);
console.log(`  Parents: ${fam.parents[0]}, ${fam.parents[1]} — password: family123`);
console.log(`  Kids: ${fam.teen} (PIN 1111, can manage lists), ${fam.little} (pattern: cat → horse → cat → goat)`);
