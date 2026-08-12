"use client";
import { ComingSoon } from "@/components/ComingSoon";

export default function VideosPage() {
  return (
    <ComingSoon
      crumbs={["Analytics", "Videos"]}
      title="Videos"
      sub="Every post pulled in, across all creators for this client."
      bullets={[
        "Sortable table of posts with views, likes, comments and posted date.",
        "Filter by platform, creator, or date range.",
        "Spot the top performers and the duds at a glance.",
      ]}
    />
  );
}
