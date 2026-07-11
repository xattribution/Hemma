import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AuditEntry, Checklist, ChecklistInput, CoordEvent, DashboardToday, EditScope,
  EventInput, EventInstance, Me, Member, MemberInput, SetupInput, Task, TaskInput,
} from "@coord/shared";
import { api } from "./client";

export const deviceTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

// ---------- Auth ----------

export function useMe(enabled = true) {
  return useQuery<Me>({
    queryKey: ["me"],
    queryFn: () => api<Me>("/api/auth/me"),
    retry: false,
    staleTime: 60_000,
    enabled,
  });
}

export const useSetupStatus = () =>
  useQuery({ queryKey: ["setup"], queryFn: () => api<{ needed: boolean }>("/api/setup/status"), retry: false });

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { memberId: string; credential: string }) =>
      api<{ member: Member }>("/api/auth/login", { method: "POST", body: input }),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("/api/auth/logout", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useSetup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SetupInput) => api("/api/setup", { method: "POST", body: input }),
    onSuccess: () => qc.invalidateQueries(),
  });
}

// ---------- Members ----------

export const useLoginMembers = () =>
  useQuery({
    queryKey: ["login-members"],
    queryFn: () => api<{ members: Member[] }>("/api/auth/members"),
  });

export const useMembers = () =>
  useQuery({
    queryKey: ["members"],
    queryFn: () => api<{ members: Member[] }>("/api/members"),
    select: (d) => d.members,
  });

export function useMemberMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["members"] });
    void qc.invalidateQueries({ queryKey: ["login-members"] });
  };
  return {
    create: useMutation({
      mutationFn: (input: MemberInput) => api("/api/members", { method: "POST", body: input }),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, ...patch }: Partial<MemberInput> & { id: string }) =>
        api(`/api/members/${id}`, { method: "PATCH", body: patch }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api(`/api/members/${id}`, { method: "DELETE" }),
      onSuccess: invalidate,
    }),
  };
}

// ---------- Events ----------

export const useEventsRange = (start: number, end: number) =>
  useQuery({
    queryKey: ["events", { start, end }],
    queryFn: () => api<{ instances: EventInstance[] }>(`/api/events?start=${start}&end=${end}`),
    select: (d) => d.instances,
  });

export function useEventMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["events"] });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  return {
    create: useMutation({
      mutationFn: (input: EventInput) => api("/api/events", { method: "POST", body: input }),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: (args: { id: string; scope: EditScope; occurrenceStart?: number; patch: Partial<EventInput> }) =>
        api(`/api/events/${args.id}`, {
          method: "PATCH",
          body: { scope: args.scope, occurrenceStart: args.occurrenceStart, patch: args.patch },
        }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (args: { id: string; scope: EditScope; occurrenceStart?: number }) =>
        api(
          `/api/events/${args.id}?scope=${args.scope}${args.occurrenceStart !== undefined ? `&occurrenceStart=${args.occurrenceStart}` : ""}`,
          { method: "DELETE" },
        ),
      onSuccess: invalidate,
    }),
  };
}

// ---------- Tasks ----------

export const useTasks = (date?: string) =>
  useQuery({
    queryKey: ["tasks", { date: date ?? "today" }],
    queryFn: () => api<{ date: string; tasks: Task[] }>(`/api/tasks${date ? `?date=${date}` : ""}`),
  });

export function useTaskMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["tasks"] });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  return {
    create: useMutation({
      mutationFn: (input: TaskInput) => api("/api/tasks", { method: "POST", body: input }),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, ...patch }: Partial<TaskInput> & { id: string }) =>
        api(`/api/tasks/${id}`, { method: "PATCH", body: patch }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api(`/api/tasks/${id}`, { method: "DELETE" }),
      onSuccess: invalidate,
    }),
    complete: useMutation({
      mutationFn: (args: { id: string; occurrenceDate: string | null }) =>
        api(`/api/tasks/${args.id}/complete`, { method: "POST", body: { occurrenceDate: args.occurrenceDate } }),
      onSuccess: invalidate,
    }),
    reassign: useMutation({
      mutationFn: (args: { id: string; toMemberId: string | null }) =>
        api(`/api/tasks/${args.id}/reassign`, { method: "POST", body: { toMemberId: args.toMemberId } }),
      onSuccess: invalidate,
    }),
  };
}

// ---------- Checklists ----------

export const useChecklists = () =>
  useQuery({
    queryKey: ["checklists"],
    queryFn: () => api<{ checklists: Checklist[] }>("/api/checklists"),
    select: (d) => d.checklists,
  });

export function useChecklistMutations() {
  const qc = useQueryClient();
  const key = ["checklists"];
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  return {
    create: useMutation({
      mutationFn: (input: ChecklistInput) => api("/api/checklists", { method: "POST", body: input }),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, ...patch }: Partial<ChecklistInput> & { id: string }) =>
        api(`/api/checklists/${id}`, { method: "PATCH", body: patch }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api(`/api/checklists/${id}`, { method: "DELETE" }),
      onSuccess: invalidate,
    }),
    addItem: useMutation({
      mutationFn: (args: { listId: string; text: string; quantity: string | null }) =>
        api(`/api/checklists/${args.listId}/items`, {
          method: "POST",
          body: { text: args.text, quantity: args.quantity },
        }),
      onSuccess: invalidate,
    }),
    removeItem: useMutation({
      mutationFn: (args: { listId: string; itemId: string }) =>
        api(`/api/checklists/${args.listId}/items/${args.itemId}`, { method: "DELETE" }),
      onSuccess: invalidate,
    }),
    // Optimistic check-off: flip locally, roll back on error.
    toggleItem: useMutation({
      mutationFn: (args: { listId: string; itemId: string }) =>
        api(`/api/checklists/${args.listId}/items/${args.itemId}/toggle`, { method: "POST" }),
      onMutate: async (args) => {
        await qc.cancelQueries({ queryKey: key });
        const previous = qc.getQueryData<{ checklists: Checklist[] }>(key);
        qc.setQueryData<{ checklists: Checklist[] }>(key, (data) =>
          data
            ? {
                checklists: data.checklists.map((list) =>
                  list.id !== args.listId
                    ? list
                    : {
                        ...list,
                        items: list.items.map((item) =>
                          item.id === args.itemId ? { ...item, checked: !item.checked } : item,
                        ),
                      },
                ),
              }
            : data,
        );
        return { previous };
      },
      onError: (_err, _args, context) => {
        if (context?.previous) qc.setQueryData(key, context.previous);
      },
      onSettled: invalidate,
    }),
  };
}

// ---------- Dashboard / audit / plugins ----------

export const useDashboard = () =>
  useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<DashboardToday>("/api/dashboard/today"),
    refetchInterval: 60 * 60_000, // hourly safety net; WS invalidation is the fast path
  });

export const useAudit = (q: string) =>
  useQuery({
    queryKey: ["audit", { q }],
    queryFn: () => api<{ entries: AuditEntry[] }>(`/api/audit${q ? `?q=${encodeURIComponent(q)}` : ""}`),
    select: (d) => d.entries,
  });

export interface PluginInfo {
  id: string;
  name: string;
  description: string;
  optional: boolean;
  enabled: boolean;
}

export const usePlugins = () =>
  useQuery({
    queryKey: ["plugins"],
    queryFn: () => api<{ plugins: PluginInfo[] }>("/api/plugins"),
    select: (d) => d.plugins,
  });

export function useTogglePlugin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; enabled: boolean }) =>
      api(`/api/plugins/${args.id}/enabled`, { method: "POST", body: { enabled: args.enabled } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["plugins"] }),
  });
}
