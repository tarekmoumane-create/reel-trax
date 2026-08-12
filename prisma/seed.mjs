// Demo data so the dashboard isn't empty on first run.
// Run: node prisma/seed.mjs   (wipes creators/posts/clients first)
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const DAY = 86400000;
const now = Date.now();

function post(creatorId, platform, dayOffset, i) {
  return {
    creatorId,
    platform,
    platformPostId: `seed-${creatorId}-${platform}-${dayOffset}-${i}`,
    url:
      platform === "tiktok"
        ? `https://www.tiktok.com/@demo/video/${dayOffset}${i}`
        : `https://www.instagram.com/p/seed${dayOffset}${i}/`,
    caption: ["POV: you finally tried it 👀", "Day in my life", "This changed everything", "Watch till the end", "Restocking soon"][i % 5],
    postedAt: new Date(now - dayOffset * DAY - i * 3600_000),
    views: Math.floor(2000 + Math.random() * 90000),
    likes: Math.floor(100 + Math.random() * 8000),
    comments: Math.floor(Math.random() * 300),
    shares: Math.floor(Math.random() * 200),
    source: "auto",
  };
}

async function main() {
  await prisma.post.deleteMany();
  await prisma.creator.deleteMany();
  await prisma.client.deleteMany();

  const acme = await prisma.client.create({
    data: { name: "Acme Supplements", color: "#7c5cff" },
  });
  const peak = await prisma.client.create({
    data: { name: "Peak Performance", color: "#22c55e" },
  });

  // helper to make a creator + posts on a set of day-offsets
  async function makeCreator(clientId, data, dayOffsets, platform = "tiktok") {
    const c = await prisma.creator.create({
      data: {
        clientId,
        lastSyncedAt: new Date(now - 2 * 3600_000),
        lastSyncStatus: "ok",
        ...data,
      },
    });
    const posts = dayOffsets.map((d, i) => post(c.id, platform, d, i));
    if (posts.length) await prisma.post.createMany({ data: posts });
    return c;
  }

  // Jane — daily poster, on track
  await makeCreator(
    acme.id,
    {
      displayName: "Jane Rivera",
      tiktokHandle: "janerivera",
      tiktokUrl: "https://www.tiktok.com/@janerivera",
      instagramHandle: "jane.rivera",
      instagramUrl: "https://www.instagram.com/jane.rivera",
      source: "sideshift",
      expectedPerWeek: 7,
      phone: "+1 555 0142",
      preferredChannel: "imessage",
      lastContactedAt: new Date(now - 3 * DAY),
      notes: "Prefers evening shoots. Pays via Venmo.",
    },
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22]
  );

  // Marco — behind (posting but under target)
  await makeCreator(
    acme.id,
    {
      displayName: "Marco Bianchi",
      tiktokHandle: "marcob",
      tiktokUrl: "https://www.tiktok.com/@marcob",
      source: "sideshift",
      expectedPerWeek: 7,
      phone: "+1 555 0199",
      preferredChannel: "sms",
      lastContactedAt: new Date(now - 6 * DAY),
      followUpAt: new Date(now - 1 * DAY), // overdue follow-up
      notes: "Slow to respond. Chase every few days.",
    },
    [1, 4, 9, 15]
  );

  // Lena — gone quiet
  await makeCreator(
    acme.id,
    {
      displayName: "Lena Okafor",
      instagramHandle: "lena.okafor",
      instagramUrl: "https://www.instagram.com/lena.okafor",
      source: "referral",
      sourceDetail: "via Jane",
      expectedPerWeek: 5,
      preferredChannel: "instagram",
      lastContactedAt: new Date(now - 12 * DAY),
      followUpAt: new Date(now - 2 * DAY),
    },
    [11, 13, 15, 18],
    "instagram"
  );

  // Priya — onboarded, no posts yet
  await makeCreator(
    acme.id,
    {
      displayName: "Priya Nair",
      tiktokHandle: "priyacreates",
      tiktokUrl: "https://www.tiktok.com/@priyacreates",
      source: "outreach",
      expectedPerWeek: 4,
      lastSyncStatus: "ok",
    },
    []
  );

  // Peak Performance client
  await makeCreator(
    peak.id,
    {
      displayName: "Tyler Brooks",
      tiktokHandle: "tylerlifts",
      tiktokUrl: "https://www.tiktok.com/@tylerlifts",
      source: "sideshift",
      expectedPerWeek: 3,
      preferredChannel: "whatsapp",
    },
    [0, 2, 5, 6, 9, 12]
  );
  await makeCreator(
    peak.id,
    {
      displayName: "Sofia Marin",
      instagramHandle: "sofiamarin",
      instagramUrl: "https://www.instagram.com/sofiamarin",
      source: "agency",
      expectedPerWeek: 5,
      lastContactedAt: new Date(now - 1 * DAY),
    },
    [1, 2, 3, 6, 8],
    "instagram"
  );

  const clients = await prisma.client.count();
  const creators = await prisma.creator.count();
  const posts = await prisma.post.count();
  console.log(`Seeded ${clients} clients, ${creators} creators, ${posts} posts.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
