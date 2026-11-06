/** Minimal inline SVG icons (no icon font / external requests). Decorative unless labelled. */
const PATHS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  history: 'M12 8v4l3 2M3.05 11a9 9 0 1 1 .5 4M3 4v5h5',
  compare: 'M8 3v18M16 3v18M4 7h8M12 17h8',
  record: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
  pin: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  warning: 'M12 3 2 21h20L12 3zm0 6v5m0 3v.5',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm0-11v6m0-9v.5',
  error: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9 9l6 6m0-6-6 6',
  check: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zm-4-10 3 3 5-6',
  crosshair: 'M12 2v4m0 12v4M2 12h4m12 0h4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  back: 'M15 18l-6-6 6-6',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = 'h-5 w-5' }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
