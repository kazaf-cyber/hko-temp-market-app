import type { MarketState, OutcomeRange } from "@/types";

export const defaultOutcomes: OutcomeRange[] = [
  {
    name: "19°C or lower",
    lower: null,
    upper: 20
  },
  {
    name: "20°C",
    lower: 20,
    upper: 21
  },
  {
    name: "21°C",
    lower: 21,
    upper: 22
  },
  {
    name: "22°C or higher",
    lower: 22,
    upper: null
  }
];

export const defaultMarketState: MarketState = {
  stationCode: "HKO",
  stationName: "Hong Kong Observatory",
  manualMaxOverrideC: null,
  rainEtaMinutes: 60,
  rainProbability60m: 0.65,
  rainProbability120m: 0.75,
  expectedRainIntensity: "moderate",
  cloudCoverPct: 85,
  useAI: true,
  outcomes: defaultOutcomes
};
