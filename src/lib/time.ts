export function formatHours(seconds: number): string {
  if (!seconds) return '0h';
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function formatHoursDecimal(seconds: number): string {
  const hours = seconds / 3600;
  if (Number.isInteger(hours)) return `${hours}h`;
  return `${hours.toFixed(2).replace(/\.?0+$/, '')}h`;
}

export function parseProjectPath(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  try {
    if (trimmed.startsWith('http')) {
      const url = new URL(trimmed);
      const path = url.pathname.replace(/^\//, '').replace(/\/$/, '').replace(/\/-\/.*$/, '');
      return path || null;
    }
  } catch {
    return null;
  }
  return trimmed.replace(/^\//, '').replace(/\/$/, '');
}

export function parseInstanceOrigin(input: string): string | null {
  if (!input) return null;
  try {
    const trimmed = input.trim();
    if (trimmed.startsWith('http')) {
      const url = new URL(trimmed);
      return url.origin;
    }
    return `https://${trimmed.replace(/\/$/, '')}`;
  } catch {
    return null;
  }
}

export interface PeriodBounds {
  startTs: number;
  endTs: number;
}

export function getPeriodBounds(startDate: string, endDate: string): PeriodBounds {
  return {
    startTs: new Date(`${startDate}T00:00:00Z`).getTime(),
    endTs: new Date(`${endDate}T23:59:59.999Z`).getTime(),
  };
}

export function isTimestampInPeriod(entryTs: number, bounds: PeriodBounds): boolean {
  return entryTs >= bounds.startTs && entryTs <= bounds.endTs;
}

export function extractSpentAtDate(spentAtIso: string): string | null {
  const match = spentAtIso.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];

  const parsed = new Date(spentAtIso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export function isInPeriod(spentAtIso: string, startDate: string, endDate: string): boolean {
  const spentDate = extractSpentAtDate(spentAtIso);
  if (spentDate) {
    return spentDate >= startDate && spentDate <= endDate;
  }

  return isTimestampInPeriod(new Date(spentAtIso).getTime(), getPeriodBounds(startDate, endDate));
}
