import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type Db = Database.Database;

const SCHEMA_VERSION = 10;

const SCHEMA = /* sql */ `
CREATE TABLE households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('parent','child')),
  color TEXT NOT NULL,
  avatar TEXT NOT NULL,
  credential_hash TEXT NOT NULL,
  credential_type TEXT NOT NULL CHECK (credential_type IN ('password','pin')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  member_id TEXT REFERENCES members(id),
  kind TEXT NOT NULL CHECK (kind IN ('member','device')),
  label TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE device_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  created_by TEXT REFERENCES members(id),
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'family',
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0,
  timezone TEXT NOT NULL,
  rrule TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX idx_events_range ON events(household_id, start_at) WHERE deleted_at IS NULL;

CREATE TABLE event_exceptions (
  event_id TEXT NOT NULL REFERENCES events(id),
  occurrence_start INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('cancelled','moved')),
  override_json TEXT,
  PRIMARY KEY (event_id, occurrence_start)
);

CREATE TABLE event_assignees (
  event_id TEXT NOT NULL REFERENCES events(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  PRIMARY KEY (event_id, member_id)
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '⭐',
  kind TEXT NOT NULL CHECK (kind IN ('chore','todo')),
  assignee_id TEXT REFERENCES members(id),
  due_at INTEGER,
  repeat TEXT,
  points INTEGER,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE task_completions (
  task_id TEXT NOT NULL REFERENCES tasks(id),
  occurrence_date TEXT NOT NULL DEFAULT '',
  completed_by TEXT,
  completed_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, occurrence_date)
);

CREATE TABLE checklists (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  title TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '🛒',
  kind TEXT NOT NULL DEFAULT 'shopping',
  pinned_to_dashboard INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE checklist_items (
  id TEXT PRIMARY KEY,
  checklist_id TEXT NOT NULL REFERENCES checklists(id),
  text TEXT NOT NULL,
  checked INTEGER NOT NULL DEFAULT 0,
  checked_by TEXT,
  checked_at INTEGER,
  quantity TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE reminders (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('event','task')),
  entity_id TEXT NOT NULL,
  offset_minutes INTEGER NOT NULL,
  target TEXT NOT NULL DEFAULT 'assignees'
);
CREATE INDEX idx_reminders_entity ON reminders(entity_type, entity_id);

CREATE TABLE reminder_fires (
  reminder_id TEXT NOT NULL REFERENCES reminders(id),
  occurrence_at INTEGER NOT NULL,
  fired_at INTEGER NOT NULL,
  PRIMARY KEY (reminder_id, occurrence_at)
);

CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  member_id TEXT REFERENCES members(id),
  keys_json TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id TEXT NOT NULL,
  actor_member_id TEXT,
  actor_name TEXT NOT NULL DEFAULT '',
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  diff_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_audit_recent ON audit_log(household_id, created_at DESC);

CREATE TABLE plugin_settings (
  plugin_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  PRIMARY KEY (plugin_id, key)
);
`;

export function openDb(dbPath: string): Db {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(db: Db) {
  const version = db.pragma("user_version", { simple: true }) as number;
  if (version < 1) {
    db.exec(SCHEMA);
  }
  if (version < 2) {
    db.exec(/* sql */ `
      -- Display links are retrievable/shareable (home-server trust model)
      -- and carry per-display content settings.
      ALTER TABLE device_tokens ADD COLUMN token TEXT;
      ALTER TABLE device_tokens ADD COLUMN config_json TEXT;
      ALTER TABLE sessions ADD COLUMN device_token_id TEXT;
      -- Lists can have an optional "need by" date; items an optional store tag.
      ALTER TABLE checklists ADD COLUMN need_by INTEGER;
      ALTER TABLE checklist_items ADD COLUMN store TEXT;
      -- Bearer tokens for AI/automation clients (MCP, scripts).
      CREATE TABLE IF NOT EXISTS api_tokens (
        id TEXT PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        created_by TEXT,
        created_at INTEGER NOT NULL,
        revoked_at INTEGER
      );
    `);
  }
  if (version < 3) {
    // Picture-pattern credentials, per-kid grants, display elevation.
    // members is rebuilt to widen the credential_type CHECK constraint.
    db.pragma("foreign_keys = OFF");
    db.exec(/* sql */ `
      ALTER TABLE sessions ADD COLUMN elevated_member_id TEXT;
      ALTER TABLE sessions ADD COLUMN elevated_until INTEGER;
      ALTER TABLE members ADD COLUMN grants_json TEXT;

      CREATE TABLE members_v3 (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL REFERENCES households(id),
        name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('parent','child')),
        color TEXT NOT NULL,
        avatar TEXT NOT NULL,
        credential_hash TEXT NOT NULL,
        credential_type TEXT NOT NULL CHECK (credential_type IN ('password','pin','pattern')),
        sort_order INTEGER NOT NULL DEFAULT 0,
        grants_json TEXT,
        created_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
      INSERT INTO members_v3 (id, household_id, name, role, color, avatar, credential_hash, credential_type, sort_order, grants_json, created_at, deleted_at)
        SELECT id, household_id, name, role, color, avatar, credential_hash, credential_type, sort_order, grants_json, created_at, deleted_at FROM members;
      DROP TABLE members;
      ALTER TABLE members_v3 RENAME TO members;
    `);
    db.pragma("foreign_keys = ON");
  }
  if (version < 4) {
    // Lists can be linked to a calendar event (they surface on its days).
    db.exec("ALTER TABLE checklists ADD COLUMN linked_event_id TEXT;");
  }
  if (version < 5) {
    // Federation: paired families, what we share with each, what they share with us.
    db.exec(/* sql */ `
      CREATE TABLE peers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        pubkey TEXT NOT NULL,
        shared_key TEXT NOT NULL,
        transport TEXT NOT NULL CHECK (transport IN ('direct','relay')),
        peer_url TEXT,
        outbox TEXT,
        inbox TEXT,
        status TEXT NOT NULL CHECK (status IN ('request','pending','active')),
        created_at INTEGER NOT NULL
      );
      CREATE TABLE peer_shares (
        peer_id TEXT NOT NULL REFERENCES peers(id),
        checklist_id TEXT NOT NULL,
        PRIMARY KEY (peer_id, checklist_id)
      );
      CREATE TABLE federated_lists (
        peer_id TEXT NOT NULL REFERENCES peers(id),
        remote_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (peer_id, remote_id)
      );
    `);
  }
  if (version < 6) {
    // Chore steps: "Clean the living room" carries its sub-steps as part of
    // the one chore (what to do, not separate assignments).
    db.exec("ALTER TABLE tasks ADD COLUMN steps_json TEXT;");
  }
  if (version < 7) {
    // Checkable chore steps: per-occurrence progress; all done => chore done.
    db.exec(`CREATE TABLE step_checks (
      task_id TEXT NOT NULL,
      occurrence_date TEXT NOT NULL DEFAULT '',
      step_index INTEGER NOT NULL,
      PRIMARY KEY (task_id, occurrence_date, step_index)
    );`);
  }
  if (version < 8) {
    // Kid UI tiers: 'little' (Fisher-Price scale) or 'teen' (standard UI).
    db.exec("ALTER TABLE members ADD COLUMN ui_level TEXT;");
  }
  if (version < 9) {
    // Points v2: who checked each step (step points go to the do-er), an
    // auditable ledger (awards land only when the whole task completes;
    // parents can add/deduct manually), and parent-defined goals.
    db.exec(/* sql */ `
      ALTER TABLE step_checks ADD COLUMN checked_by TEXT;

      CREATE TABLE points_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        household_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        delta INTEGER NOT NULL,
        reason TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('task','step','manual')),
        task_id TEXT,
        occurrence_date TEXT,
        created_by TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_points_member ON points_ledger(household_id, member_id, created_at);
      CREATE INDEX idx_points_task ON points_ledger(task_id, occurrence_date);

      CREATE TABLE point_goals (
        id TEXT PRIMARY KEY,
        household_id TEXT NOT NULL,
        title TEXT NOT NULL,
        icon TEXT NOT NULL DEFAULT '🏆',
        mode TEXT NOT NULL CHECK (mode IN ('target','race')),
        target INTEGER NOT NULL,
        member_ids_json TEXT,
        starts_at INTEGER NOT NULL,
        ends_at INTEGER,
        repeat TEXT NOT NULL DEFAULT 'none' CHECK (repeat IN ('none','monthly')),
        reward TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
    `);
  }
  if (version < 10) {
    // Audience control: 'family' (everyone) or 'private' (creator only —
    // parents/AIs retain access; kids and displays never receive them).
    db.exec("ALTER TABLE events ADD COLUMN visibility TEXT NOT NULL DEFAULT 'family';");
    db.exec("ALTER TABLE tasks ADD COLUMN visibility TEXT NOT NULL DEFAULT 'family';");
  }
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}

export const uid = () => crypto.randomUUID();
export const now = () => Date.now();
