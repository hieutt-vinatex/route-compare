/** Chart x value (minutes since start, Q3) → "m:ss" label, so short trips get distinct ticks. */
export function formatChartMinutes(tMin: number): string {
  const totalSeconds = Math.max(0, Math.round(tMin * 60));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
