import "server-only";

/** Runtime env read. Computed access is not inlined at build time, so rotation works without a rebuild. */
export function readEnv(name: string) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

export function envFlag(name: string) {
  return /^(1|true|yes)$/i.test(readEnv(name));
}
