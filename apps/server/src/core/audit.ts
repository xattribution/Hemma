import type { ActorRef } from "@coord/plugin-sdk";
import type { Db } from "./db.js";
import { now } from "./db.js";

export function recordAudit(
  db: Db,
  householdId: string,
  actor: ActorRef,
  entityType: string,
  entityId: string,
  action: string,
  summary: string,
  diff?: unknown,
) {
  db.prepare(
    `INSERT INTO audit_log (household_id, actor_member_id, actor_name, entity_type, entity_id, action, summary, diff_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    householdId,
    actor.memberId,
    actor.name,
    entityType,
    entityId,
    action,
    summary,
    diff === undefined ? null : JSON.stringify(diff),
    now(),
  );
}
