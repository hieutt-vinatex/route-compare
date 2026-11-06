/** Trip names (Home start form, rename): trimmed, 1–120 characters. */
export const TRIP_NAME_MAX = 120;

/** The stored form of a user-entered name, or null when it is empty or too long. */
export function normalizeTripName(input: string): string | null {
  const name = input.trim();
  return name.length === 0 || name.length > TRIP_NAME_MAX ? null : name;
}
