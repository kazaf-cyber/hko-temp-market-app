import OpenAI from "openai";
import type {
  ForecastResult,
  HkoWeatherSnapshot,
  MarketState
} from "@/types";

export async function generatePoeExplanation(params: {
  snapshot: HkoWeatherSnapshot;
  state: MarketState;
  forecast: Omit<ForecastResult, "aiExplanation">;
}) {
  const apiKey = process.env.POE_API_KEY;
  const model = process.env.POE_MODEL || "Claude-Sonnet-4.6";

  if (!apiKey) {
    return "AI explanation skipped: POE_API_KEY is not configured on the server.";
  }

  try {
    const client = new OpenAI({
      apiKey,
      baseURL: "https://api.poe.com/v1"
    });

    const payload = {
      hkoCurrent: params.snapshot.current,
      hkoSinceMidnight: params.snapshot.sinceMidnight,
      hkoHourlyRainfall: params.snapshot.hourlyRainfall,
      hkoForecastFirstThreeDays: params.snapshot.forecast.days.slice(0, 3),
      marketState: params.state,
      modelForecast: {
        hktDate: params.forecast.hktDate,
        maxSoFarC: params.forecast.maxSoFarC,
        maxSoFarSource: params.forecast.maxSoFarSource,
        estimatedFinalMaxC: params.forecast.estimatedFinalMaxC,
        outcomeProbabilities: params.forecast.outcomeProbabilities,
        keyDrivers: params.forecast.keyDrivers,
        warnings: params.forecast.warnings
      }
    };

    const completion = await client.chat.completions.create({
      model,
      temperature: 0.2,
      max_tokens: 420,
      messages: [
        {
          role: "system",
          content:
            "You are a Hong Kong weather prediction market analyst. Explain probability changes clearly in Traditional Chinese with a Hong Kong Cantonese tone. Do not claim final settlement. Settlement depends on finalized official HKO data and market rules."
        },
        {
          role: "user",
          content: `請根據以下 JSON，用繁體中文加少少香港粵語語氣，解釋香港天文台最高氣溫 prediction market 即時概率。必須重點講：今日目前最高氣溫、雨帶 ETA、雨勢、雲量、HKO 官方預報、boundary risk、final settlement 風險。不要超過 260 字。\n\n${JSON.stringify(
            payload,
            null,
            2
          )}`
        }
      ]
    });

    const content = completion.choices[0]?.message?.content;

    if (typeof content === "string" && content.trim().length > 0) {
      return content.trim();
    }

    return "AI explanation returned empty content.";
  } catch (error) {
    console.error("Poe API error:", error);
    return "AI explanation temporarily failed. Please check POE_API_KEY, POE_MODEL, or Vercel function logs.";
  }
}
