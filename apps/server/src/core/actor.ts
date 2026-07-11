import type { ActorRef } from "@coord/plugin-sdk";
import type { MemberRow, SessionInfo } from "./auth.js";

export function actorOf(session: SessionInfo | MemberRow): ActorRef {
  if ("kind" in session) {
    return session.kind === "member"
      ? { memberId: session.member.id, name: session.member.name }
      : { memberId: null, name: session.label };
  }
  return { memberId: session.id, name: session.name };
}
