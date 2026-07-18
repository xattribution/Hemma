import crypto from "node:crypto";

/**
 * Per-boot service identity: routes that must act on the caller's behalf
 * without a session (e.g. the public photo-share stream fetching the asset
 * from a source plugin) pass this in `x-coord-internal`. Never leaves the
 * process; rotates every restart.
 */
export const INTERNAL_TOKEN = crypto.randomBytes(24).toString("base64url");
