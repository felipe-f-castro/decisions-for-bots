import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function checkToken(candidate: string, expected: string) {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(candidate), digest(expected));
}

export function checkTokenDigest(candidate: string, expectedHex: string) {
  if (!/^[a-f0-9]{64}$/i.test(expectedHex)) return false;
  const actual = Buffer.from(hashToken(candidate), "hex");
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function randomSecret() {
  return randomBytes(32).toString("base64url");
}
