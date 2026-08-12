"use client";
import { ComingSoon } from "@/components/ComingSoon";

export default function AccountsPage() {
  return (
    <ComingSoon
      crumbs={["Analytics", "Accounts"]}
      title="Accounts"
      sub="Every tracked TikTok & Instagram account across your creators."
      bullets={[
        "One row per social account with its own post-activity strip and follower / view counts.",
        "Filter by platform, tag, or the creator it belongs to.",
        "Jump straight into an account's full analytics and video history.",
      ]}
    />
  );
}
