// Resolves how to pay a creator into a deep link where possible.

export interface PayCreator {
  paymentMethod?: string | null;
  paymentHandle?: string | null;
  sideshiftUrl?: string | null;
}

export const PAYMENT_METHODS: [string, string][] = [
  ["sideshift", "Sideshift"],
  ["venmo", "Venmo"],
  ["paypal", "PayPal"],
  ["other", "Other"],
];

export const PAYMENT_LABEL: Record<string, string> = Object.fromEntries(PAYMENT_METHODS);

const handle = (s: string) => s.trim().replace(/^@/, "");

/** { label, href } for the creator's pay method, or null if there's nothing to open. */
export function payLink(c: PayCreator): { label: string; href: string } | null {
  const m = c.paymentMethod || "sideshift";
  if (m === "sideshift") return c.sideshiftUrl ? { label: "Sideshift", href: c.sideshiftUrl } : null;
  if (m === "venmo") return c.paymentHandle ? { label: "Venmo", href: `https://venmo.com/u/${handle(c.paymentHandle)}` } : null;
  if (m === "paypal") return c.paymentHandle ? { label: "PayPal", href: `https://paypal.me/${handle(c.paymentHandle)}` } : null;
  return null;
}
