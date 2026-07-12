import { useState } from "react";
import { Delete } from "lucide-react";
import { PATTERN_ANIMALS } from "@coord/shared";

/**
 * The kid-friendly credential: a 3×3 grid of animals. Four taps make a
 * pattern — "cat, goat, cat, horse" — encoded as "pat:" + cell indices.
 */
export function PatternPad({ onComplete, resetKey }: { onComplete: (encoded: string) => void; resetKey?: unknown }) {
  const [taps, setTaps] = useState<number[]>([]);
  const [lastReset, setLastReset] = useState(resetKey);

  // Parent can clear the pad by changing resetKey (e.g. after a failed try).
  if (resetKey !== lastReset) {
    setLastReset(resetKey);
    setTaps([]);
  }

  const tap = (index: number) => {
    const next = [...taps, index].slice(0, 4);
    setTaps(next);
    if (next.length === 4) {
      onComplete(`pat:${next.join("")}`);
      setTaps([]);
    }
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex h-8 items-center gap-2">
        {[0, 1, 2, 3].map((i) => (
          <span key={i}
            className={`flex h-7 w-7 items-center justify-center rounded-full border-2 text-base ${
              taps.length > i ? "border-coral bg-coral-soft" : "border-line bg-cream"
            }`}>
            {taps[i] !== undefined ? PATTERN_ANIMALS[taps[i]!] : ""}
          </span>
        ))}
        {taps.length > 0 && (
          <button type="button" aria-label="Undo tap" className="ml-1 rounded-full p-1.5 text-ink-soft hover:bg-line"
            onClick={() => setTaps((t) => t.slice(0, -1))}>
            <Delete size={16} />
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {PATTERN_ANIMALS.map((animal, index) => (
          <button key={index} type="button" onClick={() => tap(index)}
            className="flex h-16 w-16 items-center justify-center rounded-2xl bg-cream text-3xl shadow-card transition active:scale-90">
            {animal}
          </button>
        ))}
      </div>
    </div>
  );
}
