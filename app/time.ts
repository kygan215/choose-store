const BEIJING_TIME_ZONE = "Asia/Shanghai";

type DateInput = string | number | Date;
type BeijingParts = Record<"year" | "month" | "day" | "hour" | "minute" | "second", string>;

function getBeijingParts(value: DateInput): BeijingParts | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: BEIJING_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  ) as BeijingParts;
}

export function formatBeijingDateTime(value: DateInput): string {
  const parts = getBeijingParts(value);
  return parts ? `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}` : "—";
}

export function formatBeijingDate(value: DateInput): string {
  const parts = getBeijingParts(value);
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : "—";
}

export function formatBeijingTime(value: DateInput): string {
  const parts = getBeijingParts(value);
  return parts ? `${parts.hour}:${parts.minute}:${parts.second}` : "—";
}

export function beijingDateKey(value: DateInput = new Date()): string {
  return formatBeijingDate(value);
}
