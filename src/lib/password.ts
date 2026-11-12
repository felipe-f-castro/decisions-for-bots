export const PASSWORD_MIN_LENGTH = 10;
// Auth hashing typically uses only the first 72 bytes of a password.
export const PASSWORD_MAX_BYTES = 72;

export function passwordBytes(password: string): number {
  return new TextEncoder().encode(password).length;
}
