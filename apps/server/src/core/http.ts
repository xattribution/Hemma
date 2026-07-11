import type { FastifyReply } from "fastify";
import type { z } from "zod";

/** Parse a request payload; replies 400 and returns null on validation failure. */
export function parse<S extends z.ZodTypeAny>(schema: S, data: unknown, reply: FastifyReply): z.infer<S> | null {
  const result = schema.safeParse(data);
  if (!result.success) {
    reply.code(400).send({ error: "Invalid input", details: result.error.flatten() });
    return null;
  }
  return result.data;
}
