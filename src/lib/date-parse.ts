// Best-effort release-date parser for Steam-style strings.
// Import-free so it is testable under plain `node --test`.

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function parseQuarter(q: string, year: number): Date | null {
  const startMonth = { q1: 0, q2: 3, q3: 6, q4: 9 }[q.toLowerCase()];
  if (startMonth == null) return null;
  const d = new Date(Date.UTC(year, startMonth, 1));
  return isNaN(d.getTime()) ? null : d;
}

/** Returns an ISO date string (YYYY-MM-DD) or null. */
export function parseReleaseDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const s = dateStr.trim();
  if (!s || s.toLowerCase().includes("soon") || s.toLowerCase().includes("tba") || s.toLowerCase() === "to be announced") return null;

  // ISO: 2026-03-14
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // Year only: 2027
  m = s.match(/^(\d{4})$/);
  if (m) return `${m[1]}-01-01`;

  // Q3 2026 / 2026 Q3
  m = s.match(/^(Q[1-4])\s+(\d{4})$/i);
  if (m) {
    const d = parseQuarter(m[1], Number(m[2]));
    return d ? d.toISOString().slice(0, 10) : null;
  }
  m = s.match(/^(\d{4})\s+(Q[1-4])$/i);
  if (m) {
    const d = parseQuarter(m[2], Number(m[1]));
    return d ? d.toISOString().slice(0, 10) : null;
  }

  // "6 Aug, 2019" or "Aug 6, 2019"
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3}),?\s+(\d{4})$/);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (month != null) {
      const d = new Date(Date.UTC(Number(m[3]), month, Number(m[1])));
      return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    }
  }
  m = s.match(/^([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const month = MONTHS[m[1].toLowerCase()];
    if (month != null) {
      const d = new Date(Date.UTC(Number(m[3]), month, Number(m[2])));
      return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    }
  }

  // "Aug 2026" / "August 2026"
  m = s.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (m) {
    const month = MONTHS[m[1].toLowerCase().slice(0, 3)];
    if (month != null) {
      const d = new Date(Date.UTC(Number(m[2]), month, 1));
      return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    }
  }

  return null;
}
