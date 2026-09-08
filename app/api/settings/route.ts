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

function mask(key: string | null): string | null {
  if (!key) return null;
  if (key.length <= 6) return "••••";
  return `${key.slice(0, 3)}••••${key.slice(-3)}`;
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
