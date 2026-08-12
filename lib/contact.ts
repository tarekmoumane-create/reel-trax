// Turns a creator's contact fields into deep links that open the right app.

export interface ContactCreator {
  phone?: string | null;
  whatsapp?: string | null;
  instagramHandle?: string | null;
  discord?: string | null;
  email?: string | null;
  contactHandle?: string | null;
  preferredChannel?: string | null;
}

export interface ContactLink {
  channel: string;
  label: string;
  href: string;
  hint?: string;
}

const digits = (s: string) => s.replace(/[^\d+]/g, "").replace(/^\+?/, "");

export function contactLinks(c: ContactCreator): ContactLink[] {
  const links: ContactLink[] = [];

  if (c.phone) {
    // sms: opens Messages on macOS/iOS (iMessage when available).
    links.push({ channel: "imessage", label: "iMessage / SMS", href: `sms:${c.phone.replace(/\s/g, "")}`, hint: c.phone });
  }
  const wa = c.whatsapp || c.phone;
  if (wa) {
    links.push({ channel: "whatsapp", label: "WhatsApp", href: `https://wa.me/${digits(wa)}`, hint: wa });
  }
  if (c.instagramHandle) {
    links.push({ channel: "instagram", label: "Instagram DM", href: `https://ig.me/m/${c.instagramHandle}`, hint: `@${c.instagramHandle}` });
  }
  if (c.discord) {
    const d = c.discord.trim();
    const href = /^https?:\/\//.test(d)
      ? d
      : /^\d{5,}$/.test(d)
        ? `https://discord.com/users/${d}`
        : `https://discord.com/users/${d}`;
    links.push({ channel: "discord", label: "Discord", href, hint: d });
  }
  if (c.email) {
    links.push({ channel: "email", label: "Email", href: `mailto:${c.email}`, hint: c.email });
  }

  // Surface the preferred channel first.
  if (c.preferredChannel) {
    links.sort((a, b) => (a.channel === c.preferredChannel ? -1 : b.channel === c.preferredChannel ? 1 : 0));
  }
  return links;
}
