"use client";
import { ComingSoon } from "@/components/ComingSoon";

export default function CampaignsPage() {
  return (
    <ComingSoon
      crumbs={["Creator Hub", "Campaigns"]}
      title="Campaigns"
      sub="Group creators, set targets and payout rules per client."
      bullets={[
        "Create a campaign with a target (e.g. 20 posts / month) and an active window.",
        "Set payout rules: base fee, flat per-post, CPM, and bonuses.",
        "Assign creators, then auto-calculate what each earned from tracked views.",
      ]}
    />
  );
}
