/**
 * The Sett mark: two den arches linked — home, and the connection between
 * homes. Drawn with theme tokens so it adapts to every theme.
 */
export function SettMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="99 121 314 264" width={size} height={size * (264 / 314)} className={className} aria-hidden>
      <path d="M130 330 v-92 a86 86 0 0 1 172 0 v20" fill="none" stroke="var(--color-ink)" strokeWidth="46" strokeLinecap="round" />
      <path d="M382 196 v92 a86 86 0 0 1 -172 0 v-20" fill="none" stroke="var(--color-coral)" strokeWidth="46" strokeLinecap="round" />
      <path d="M130 330 v-92 a86 86 0 0 1 43 -74" fill="none" stroke="var(--color-ink)" strokeWidth="46" strokeLinecap="round" />
    </svg>
  );
}
