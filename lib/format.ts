/**
 * @file Pure formatting helpers shared by server and browser code (no Node or PDF dependencies).
 */

/**
 * Formats cents as US dollars.
 *
 * @param c - Cents (may be negative).
 * @returns e.g. "$1,724.00" or "-$524.00".
 */
export function usd(c: number): string {
  const sign = c < 0 ? "-" : "";
  return `${sign}$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Friendly labels for field names on the confirm screen. */
const LABELS: Record<string, string> = {
  billingEntity: "Billing entity",
  providerType: "Provider type",
  accountNumber: "Account number",
  patientName: "Patient name",
  serviceStart: "Service start",
  serviceEnd: "Service end",
  encounter: "Encounter",
  statementDate: "Statement date",
  totalCharges: "Total charges",
  totalAdjustments: "Adjustments",
  totalPayments: "Payments",
  amountDue: "Amount due",
  lineNumber: "Line number",
  serviceDate: "Service date",
  code: "Code",
  codeType: "Code type",
  description: "Description",
  quantity: "Quantity",
  unitPrice: "Unit price",
  charge: "Charge",
  adjustment: "Adjustment",
  patientResponsibility: "Patient responsibility",
  insurer: "Insurer",
  claimNumber: "Claim number",
  provider: "Provider",
  totalPatientResponsibility: "Total you owe",
  billed: "Billed",
  allowed: "Allowed",
  planPaid: "Plan paid",
};

/**
 * Turns a field path into a readable label.
 *
 * @param path - e.g. "lines.3.charge" or "header.amountDue".
 * @returns e.g. "Line 4 · Charge" or "Amount due".
 */
export function fieldLabel(path: string): string {
  const parts = path.split(".");
  const key = parts[parts.length - 1];
  const name = LABELS[key] ?? key;
  return parts[0] === "lines" ? `Line ${Number(parts[1]) + 1} · ${name}` : name;
}

/**
 * Formats an ISO date for letters, e.g. "2026-09-14" → "September 14, 2026". Uses UTC so the day
 * never shifts with the server's time zone.
 *
 * @param iso - ISO 8601 date (YYYY-MM-DD).
 * @returns Long-form US date, or the input unchanged if it isn't a valid ISO date.
 */
export function longDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}
