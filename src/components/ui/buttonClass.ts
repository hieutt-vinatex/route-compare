export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-teal-700 text-white hover:bg-teal-800 disabled:bg-slate-300 disabled:text-slate-600',
  secondary:
    'bg-white text-slate-900 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-red-700 text-white hover:bg-red-800 disabled:bg-slate-300 disabled:text-slate-600',
  ghost: 'bg-transparent text-teal-800 hover:bg-teal-50 disabled:text-slate-400',
};

const SIZES: Record<ButtonSize, string> = {
  // ≥44px touch targets (docs/06 §8).
  md: 'min-h-11 px-4 text-sm',
  lg: 'min-h-14 px-6 text-base',
};

/** Shared button styling (also used by router <Link>s that look like buttons). */
export function buttonClass(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  extra = '',
): string {
  return [
    'inline-flex items-center justify-center gap-2 rounded-xl font-semibold',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600',
    'disabled:cursor-not-allowed motion-safe:transition-colors',
    VARIANTS[variant],
    SIZES[size],
    extra,
  ].join(' ');
}
