import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export function DailyQuoteCard() {
  const { data } = useQuery({
    queryKey: ["daily-quote"],
    queryFn: () => api<{ quote: string }>("/api/p/daily-quote/today"),
    staleTime: 60 * 60_000,
  });
  if (!data) return null;
  return (
    <div className="rounded-card bg-coral-soft p-4 shadow-card">
      <p className="text-center text-sm font-bold italic text-ink">“{data.quote}”</p>
    </div>
  );
}
