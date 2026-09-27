/**
 * Utility functions for domain parsing, cleaning, and normalization.
 */

/**
 * Normalizes a domain or URL string to its canonical hostname/domain format.
 * Strips http://, https://, trailing slashes, paths, and standard ports.
 * Example: 'https://invenaro-api.vercel.app/' -> 'invenaro-api.vercel.app'
 */
export function normalizeDomain(raw: string): string {
  if (!raw) return "";
  let cleaned = raw.trim().toLowerCase();
  if (cleaned.startsWith("http://")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("https://")) {
    cleaned = cleaned.slice(8);
  }
  const slashIdx = cleaned.indexOf("/");
  if (slashIdx !== -1) {
    cleaned = cleaned.slice(0, slashIdx);
  }
  if (cleaned.endsWith(":80")) {
    cleaned = cleaned.slice(0, -3);
  } else if (cleaned.endsWith(":443")) {
    cleaned = cleaned.slice(0, -4);
  }
  return cleaned;
}

/**
 * Parses and cleans an array or comma/newline separated string of domains.
 * Ensures the primary domain is included in the allowed list, and includes both
 * canonical hostname and original form if they differ.
 */
export function parseAllowedDomains(
  input?: string[] | string | null,
  primaryDomain?: string
): string[] {
  let list: string[] = [];
  if (Array.isArray(input)) {
    list = input;
  } else if (typeof input === "string" && input.trim()) {
    list = input
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const set = new Set<string>();

  if (primaryDomain) {
    const normPrimary = normalizeDomain(primaryDomain);
    if (normPrimary) set.add(normPrimary);
    if (primaryDomain.trim().toLowerCase() !== normPrimary) {
      set.add(primaryDomain.trim().toLowerCase());
    }
  }

  for (const item of list) {
    const norm = normalizeDomain(item);
    if (norm) set.add(norm);
    if (item.trim().toLowerCase() !== norm) {
      set.add(item.trim().toLowerCase());
    }
  }

  return Array.from(set);
}
