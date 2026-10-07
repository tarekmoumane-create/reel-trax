import { ok, serverError } from "@/lib/api";
import {
  SETTING_KEYS,
  getSetting,
  setSetting,
  getScrapeCreatorsKey,
  getAnthropicKey,
  getLightReelKey,
  getTimeZone,
  getInvoiceProfile,
} from "@/lib/settings";
import { normalizePem } from "@/lib/appstore";
import { prisma } from "@/lib/db";

function mask(key: string | null): string | null {
  if (!key) return null;
  if (key.length <= 6) return "••••";
  return `${key.slice(0, 3)}••••${key.slice(-3)}`;
}

// What the Settings page shows for the App Store Connect connection: which
// pieces are on file (never the key itself), the linked apps, and how the
// last downloads sync went.
async function appStoreStatus() {
  const issuerId = (await getSetting(SETTING_KEYS.ascIssuerId)) || process.env.ASC_ISSUER_ID || "";
  const keyId = (await getSetting(SETTING_KEYS.ascKeyId)) || process.env.ASC_KEY_ID || "";
  const hasPrivateKey = !!((await getSetting(SETTING_KEYS.ascPrivateKey)) || process.env.ASC_PRIVATE_KEY);
  const vendorNumber = (await getSetting(SETTING_KEYS.ascVendorNumber)) || process.env.ASC_VENDOR_NUMBER || "";
  const lastSyncRaw = await getSetting(SETTING_KEYS.ascLastSync);
  let lastSync: Record<string, unknown> | null = null;
  try { lastSync = lastSyncRaw ? JSON.parse(lastSyncRaw) : null; } catch { lastSync = null; }
  const linked = await prisma.client.findMany({
    where: { appleAppId: { not: null }, archived: false },
    select: { id: true, name: true, appleAppId: true, _count: { select: { appDownloads: true } } },
  });
  return {
    connected: !!(issuerId && keyId && hasPrivateKey && vendorNumber),
    issuerId,
    keyId,
    hasPrivateKey,
    vendorNumber,
    lastSync,
    linkedApps: linked.map((c) => ({ clientId: c.id, name: c.name, appleAppId: c.appleAppId, days: c._count.appDownloads })),
  };
}

export async function GET() {
  try {
    const dbKey = await getSetting(SETTING_KEYS.scrapeCreatorsApiKey);
    const effectiveKey = await getScrapeCreatorsKey();
    const dbAnthropic = await getSetting(SETTING_KEYS.anthropicApiKey);
    const effectiveAnthropic = await getAnthropicKey();
    const dbLightReel = await getSetting(SETTING_KEYS.lightReelApiKey);
    const effectiveLightReel = await getLightReelKey();
    const timeZone = await getTimeZone();
    return ok({
      hasApiKey: !!effectiveKey,
      apiKeyMasked: mask(effectiveKey),
      apiKeyFromEnv: !dbKey && !!process.env.SCRAPECREATORS_API_KEY,
      hasAnthropicKey: !!effectiveAnthropic,
      anthropicKeyMasked: mask(effectiveAnthropic),
      anthropicKeyFromEnv: !dbAnthropic && !!process.env.ANTHROPIC_API_KEY,
      hasLightReelKey: !!effectiveLightReel,
      lightReelKeyMasked: mask(effectiveLightReel),
      lightReelKeyFromEnv: !dbLightReel && !!process.env.LIGHTREEL_API_KEY,
      timeZone,
      invoice: await getInvoiceProfile(),
      appStore: await appStoreStatus(),
    });
  } catch (e) {
    return serverError(e);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (typeof body.scrapeCreatorsApiKey === "string") {
      await setSetting(
        SETTING_KEYS.scrapeCreatorsApiKey,
        body.scrapeCreatorsApiKey.trim()
      );
    }
    if (typeof body.anthropicApiKey === "string") {
      await setSetting(SETTING_KEYS.anthropicApiKey, body.anthropicApiKey.trim());
    }
    if (typeof body.lightReelApiKey === "string") {
      await setSetting(SETTING_KEYS.lightReelApiKey, body.lightReelApiKey.trim());
    }
    if (typeof body.timeZone === "string" && body.timeZone.trim()) {
      await setSetting(SETTING_KEYS.timeZone, body.timeZone.trim());
    }
    if (body.appStore && typeof body.appStore === "object") {
      const a = body.appStore as Record<string, unknown>;
      if (typeof a.issuerId === "string") await setSetting(SETTING_KEYS.ascIssuerId, a.issuerId.trim());
      if (typeof a.keyId === "string") await setSetting(SETTING_KEYS.ascKeyId, a.keyId.trim());
      if (typeof a.vendorNumber === "string") await setSetting(SETTING_KEYS.ascVendorNumber, a.vendorNumber.trim());
      // blank = keep the key already on file; the field is never prefilled
      if (typeof a.privateKey === "string" && a.privateKey.trim()) await setSetting(SETTING_KEYS.ascPrivateKey, normalizePem(a.privateKey));
    }
    if (body.invoice && typeof body.invoice === "object") {
      const inv = body.invoice as Record<string, unknown>;
      if (typeof inv.fromName === "string") await setSetting(SETTING_KEYS.invoiceFromName, inv.fromName.trim());
      if (typeof inv.fromDetails === "string") await setSetting(SETTING_KEYS.invoiceFromDetails, inv.fromDetails.trim());
      if (typeof inv.paymentInstructions === "string") await setSetting(SETTING_KEYS.invoicePaymentInstructions, inv.paymentInstructions.trim());
    }
    return ok({ saved: true });
  } catch (e) {
    return serverError(e);
  }
}
