export const TIME_ZONE = "America/Sao_Paulo";

export function fullDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function isUrgent(deadline: string | null, now = Date.now()) {
  return !!deadline && Date.parse(deadline) - now <= 48 * 60 * 60 * 1000;
}

export function deadlineLabel(deadline: string, now = Date.now()) {
  const remaining = Date.parse(deadline) - now;
  if (remaining < 0) return "Overdue";
  if (remaining < 60 * 60 * 1000) return "Due within an hour";
  if (remaining < 24 * 60 * 60 * 1000) return `Due in ${Math.ceil(remaining / 3600000)} hours`;
  return `Due ${new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, month: "short", day: "numeric" }).format(new Date(deadline))}`;
}

// Convert a wall-clock time in São Paulo independently of the browser's timezone.
export function saoPauloToISO(local: string): string | null {
  if (!local) return null;
  const utc = new Date(`${local}:00Z`);
  if (!Number.isFinite(utc.getTime())) throw new Error("Choose a valid deadline.");
  const offset = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    timeZoneName: "longOffset",
  })
    .formatToParts(utc)
    .find((part) => part.type === "timeZoneName")?.value;
  const match = offset?.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) throw new Error("Could not determine the São Paulo timezone.");
  const minutes = (Number(match[2]) * 60 + Number(match[3])) * (match[1] === "+" ? 1 : -1);
  return new Date(utc.getTime() - minutes * 60000).toISOString();
}
