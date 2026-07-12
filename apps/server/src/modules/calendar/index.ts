import { z } from "zod";
import { editScopeSchema, eventInputSchema } from "@coord/shared";
import type { CoreModule } from "../../core/plugin-host.js";
import { requireAccess, requireActor } from "../../core/auth.js";
import { actorOf } from "../../core/actor.js";
import { parse } from "../../core/http.js";
import { getHousehold } from "../../core/household.js";
import { createEvent, deleteEvent, listInstances, updateEvent } from "./service.js";

const rangeSchema = z.object({
  start: z.coerce.number().int(),
  end: z.coerce.number().int(),
});

const updateSchema = z.object({
  scope: editScopeSchema.default("all"),
  occurrenceStart: z.number().int().optional(),
  patch: eventInputSchema.partial(),
});

const deleteQuerySchema = z.object({
  scope: editScopeSchema.default("all"),
  occurrenceStart: z.coerce.number().int().optional(),
});

export const calendarModule: CoreModule = {
  id: "core.calendar",
  name: "Calendar",
  description: "Family events with recurrence, exceptions and reminders.",
  register({ app, db, bus }) {
    app.get("/api/events", (req, reply) => {
      if (!requireAccess(db, req, reply)) return;
      const range = parse(rangeSchema, req.query, reply);
      if (!range) return;
      const household = getHousehold(db)!;
      return { instances: listInstances(db, household.id, range.start, range.end) };
    });

    app.post("/api/events", (req, reply) => {
      const access = requireActor(db, req, reply, "event.manage");
      if (!access) return;
      const input = parse(eventInputSchema, req.body, reply);
      if (!input) return;
      const id = createEvent(db, bus, access.householdId, actorOf(access), input);
      reply.code(201);
      return { id };
    });

    app.patch("/api/events/:id", (req, reply) => {
      const access = requireActor(db, req, reply, "event.manage");
      if (!access) return;
      const body = parse(updateSchema, req.body, reply);
      if (!body) return;
      const { id } = req.params as { id: string };
      updateEvent(db, bus, access.householdId, actorOf(access), id, body);
      return { ok: true };
    });

    app.delete("/api/events/:id", (req, reply) => {
      const access = requireActor(db, req, reply, "event.manage");
      if (!access) return;
      const query = parse(deleteQuerySchema, req.query, reply);
      if (!query) return;
      const { id } = req.params as { id: string };
      deleteEvent(db, bus, access.householdId, actorOf(access), id, query.scope, query.occurrenceStart);
      return { ok: true };
    });
  },
};
