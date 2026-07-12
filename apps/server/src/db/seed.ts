/**
 * Seeds a demo family so the app is explorable immediately after `pnpm dev`.
 *   Parents: Jared / Sam  (password: family123)
 *   Kids:    Mia (PIN 1111), Leo (PIN 2222)
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

const householdId = uid();
db.prepare("INSERT INTO households (id, name, timezone, created_at) VALUES (?, ?, ?, ?)").run(
  householdId, "The Kotvas Family", TZ, now(),
);

function addMember(name: string, role: "parent" | "child", color: string, avatar: string, credential: string, order: number) {
  const id = uid();
  db.prepare(
    `INSERT INTO members (id, household_id, name, role, color, avatar, credential_hash, credential_type, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, householdId, name, role, color, avatar, hashCredential(credential),
    role === "child" ? "pin" : "password", order, now());
  return id;
}

const jared = addMember("Jared", "parent", "#3d87c9", "🦉", "family123", 0);
const sam = addMember("Sam", "parent", "#c364ab", "🦊", "family123", 1);
const mia = addMember("Mia", "child", "#e08f3c", "🦄", "1111", 2);
const leo = addMember("Leo", "child", "#5aa832", "🐸", "2222", 3);

// ---- Events ----
const bus = createBus();
const actor = { memberId: jared, name: "Jared" };
const today = wallPartsOf(now(), TZ);
const at = (dayOffset: number, hour: number, minute = 0) =>
  utcOfWall({ ...today, day: today.day + dayOffset, hour, minute, second: 0 }, TZ);

createEvent(db, bus, householdId, actor, {
  title: "Soccer practice", description: "Bring water bottle and shin guards!", location: "Riverside Park",
  category: "sports", startAt: at(1, 17), endAt: at(1, 18, 30), allDay: false, timezone: TZ,
  rrule: "FREQ=WEEKLY", assigneeIds: [leo], reminderMinutes: 60,
});
createEvent(db, bus, householdId, actor, {
  title: "Piano lesson", description: "", location: "Ms. Rivera's studio",
  category: "school", startAt: at(2, 16), endAt: at(2, 16, 45), allDay: false, timezone: TZ,
  rrule: "FREQ=WEEKLY", assigneeIds: [mia], reminderMinutes: 30,
});
createEvent(db, bus, householdId, actor, {
  title: "Family pizza night", description: "Everyone picks one topping 🍕", location: "Home",
  category: "family", startAt: at(4, 18), endAt: at(4, 20), allDay: false, timezone: TZ,
  rrule: "FREQ=WEEKLY", assigneeIds: [], reminderMinutes: null,
});
createEvent(db, bus, householdId, actor, {
  title: "Dentist — Mia", description: "Checkup", location: "Bright Smiles Dental",
  category: "appointment", startAt: at(6, 10), endAt: at(6, 11), allDay: false, timezone: TZ,
  rrule: null, assigneeIds: [mia, sam], reminderMinutes: 120,
});
createEvent(db, bus, householdId, actor, {
  title: "Grandma's birthday", description: "Call in the morning! 🎂", location: "",
  category: "birthday", startAt: at(9, 0), endAt: at(10, 0), allDay: true, timezone: TZ,
  rrule: null, assigneeIds: [], reminderMinutes: null,
});

// ---- Chores & to-dos ----
function addTask(title: string, icon: string, kind: "chore" | "todo", assignee: string | null, repeat: string | null, dueAt: number | null, points: number | null) {
  const id = uid();
  db.prepare(
    `INSERT INTO tasks (id, household_id, title, notes, icon, kind, assignee_id, due_at, repeat, points, created_by, created_at)
     VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, householdId, title, icon, kind, assignee, dueAt, repeat, points, jared, now());
  return id;
}

addTask("Feed the dog", "🐶", "chore", mia, "daily", null, 5);
addTask("Set the table", "🍽️", "chore", mia, "weekdays", null, 5);
addTask("Take out the trash", "🗑️", "chore", leo, "1,4", null, 10); // Mon & Thu
addTask("Make your bed", "🛏️", "chore", leo, "daily", null, 5);
addTask("Water the plants", "🪴", "chore", null, "0", null, 5); // Sundays, up for grabs
addTask("Sign Mia's permission slip", "✍️", "todo", sam, null, at(1, 8), null);

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

console.log("Seeded demo family ✔");
console.log("  Parents: Jared, Sam — password: family123");
console.log("  Kids: Mia (PIN 1111), Leo (PIN 2222)");
