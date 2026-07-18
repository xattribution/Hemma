/**
 * Sett's own icon set (assets/icons) as components: 24px grid, 2px round
 * strokes, currentColor base + one rust accent — the same color-role
 * discipline as the rest of the UI. Drop-in compatible with lucide sizing.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Base({ size = 24, children, ...rest }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      {children}
    </svg>
  );
}

const ACCENT = "var(--color-coral)";

export const IconCalendar = (p: IconProps) => (
  <Base {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
    <path d="M8 3v4M16 3v4M3.5 9.5h17" />
    <circle cx="12" cy="15" r="1.6" fill={ACCENT} stroke="none" />
  </Base>
);

export const IconChores = (p: IconProps) => (
  <Base {...p}>
    <rect x="4.5" y="4.5" width="15" height="16.5" rx="2" />
    <rect x="9" y="2.5" width="6" height="4" rx="1.2" />
    <path stroke={ACCENT} d="m8.6 13.6 2.3 2.3 4.6-4.9" />
  </Base>
);

export const IconLists = (p: IconProps) => (
  <Base {...p}>
    <rect x="4" y="4.5" width="4.6" height="4.6" rx="1.2" />
    <rect x="4" y="14.5" width="4.6" height="4.6" rx="1.2" />
    <path d="M12.5 6.8H20M12.5 16.8H20" />
    <path stroke={ACCENT} d="m5.2 6.9 1.1 1.1 2-2.2" />
  </Base>
);

export const IconPoints = (p: IconProps) => (
  <Base {...p}>
    <path d="m12 3.8 2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8z" />
  </Base>
);

export const IconHistory = (p: IconProps) => (
  <Base {...p}>
    <path d="M4.9 7.6a8 8 0 1 1-.7 5.9" />
    <path d="M4.9 3.6v4h4" />
    <path stroke={ACCENT} d="M12 9v4l2.7 1.6" />
  </Base>
);

export const IconSettings = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="6.2" />
    <circle cx="12" cy="12" r="2.4" />
    <path d="M12 3v2.8M12 18.2V21M3 12h2.8M18.2 12H21M5.6 5.6l2 2M16.4 16.4l2 2M18.4 5.6l-2 2M7.6 16.4l-2 2" />
  </Base>
);

export const IconMessages = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 7a2.5 2.5 0 0 1 2.5-2.5h11A2.5 2.5 0 0 1 20 7v6.5a2.5 2.5 0 0 1-2.5 2.5H10l-4 3.5V16h-.5A2.5 2.5 0 0 1 3 13.5" />
    <g fill={ACCENT} stroke="none">
      <circle cx="8.8" cy="10.3" r="1.2" /><circle cx="12.4" cy="10.3" r="1.2" /><circle cx="16" cy="10.3" r="1.2" />
    </g>
  </Base>
);

export const IconConnect = (p: IconProps) => (
  <Base {...p}>
    <path d="M3 18.5h18" />
    <path d="M4.5 18.5v-4.7a3.9 3.9 0 0 1 7.8 0v4.7" />
    <path stroke={ACCENT} d="M11.7 18.5v-4.7a3.9 3.9 0 0 1 7.8 0v4.7" />
  </Base>
);
