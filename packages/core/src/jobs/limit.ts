// When a paused analysis can go on (design/08 #6, design/02 D6). Claude Code's limit message
// says when the plan resets: "You've hit your session limit · resets 6:40pm (Europe/Paris)".

/** Without a reset time in the message, try again after this long. */
export const DEFAULT_LIMIT_WAIT_MS = 30 * 60 * 1000;

/** Offset of `timeZone` from UTC at `at`, in ms (positive east of Greenwich). */
function zoneOffset(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The calendar date it is in `timeZone` at `at`. */
function zoneDate(at: Date, timeZone: string) {
  const shifted = new Date(at.getTime() + zoneOffset(at, timeZone));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), day: shifted.getUTCDate() };
}

/** The instant when it is hour:minute on that day in `timeZone`. */
function zonedInstant(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guess = Date.UTC(year, month, day, hour, minute);
  // Two passes settle the offset around daylight-saving changes.
  let instant = guess - zoneOffset(new Date(guess), timeZone);
  instant = guess - zoneOffset(new Date(instant), timeZone);
  return new Date(instant);
}

function validZone(timeZone: string | undefined): string | undefined {
  if (!timeZone) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return undefined;
  }
}

/**
 * The next time the limit resets, read from the provider's message; null when it doesn't say.
 * A time without a zone is read in the machine's zone.
 */
export function limitResetTime(message: string, now: Date): Date | null {
  const match = /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([^)]+)\))?/i.exec(message);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;

  const timeZone = validZone(match[4]?.trim()) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = zoneDate(now, timeZone);
  let reset = zonedInstant(today.year, today.month, today.day, hour, minute, timeZone);
  if (reset.getTime() <= now.getTime()) {
    const tomorrow = zoneDate(new Date(reset.getTime() + 24 * 3600 * 1000), timeZone);
    reset = zonedInstant(tomorrow.year, tomorrow.month, tomorrow.day, hour, minute, timeZone);
  }
  return reset;
}

/** When to try again after a limit: the announced reset (plus a minute of margin), else in 30 minutes. */
export function resumeTimeAfterLimit(message: string, now: Date): Date {
  const reset = limitResetTime(message, now);
  return reset ? new Date(reset.getTime() + 60_000) : new Date(now.getTime() + DEFAULT_LIMIT_WAIT_MS);
}
