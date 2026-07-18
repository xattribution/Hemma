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
    // Reset (not just invalidate): a 401 refetch keeps stale data around,
    // which would leave the UI looking signed in.
    onSuccess: () => qc.resetQueries(),
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
    toggleStep: useMutation({
      mutationFn: (args: { id: string; stepIndex: number; occurrenceDate: string | null }) =>
        api(`/api/tasks/${args.id}/steps/${args.stepIndex}/toggle`, {
          method: "POST", body: { occurrenceDate: args.occurrenceDate },
        }),
      onSuccess: invalidate,
    }),
  };
}

// ---------- Points ----------

export const usePointsSummary = (memberId?: string) =>
  useQuery({
    queryKey: ["points", { memberId: memberId ?? "all" }],
    queryFn: () =>
      api<import("@coord/shared").PointsSummary>(`/api/points/summary${memberId ? `?memberId=${memberId}` : ""}`),
  });

export function usePointsMutations() {
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["points"] });
  return {
    adjust: useMutation({
      mutationFn: (args: { memberId: string; delta: number; reason: string }) =>
        api("/api/points/adjust", { method: "POST", body: args }),
      onSuccess: invalidate,
    }),
    createGoal: useMutation({
      mutationFn: (input: import("@coord/shared").GoalInput) =>
        api("/api/points/goals", { method: "POST", body: input }),
      onSuccess: invalidate,
    }),
    updateGoal: useMutation({
      mutationFn: ({ id, ...patch }: Partial<import("@coord/shared").GoalInput> & { id: string }) =>
        api(`/api/points/goals/${id}`, { method: "PATCH", body: patch }),
      onSuccess: invalidate,
    }),
    removeGoal: useMutation({
      mutationFn: (id: string) => api(`/api/points/goals/${id}`, { method: "DELETE" }),
      onSuccess: invalidate,
    }),
  };
}

// ---------- Calendar subscriptions ----------

export const useSubscriptions = (enabled = true) =>
  useQuery({
    queryKey: ["subscriptions"],
    queryFn: () =>
      api<{ subscriptions: import("@coord/shared").CalSubscription[] }>("/api/subscriptions"),
    select: (d) => d.subscriptions,
    enabled,
  });

export function useSubscriptionMutations() {
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["subscriptions"] });
    void qc.invalidateQueries({ queryKey: ["events"] });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  return {
    create: useMutation({
      mutationFn: (input: Partial<import("@coord/shared").CalSubscriptionInput> & { url: string }) =>
        api<import("@coord/shared").CalSubscription>("/api/subscriptions", { method: "POST", body: input }),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, ...patch }: Partial<import("@coord/shared").CalSubscriptionInput> & { id: string }) =>
        api<import("@coord/shared").CalSubscription>(`/api/subscriptions/${id}`, { method: "PATCH", body: patch }),
      onSuccess: invalidate,
    }),
    sync: useMutation({
      mutationFn: (id: string) =>
        api<import("@coord/shared").CalSubscription>(`/api/subscriptions/${id}/sync`, { method: "POST" }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api(`/api/subscriptions/${id}`, { method: "DELETE" }),
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

export const useStores = () =>
  useQuery({
    queryKey: ["checklists", "stores"],
    queryFn: () => api<{ stores: import("@coord/shared").StoreTag[] }>("/api/stores"),
    select: (d) => d.stores,
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
      mutationFn: (args: { listId: string; text: string; quantity: string | null; store: string | null; alsoGrocery?: boolean }) =>
        api(`/api/checklists/${args.listId}/items`, {
          method: "POST",
          body: { text: args.text, quantity: args.quantity, store: args.store, alsoGrocery: args.alsoGrocery ?? false },
        }),
      onSuccess: invalidate,
    }),
    updateItem: useMutation({
      mutationFn: (args: { listId: string; itemId: string; patch: { text?: string; quantity?: string | null; store?: string | null } }) =>
        api(`/api/checklists/${args.listId}/items/${args.itemId}`, { method: "PATCH", body: args.patch }),
      onSuccess: invalidate,
    }),
    removeItem: useMutation({
      mutationFn: (args: { listId: string; itemId: string }) =>
        api(`/api/checklists/${args.listId}/items/${args.itemId}`, { method: "DELETE" }),
      onSuccess: invalidate,
    }),
    clearChecked: useMutation({
      mutationFn: (listId: string) =>
        api<{ removed: number }>(`/api/checklists/${listId}/clear-checked`, { method: "POST" }),
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

// ---------- Displays & API tokens ----------

export const useDisplays = () =>
  useQuery({
    queryKey: ["devices"],
    queryFn: () => api<{ devices: import("@coord/shared").DisplayInfo[] }>("/api/devices"),
    select: (d) => d.devices,
  });

export function useDisplayMutations() {
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["devices"] });
  return {
    create: useMutation({
      mutationFn: (args: { label: string }) =>
        api<{ id: string; token: string }>("/api/devices", { method: "POST", body: args }),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: (args: { id: string; label?: string; config?: import("@coord/shared").DisplayConfig }) =>
        api(`/api/devices/${args.id}`, { method: "PATCH", body: { label: args.label, config: args.config } }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api(`/api/devices/${id}`, { method: "DELETE" }),
      onSuccess: invalidate,
    }),
  };
}

export interface ApiTokenInfo {
  id: string;
  token: string;
  label: string;
  createdAt: number;
}

export const useApiTokens = () =>
  useQuery({
    queryKey: ["api-tokens"],
    queryFn: () => api<{ tokens: ApiTokenInfo[] }>("/api/tokens"),
    select: (d) => d.tokens,
  });

export function useApiTokenMutations() {
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["api-tokens"] });
  return {
    create: useMutation({
      mutationFn: (args: { label: string }) =>
        api<{ id: string; token: string }>("/api/tokens", { method: "POST", body: args }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api(`/api/tokens/${id}`, { method: "DELETE" }),
      onSuccess: invalidate,
    }),
  };
}

// ---------- Federation: lists shared with us ----------

export interface SharedInList {
  peerId: string;
  peerName: string;
  list: Checklist;
}

export const useSharedLists = () =>
  useQuery({
    queryKey: ["checklists", "shared-in"],
    queryFn: () => api<{ shared: SharedInList[] }>("/api/federation/shared"),
    select: (d) => d.shared,
  });

export function useSharedListToggle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { peerId: string; remoteId: string; itemId: string }) =>
      api(`/api/federation/shared/${args.peerId}/${args.remoteId}/toggle`, { method: "POST", body: { itemId: args.itemId } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["checklists"] }),
  });
}
