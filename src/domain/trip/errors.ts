/** A trip that is not finished (or no longer exists) cannot be renamed or edited (BR-01). */
export class TripNotEditableError extends Error {
  constructor(id: string) {
    super(`Trip ${id} is not a finished trip`);
    this.name = 'TripNotEditableError';
  }
}
