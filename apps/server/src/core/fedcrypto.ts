/**
 * Federation crypto: X25519 key agreement + AES-256-GCM message sealing.
 * Everything that leaves for another family (or the relay) goes through
 * seal(); the relay only ever carries opaque ciphertext.
 */
import crypto from "node:crypto";
import type { SettingsStore } from "@coord/plugin-sdk";

export interface KeyPair {
  publicKey: string; // base64 SPKI
  privateKey: string; // base64 PKCS8 — never leaves this server
}

export function ensureKeyPair(settings: SettingsStore): KeyPair {
  let pair = settings.get<KeyPair | null>("keypair", null);
  if (!pair) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
    pair = {
      publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
      privateKey: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    };
    settings.set("keypair", pair);
  }
  return pair;
}

/** ECDH(ours, theirs) → HKDF-SHA256 → 32-byte key (hex). Same on both sides. */
export function deriveSharedKey(ourPrivateB64: string, theirPublicB64: string): string {
  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(ourPrivateB64, "base64"), type: "pkcs8", format: "der",
  });
  const publicKey = crypto.createPublicKey({
    key: Buffer.from(theirPublicB64, "base64"), type: "spki", format: "der",
  });
  const secret = crypto.diffieHellman({ privateKey, publicKey });
  return Buffer.from(crypto.hkdfSync("sha256", secret, Buffer.alloc(0), "coord-federation-v1", 32)).toString("hex");
}

/** AES-256-GCM: returns base64(iv ‖ tag ‖ ciphertext). */
export function seal(keyHex: string, data: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function open<T = unknown>(keyHex: string, sealedB64: string): T {
  const raw = Buffer.from(sealedB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  const pt = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
  return JSON.parse(pt.toString("utf8")) as T;
}

const CODE_WORDS = [
  "TIGER", "PANDA", "OTTER", "KOALA", "GECKO", "BISON", "CAMEL", "DINGO", "EAGLE", "FINCH",
  "GOOSE", "HIPPO", "LEMUR", "MOOSE", "NEWTS", "ORCAS", "PUMAS", "QUAIL", "RHINO", "SLOTH",
  "SWANS", "WHALE", "ZEBRA", "BUNNY", "CORGI", "DONUT", "MANGO", "PECAN", "WAFFLE", "TACO",
];

/** Jackbox-style one-time code: memorable, speakable over the phone. */
export function pairingCode(): string {
  const word = CODE_WORDS[crypto.randomInt(CODE_WORDS.length)]!;
  return `${word}-${crypto.randomInt(10, 100)}`;
}

export const mailboxId = () => crypto.randomBytes(16).toString("base64url");
