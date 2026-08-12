"use client";
import { ComingSoon } from "@/components/ComingSoon";

export default function PayoutsPage() {
  return (
    <ComingSoon
      crumbs={["Creator Hub", "Payouts"]}
      title="Payouts"
      sub="Track what each creator is owed across campaigns."
      bullets={[
        "Status ledger: upcoming, due, paid, and cancelled payouts per billing period.",
        "Amounts calculated automatically from campaign rules and tracked performance.",
        "Mark paid and export statements. (Tracking only — no money movement.)",
      ]}
    />
  );
}
