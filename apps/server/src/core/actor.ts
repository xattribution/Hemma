import type { ActorRef } from "@coord/plugin-sdk";
import type { Access } from "./auth.js";

export function actorOf(access: Access): ActorRef {
  return { memberId: access.memberId, name: access.name };
}
