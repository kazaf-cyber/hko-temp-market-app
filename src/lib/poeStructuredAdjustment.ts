import OpenAI from "openai";
import { z } from "zod";

import {
  summarizeForecastForPrompt,
  type ForecastOutcome,
  type ForecastResult,
} from "@/lib/forecast";

const DEFAULT_POE_MODEL = "Claude-Opus-4.7";

const EvidenceTagSchema = z.enum([
  "observed_floor",
  "current_temperature",
  "hko_official_forecast",
  "open_meteo",
  "windy",
  "solar_heating",
  "cloud_cooling",
  "rain_cooling",
  "humidity",
  "wind",
  "model_disagreement",
  "time_of_day",
  "market_dislocation",
  "data_quality",
  "other",
]);

const OutcomeAdjustmentSchema = z.object({
  index: z.number().int().min(0),
  lower: z.number().nullable(),
  upper: z.number().nullable(),

  /**
   * Percentage points, not probability units.
   *
   * Example:
   * +3.5 means +3.5 percentage points.
   * -2 means -2 percentage points.
   */
  adjustmentPct: z.number().min(-8).max(8),

  /**
   * Advisory only.
   * The application will recompute normalized probabilities itself.
   */
  suggestedAdjustedProbabilityPct: z.number().min(0).max(100),

  reason: z.string(),
  evidenceTags: z.array(EvidenceTagSchema),
});

export const PoeStructuredAdjustmentSchema = z.object({
  shouldApply: z.boolean(),

  confidence: z.enum(["low", "medium", "high"]),

  /**
   * Qualitative directional bias only.
   * This is not used as a direct temperature forecast.
   */
  globalTemperatureBiasC: z.number().min(-1.5).max(1.5),

  /**
   * Model-requested cap.
   * Application still applies its own hard confidence cap.
   */
  maxAbsoluteAdjustmentPct: z.number().min(0).max(8),

  rationale: z.string(),

  outcomeAdjustments: z.array(OutcomeAdjustmentSchema),

  warnings: z.array(z.string()),
  watchPoints: z.array(z.string()),
});

export type PoeStructuredAdjustment = z.infer<
  typeof PoeStructuredAdjustmentSchema
>;

export type PoeStructuredAdjustmentRun = {
  enabled: boolean;
  applied: boolean;
  model: string | null;
  adjustment: PoeStructuredAdjustment | null;
  error: string | null;
  rawText?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundProbability(value: number) {
  return Math.round(clamp(value, 0, 1) * 10000) / 10000;
}

function roundPct(value: number) {
  return Math.round(value * 100) / 100;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value.trim().replace(/%$/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function getOutcomeProbability(outcome: unknown): number {
  if (!isRecord(outcome)) return 0;

  const candidates = [
    outcome.finalProbability,
    outcome.blendedProbability,
    outcome.probability,
    outcome.weatherProbability,
    outcome.modelProbability,
  ];

  for (const candidate of candidates) {
    const parsed = numberOrNull(candidate);

    if (parsed === null) continue;

    if (parsed >= 0 && parsed <= 1) {
      return parsed;
    }

    if (parsed > 1 && parsed <= 100) {
      return parsed / 100;
    }
  }

  return 0;
}

function getOutcomeIndex(outcome: unknown, fallbackIndex: number): number {
  if (!isRecord(outcome)) return fallbackIndex;

  const parsed = numberOrNull(outcome.index);

  if (parsed === null) return fallbackIndex;

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallbackIndex;
}

function isImpossibleOutcome(outcome: unknown): boolean {
  if (!isRecord(outcome)) return false;

  return (
    outcome.isImpossibleByObservedMax === true ||
    outcome.impossibleByObservedMax === true
  );
}

function writeOutcomeProbability<T extends Record<string, unknown>>(
  outcome: T,
  probability: number,
  adjustment: number,
  phase4Adjusted: boolean,
): T {
  const nextProbability = roundProbability(probability);
  const nextPct = roundPct(nextProbability * 100);
  const adjustmentPct = roundPct(adjustment * 100);

  return {
    ...outcome,

    /**
     * Phase 4 audit fields.
     */
    phase4Adjusted,
    poeAdjustedProbability: nextProbability,
    poeAdjustedProbabilityPct: nextPct,
    poeAdjustmentPct: adjustmentPct,

    /**
     * Keep LLM aliases too, in case your UI later expects generic LLM names.
     */
    llmAdjustedProbability: nextProbability,
    llmAdjustedProbabilityPct: nextPct,
    llmAdjustmentPct: adjustmentPct,

    /**
     * Main probability fields used by UI / trade-signal layer.
     */
    probability: nextProbability,
    probabilityPct: nextPct,
    finalProbability: nextProbability,
    finalProbabilityPct: nextPct,
    blendedProbability: nextProbability,
    blendedProbabilityPct: nextPct,
  };
}

function normalizeOutcomes<T extends Record<string, unknown>>(
  outcomes: T[],
): T[] {
  const eligible = outcomes.filter((outcome) => !isImpossibleOutcome(outcome));

  const eligibleSum = eligible.reduce(
    (sum, outcome) => sum + getOutcomeProbability(outcome),
    0,
  );

  if (!Number.isFinite(eligibleSum) || eligibleSum <= 0) {
    return outcomes;
  }

  return outcomes.map((outcome) => {
    if (isImpossibleOutcome(outcome)) {
      return writeOutcomeProbability(outcome, 0, 0, true);
    }

    const current = getOutcomeProbability(outcome);
    const normalized = roundProbability(current / eligibleSum);

    return writeOutcomeProbability(
      outcome,
      normalized,
      normalized - current,
      true,
    );
  });
}

function buildPoeJsonSchema() {
  /**
   * Keep this schema simple and explicit.
   * Poe Responses API accepts JSON schema through text.format.
   */
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      shouldApply: {
        type: "boolean",
      },
      confidence: {
        type: "string",
        enum: ["low", "medium", "high"],
      },
      globalTemperatureBiasC: {
        type: "number",
        minimum: -1.5,
        maximum: 1.5,
      },
      maxAbsoluteAdjustmentPct: {
        type: "number",
        minimum: 0,
        maximum: 8,
      },
      rationale: {
        type: "string",
      },
      outcomeAdjustments: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            index: {
              type: "integer",
              minimum: 0,
            },
            lower: {
              anyOf: [{ type: "number" }, { type: "null" }],
            },
            upper: {
              anyOf: [{ type: "number" }, { type: "null" }],
            },
            adjustmentPct: {
              type: "number",
              minimum: -8,
              maximum: 8,
            },
            suggestedAdjustedProbabilityPct: {
              type: "number",
              minimum: 0,
              maximum: 100,
            },
            reason: {
              type: "string",
            },
            evidenceTags: {
              type: "array",
              items: {
                type: "string",
                enum: [
                  "observed_floor",
                  "current_temperature",
                  "hko_official_forecast",
                  "open_meteo",
                  "windy",
                  "solar_heating",
                  "cloud_cooling",
                  "rain_cooling",
                  "humidity",
                  "wind",
                  "model_disagreement",
                  "time_of_day",
                  "market_dislocation",
                  "data_quality",
                  "other",
                ],
              },
            },
          },
          required: [
            "index",
            "lower",
            "upper",
            "adjustmentPct",
            "suggestedAdjustedProbabilityPct",
            "reason",
            "evidenceTags",
          ],
        },
      },
      warnings: {
        type: "array",
        items: {
          type: "string",
        },
      },
      watchPoints: {
        type: "array",
        items: {
          type: "string",
        },
      },
    },
    required: [
      "shouldApply",
      "confidence",
      "globalTemperatureBiasC",
      "maxAbsoluteAdjustmentPct",
      "rationale",
      "outcomeAdjustments",
      "warnings",
      "watchPoints",
    ],
  };
}

function buildAdjustmentPrompt(forecast: ForecastResult) {
  const compact = summarizeForecastForPrompt(forecast);

  return [
    "You are a cautious meteorological calibration layer for a Hong Kong Observatory daily maximum temperature probability model.",
    "",
    "Return only the structured JSON object requested by the schema.",
    "",
    "Your task:",
    "- Review the supplied forecast JSON.",
    "- Suggest small bounded probability adjustments by outcome.",
    "- Use weather evidence only as the primary basis.",
    "- Market prices may be mentioned only as disagreement context, never as the main weather driver.",
    "",
    "Hard rules:",
    "1. Do not invent weather observations, radar, satellite, alerts, temperatures, or data sources not in JSON.",
    "2. Do not create new temperature buckets.",
    "3. Do not change outcome indexes.",
    "4. adjustmentPct is in percentage points, not probability units.",
    "5. If evidence is weak, set shouldApply=false or use near-zero adjustments.",
    "6. Impossible outcomes by observed max must not receive positive adjustments.",
    "7. HKO observed max lower bound is a hard floor.",
    "8. HKO official forecast max is a forecast prior, not an observation.",
    "9. Never provide investment advice.",
    "",
    "Calibration guidance:",
    "- Most adjustments should be between -3pp and +3pp.",
    "- Only use up to ±8pp for unusually clear evidence.",
    "- Keep total probability movement small.",
    "- Prefer no adjustment over speculative adjustment.",
    "",
    "Forecast JSON:",
    "```json",
    JSON.stringify(compact, null, 2),
    "```",
  ].join("\n");
}

function extractJsonFromText(text: string): unknown {
  const trimmed = text.trim();

  /**
   * Best case: Poe model obeys text.format and output_text is plain JSON.
   */
  try {
    return JSON.parse(trimmed);
  } catch {
    // Continue to fallback extraction.
  }

  /**
   * Fallback: handle accidental ```json fenced block.
   */
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);

  if (fencedMatch?.[1]) {
    return JSON.parse(fencedMatch[1].trim());
  }

  /**
   * Fallback: extract first JSON object-looking span.
   * This is intentionally conservative.
   */
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  }

  throw new Error("Poe structured adjustment response was not valid JSON.");
}

export async function getPoeStructuredAdjustment(
  forecast: ForecastResult,
): Promise<PoeStructuredAdjustmentRun> {
  const apiKey = process.env.POE_API_KEY;
  const model =
    process.env.POE_STRUCTURED_ADJUSTMENT_MODEL ??
    process.env.POE_MODEL ??
    DEFAULT_POE_MODEL;

  if (!apiKey) {
    return {
      enabled: false,
      applied: false,
      model,
      adjustment: null,
      error: "POE_API_KEY is not configured.",
      rawText: null,
    };
  }

  try {
    const client = new OpenAI({
      apiKey,
      baseURL: "https://api.poe.com/v1",
    });

    const response = await client.responses.create({
      model,
      temperature: 0.1,
      max_output_tokens: 2500,
      input: [
        {
          role: "system",
          content:
            "You are a careful probabilistic weather-model calibration layer. Return structured JSON only. Do not provide investment advice.",
        },
        {
          role: "user",
          content: buildAdjustmentPrompt(forecast),
        },
      ],

      /**
       * Important:
       * This is Poe Responses API text.format, not Chat Completions response_format.
       */
      text: {
        format: {
          type: "json_schema",
          name: "poe_forecast_structured_adjustment",
          schema: buildPoeJsonSchema(),
        },
      },
    });

    const rawText = response.output_text ?? "";

    const parsedJson = extractJsonFromText(rawText);
    const parsed = PoeStructuredAdjustmentSchema.safeParse(parsedJson);

    if (!parsed.success) {
      return {
        enabled: true,
        applied: false,
        model,
        adjustment: null,
        error: `Poe structured adjustment failed Zod validation: ${parsed.error.message}`,
        rawText,
      };
    }

    return {
      enabled: true,
      applied: parsed.data.shouldApply,
      model,
      adjustment: parsed.data,
      error: null,
      rawText,
    };
  } catch (error) {
    return {
      enabled: true,
      applied: false,
      model,
      adjustment: null,
      error:
        error instanceof Error
          ? error.message
          : "Unknown Poe structured adjustment error.",
      rawText: null,
    };
  }
}

export function applyPoeStructuredAdjustment(
  forecast: ForecastResult,
  run: PoeStructuredAdjustmentRun | null | undefined,
): ForecastResult {
  if (!run?.adjustment || !run.adjustment.shouldApply) {
    return {
      ...forecast,
      diagnostics: {
        ...forecast.diagnostics,
        phase4PoeAdjustment: {
          enabled: Boolean(run?.enabled),
          applied: false,
          model: run?.model ?? null,
          error: run?.error ?? null,
          reason: run?.adjustment
            ? "Poe returned shouldApply=false."
            : "No Poe structured adjustment was available.",
        },

        /**
         * Optional generic alias for UI.
         */
        phase4LlmAdjustment: {
          enabled: Boolean(run?.enabled),
          applied: false,
          provider: "poe",
          model: run?.model ?? null,
          error: run?.error ?? null,
          reason: run?.adjustment
            ? "Poe returned shouldApply=false."
            : "No Poe structured adjustment was available.",
        },
      },
    } as ForecastResult;
  }

  const rawOutcomes = Array.isArray(forecast.outcomeProbabilities)
    ? forecast.outcomeProbabilities
    : Array.isArray(forecast.outcomes)
      ? forecast.outcomes
      : Array.isArray(forecast.probabilities)
        ? forecast.probabilities
        : [];

  const outcomeRecords = rawOutcomes.filter(isRecord);

  if (!outcomeRecords.length) {
    return {
      ...forecast,
      diagnostics: {
        ...forecast.diagnostics,
        phase4PoeAdjustment: {
          enabled: run.enabled,
          applied: false,
          model: run.model,
          error: "No outcome rows were available to adjust.",
          adjustment: run.adjustment,
        },
        phase4LlmAdjustment: {
          enabled: run.enabled,
          applied: false,
          provider: "poe",
          model: run.model,
          error: "No outcome rows were available to adjust.",
          adjustment: run.adjustment,
        },
      },
    } as ForecastResult;
  }

  const adjustmentByIndex = new Map(
    run.adjustment.outcomeAdjustments.map((item) => [item.index, item]),
  );

  /**
   * Hard application caps:
   *
   * low confidence    => max ±2pp
   * medium confidence => max ±5pp
   * high confidence   => max ±8pp
   */
  const confidenceCapPct =
    run.adjustment.confidence === "high"
      ? 8
      : run.adjustment.confidence === "medium"
        ? 5
        : 2;

  const requestedCapPct = clamp(
    run.adjustment.maxAbsoluteAdjustmentPct,
    0,
    confidenceCapPct,
  );

  const adjustedPreNormalize = outcomeRecords.map((outcome, fallbackIndex) => {
    const index = getOutcomeIndex(outcome, fallbackIndex);
    const baseProbability = getOutcomeProbability(outcome);

    if (isImpossibleOutcome(outcome)) {
      return writeOutcomeProbability(outcome, 0, -baseProbability, true);
    }

    const requested = adjustmentByIndex.get(index);
    const requestedDeltaPct = requested?.adjustmentPct ?? 0;

    const cappedDeltaPct = clamp(
      requestedDeltaPct,
      -requestedCapPct,
      requestedCapPct,
    );

    const cappedDelta = cappedDeltaPct / 100;
    const adjusted = roundProbability(baseProbability + cappedDelta);

    return {
      ...writeOutcomeProbability(
        outcome,
        adjusted,
        adjusted - baseProbability,
        true,
      ),
      poeAdjustmentReason: requested?.reason ?? null,
      poeAdjustmentEvidenceTags: requested?.evidenceTags ?? [],

      /**
       * Generic aliases.
       */
      llmAdjustmentReason: requested?.reason ?? null,
      llmAdjustmentEvidenceTags: requested?.evidenceTags ?? [],
    };
  });

  const normalized = normalizeOutcomes(adjustedPreNormalize);

  const topOutcome =
    [...normalized].sort(
      (a, b) => getOutcomeProbability(b) - getOutcomeProbability(a),
    )[0] ?? null;

  const phase4Diagnostics = {
    enabled: run.enabled,
    applied: true,
    provider: "poe",
    model: run.model,
    error: run.error,
    confidence: run.adjustment.confidence,
    globalTemperatureBiasC: run.adjustment.globalTemperatureBiasC,
    maxAbsoluteAdjustmentPct: requestedCapPct,
    rationale: run.adjustment.rationale,
    warnings: run.adjustment.warnings,
    watchPoints: run.adjustment.watchPoints,
    adjustment: run.adjustment,
  };

  const nextForecast = {
    ...forecast,
    outcomeProbabilities: normalized as unknown as ForecastOutcome[],
    outcomes: normalized as unknown as ForecastOutcome[],
    probabilities: normalized as unknown as ForecastOutcome[],
    topOutcome: topOutcome as unknown as ForecastOutcome | null,
    diagnostics: {
      ...forecast.diagnostics,
      phase4PoeAdjustment: phase4Diagnostics,
      phase4LlmAdjustment: phase4Diagnostics,
    },
    warnings: [
      ...(Array.isArray(forecast.warnings) ? forecast.warnings : []),
      ...run.adjustment.warnings.map((item) => `Phase 4 Poe: ${item}`),
    ],
    keyDrivers: [
      ...(Array.isArray(forecast.keyDrivers) ? forecast.keyDrivers : []),
      `Phase 4 Poe structured adjustment applied: ${run.adjustment.rationale}`,
    ],
  };

  return nextForecast as ForecastResult;
}
