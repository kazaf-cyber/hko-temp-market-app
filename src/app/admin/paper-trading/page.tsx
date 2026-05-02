import PaperTradingPanel from "@/components/PaperTradingPanel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Paper Trading Admin",
  description: "Admin UI for auto paper trading"
};

export default function PaperTradingAdminPage() {
  return <PaperTradingPanel />;
}
