import OpenAI from "openai";
import type {
  ForecastResult,
  HkoWeatherSnapshot,
  MarketState
} from "@/types";

type PoeErrorSummary = {
  status: number | null;
  code: string | null;
  type: string | null;
  message: string;
};

function getPoeErrorSummary(error: unknown): PoeErrorSummary {
  const err = error as {
    status?: number;
    code?: string;
    type?: string;
    message?: string;
    error?: {
      code?: string;
      type?: string;
      message?: string;
    };
  };

  return {
    status: err.status ?? null,
    code: err.code ?? err.error?.code ?? null,
    type: err.type ?? err.error?.type ?? null,
    message: err.message ?? err.error?.message ?? "Unknown Poe API error"
  };
}

function getOutcomeMarketPrice(outcome: {
  clobMidpoint?: unknown;
  marketPrice?: unknown;
  price?: unknown;
}) {
  if (typeof outcome.clobMidpoint === "number") {
    return outcome.clobMidpoint;
  }

  if (typeof outcome.marketPrice === "number") {
    return outcome.marketPrice;
  }

  if (typeof outcome.price === "number") {
    return outcome.price;
  }

  return null;
}

export async function generatePoeExplanation(params: {
  snapshot: HkoWeatherSnapshot;
  state: MarketState;
  forecast: Omit<ForecastResult, "aiExplanation"> | ForecastResult;
}) {
  const apiKey = process.env.POE_API_KEY;
  const model = process.env.POE_MODEL || "Claude-Sonnet-4.5";

  if (!apiKey) {
    return "AI explanation skipped: POE_API_KEY is not configured on the server.";
  }

  try {
    const client = new OpenAI({
      apiKey,
      baseURL: "https://api.poe.com/v1"
    });

    const marketVsModel = params.state.outcomes.map((outcome) => {
      const modelProbability =
        params.forecast.outcomeProbabilities?.find(
          (item) => item.name === outcome.name
        )?.probability ?? null;

      const polymarketProbability = getOutcomeMarketPrice(outcome);

      const edge =
        typeof modelProbability === "number" &&
        typeof polymarketProbability === "number"
          ? modelProbability - polymarketProbability
          : null;

      return {
        name: outcome.name,
        lower: outcome.lower,
        upper: outcome.upper,

        /**
         * Polymarket market probability.
         * Prefer CLOB midpoint if available.
         * Fall back to Gamma price.
         */
        polymarketProbability,

        /**
         * App model probability.
         */
        modelProbability,

        /**
         * Edge = modelProbability - polymarketProbability.
         */
        edge,

        marketPriceSource:
          typeof outcome.marketPriceSource === "string"
            ? outcome.marketPriceSource
            : null,

        clobMidpoint:
          typeof outcome.clobMidpoint === "number"
            ? outcome.clobMidpoint
            : null,

        yesAsk:
          typeof outcome.yesAsk === "number" ? outcome.yesAsk : null,

        noAsk:
          typeof outcome.noAsk === "number" ? outcome.noAsk : null,

        yesBid:
          typeof outcome.yesBid === "number" ? outcome.yesBid : null,

        clobSpread:
          typeof outcome.clobSpread === "number" ? outcome.clobSpread : null
      };
    });

    const payload = {
      hkoCurrent: params.snapshot.current,
      hkoSinceMidnight: params.snapshot.sinceMidnight ?? null,
      hkoHourlyRainfall: params.snapshot.hourlyRainfall ?? null,
      hkoForecastFirstThreeDays:
        params.snapshot.forecast?.days?.slice(0, 3) ?? [],

      marketState: {
        rainEtaMinutes: params.state.rainEtaMinutes,
        rainProbability60m: params.state.rainProbability60m,
        rainProbability120m: params.state.rainProbability120m,
        expectedRainIntensity: params.state.expectedRainIntensity,
        cloudCoverPct: params.state.cloudCoverPct,
        useAI: params.state.useAI
      },

      /**
       * Very important:
       * This table separates market prices from model probabilities.
       */
      marketVsModel,

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
      max_tokens: 520,
      messages: [
        {
          role: "system",
          content: [
            "You are a Hong Kong weather prediction market analyst.",
            "You must clearly distinguish Polymarket market prices from the app's weather model probabilities.",
            "Never call model probabilities 'market odds' or 'market probabilities'.",
            "Use 'Polymarket 盤口 / 市場價格' only for polymarketProbability, marketPrice, clobMidpoint, yesAsk, noAsk, or yesBid.",
            "Use '模型概率' only for outcomeProbabilities generated by the forecast model.",
            "Edge means modelProbability minus Polymarket market probability.",
            "If modelProbability and Polymarket probability disagree strongly, explain the disagreement and warn about data quality.",
            "Do not claim final settlement.",
            "Final settlement depends on finalized official HKO data and the market's resolution rules.",
            "Answer in Traditional Chinese with a Hong Kong Cantonese tone."
          ].join("\n")
        },
        {
          role: "user",
          content: `請根據以下 JSON，用繁體中文加少少香港粵語語氣分析。

你必須清楚分開以下三種數字：

1. Polymarket 盤口 / 市場價格：
   來自 marketVsModel[].polymarketProbability、clobMidpoint、yesAsk、noAsk、yesBid。
   這代表市場目前價格。

2. 模型概率：
   來自 marketVsModel[].modelProbability 或 modelForecast.outcomeProbabilities。
   這是 App 的天氣模型估計，不是市場賠率。

3. Edge：
   edge = 模型概率 - Polymarket 盤口。

嚴禁把模型概率稱為「市場賠率」。
如果 25°C 的模型概率是 64%，但 Polymarket 只有 19%，你必須寫：
「模型估 25°C 約64%，但 Polymarket 盤口約19%，edge 約+45%。」
不要寫：
「市場認為 25°C 約64%。」

請輸出以下段落：

1. Polymarket 盤口重點
2. 模型概率重點
3. 最大分歧 / edge
4. 天氣驅動因素
5. settlement / data risk

特別注意：
- 如果 maxSoFarSource 是 current_temperature_fallback，要明確提示風險，因為它不是 HKO since-midnight max 官方 feed。
- 如果 HKO since-midnight max 缺失，要提醒低溫 bucket 可能被高估。
- 如果某 outcome 已接近或穿過整數 boundary，例如 25.9°C / 26.0°C，要提醒 boundary risk。

資料 JSON：
${JSON.stringify(payload, null, 2)}`
        }
      ]
    });

    const content = completion.choices[0]?.message?.content;

    if (typeof content === "string" && content.trim().length > 0) {
      return content.trim();
    }

    return "AI explanation returned empty content.";
  } catch (error) {
    const summary = getPoeErrorSummary(error);

    console.error("Poe API error:", summary);

    return [
      "AI explanation temporarily failed.",
      `Poe status: ${summary.status ?? "unknown"}`,
      `Type: ${summary.type ?? "unknown"}`,
      `Code: ${summary.code ?? "unknown"}`,
      `Message: ${summary.message}`
    ].join("\n");
  }
}
