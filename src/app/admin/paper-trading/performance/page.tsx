import PaperTradingPerformancePanel from "@/components/PaperTradingPerformancePanel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Paper Trading Performance",
  description: "Read-only paper trading performance analytics"
};

export default function PaperTradingPerformancePage() {
  return <PaperTradingPerformancePanel />;
}
