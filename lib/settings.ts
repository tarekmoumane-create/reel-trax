import { prisma } from "./db";

// App config lives in the Setting table (key/value) so it's editable from the
// UI, with env vars as a fallback for secrets set on the host (Vercel).

export const SETTING_KEYS = {
  scrapeCreatorsApiKey: "scrapecreators_api_key",
  anthropicApiKey: "anthropic_api_key",
  lightReelApiKey: "lightreel_api_key",
  timeZone: "time_zone",
  cronSecret: "cron_secret",
} as const;

export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

/** ScrapeCreators key: DB setting wins, else env var. */
export async function getScrapeCreatorsKey(): Promise<string | null> {
  return (
    (await getSetting(SETTING_KEYS.scrapeCreatorsApiKey)) ||
    process.env.SCRAPECREATORS_API_KEY ||
    null
  );
}

/** Anthropic key for the AI copilot: DB setting wins, else env var. */
export async function getAnthropicKey(): Promise<string | null> {
  return (
    (await getSetting(SETTING_KEYS.anthropicApiKey)) ||
    process.env.ANTHROPIC_API_KEY ||
    null
  );
}

/** LightReel key for the Discover / research feature. */
export async function getLightReelKey(): Promise<string | null> {
  return (
    (await getSetting(SETTING_KEYS.lightReelApiKey)) ||
    process.env.LIGHTREEL_API_KEY ||
    null
  );
}

export async function getTimeZone(): Promise<string> {
  return (
    (await getSetting(SETTING_KEYS.timeZone)) ||
    process.env.APP_TIMEZONE ||
    "America/New_York"
  );
}
