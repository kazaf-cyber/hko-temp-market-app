import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import {
  summarizeForecastForPrompt,
  type ForecastOutcome,
  type ForecastResult,
} from "@/lib/forecast";

const DEFAULT_MODEL = "gpt-4o-mini";

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
   * Example:
   *   +3.5 means +3.5 percentage points.
   *   -2 means -2 percentage points.
   */
  adjustmentPct: z.number().min(-8).max(8),

  /**
   * This is advisory only.
   * The application will recompute final normalized probabilities itself.
   */
  suggestedAdjustedProbabilityPct: z.number().min(0).max(100),

  reason: z.string(),
  evidenceTags: z.array(EvidenceTagSchema),
});

export const ForecastStructuredAdjustmentSchema = z.object({
  shouldApply: z.boolean(),

  confidence: z.enum(["low", "medium", "high"]),

  /**
   * Global qualitative bias only.
   * This must not be treated as a direct temperature forecast.
   */
  globalTemperatureBiasC: z.number().min(-1.5).max(1.5),

  /**
   * Max absolute per-outcome adjustment requested by the model.
   * Application code still applies its own hard cap.
   */
  maxAbsoluteAdjustmentPct: z.number().min(0).max(8),

  rationale: z.string(),

  outcomeAdjustments: z.array(OutcomeAdjustmentSchema),

  warnings: z.array(z.string()),
  watchPoints: z.array(z.string()),
});

export type ForecastStructuredAdjustment = z.infer<
  typeof ForecastStructuredAdjustmentSchema
>;

export type LlmStructuredAdjustmentRun = {
  enabled: boolean;
  applied: boolean;
  model: string | null;
  adjustment: ForecastStructuredAdjustment | null;
  error: string | null;
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
  if (typeof value === "number" && Number.isFinite(value)) return value;
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

function getOutcomeRange(outcome: unknown): {
  lower: number | null;
  upper: number | null;
} {
  if (!isRecord(outcome)) {
    return { lower: null, upper: null };
  }

  return {
    lower: numberOrNull(outcome.lower),
    upper: numberOrNull(outcome.upper),
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

    return writeOutcomeProbability(outcome, normalized, normalized - current, true);
  });
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
    llmAdjustedProbability: nextProbability,
    llmAdjustedProbabilityPct: nextPct,
    llmAdjustmentPct: adjustmentPct,

    /**
     * Main fields used by UI / trade signal layer.
     */
    probability: nextProbability,
    probabilityPct: nextPct,
    finalProbability: nextProbability,
    finalProbabilityPct: nextPct,
    blendedProbability: nextProbability,
    blendedProbabilityPct: nextPct,
  };
}

function buildAdjustmentPrompt(forecast: ForecastResult) {
  const compact = summarizeForecastForPrompt(forecast);

  return [
    "You are a cautious meteorological calibration layer for a Hong Kong Observatory daily maximum temperature probability model.",
    "",
    "You must return ONLY the requested structured JSON object.",
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
    "- Keep total movement small.",
    "- Prefer no adjustment over speculative adjustment.",
    "",
    "Forecast JSON:",
    "```json",
    JSON.stringify(compact, null, 2),
    "```",
  ].join("\n");
}

export async function getLlmStructuredAdjustment(
  forecast: ForecastResult,
): Promise<LlmStructuredAdjustmentRun> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model =
    process.env.OPENAI_STRUCTURED_ADJUSTMENT_MODEL ??
    process.env.OPENAI_MODEL ??
    DEFAULT_MODEL;

  if (!apiKey) {
    return {
      enabled: false,
      applied: false,
      model,
      adjustment: null,
      error: "OPENAI_API_KEY is not configured.",
    };
  }

  try {
    const openai = new OpenAI({ apiKey });

    const response = await openai.responses.parse({
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
      text: {
        format: zodTextFormat(
          ForecastStructuredAdjustmentSchema,
          "forecast_structured_adjustment",
        ),
      },
    });

    const parsed = response.output_parsed;

    if (!parsed) {
      return {
        enabled: true,
        applied: false,
        model,
        adjustment: null,
        error: "OpenAI structured adjustment returned no parsed output.",
      };
    }

    return {
      enabled: true,
      applied: parsed.shouldApply,
      model,
      adjustment: parsed,
      error: null,
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
          : "Unknown OpenAI structured adjustment error.",
    };
  }
}

export function applyLlmStructuredAdjustment(
  forecast: ForecastResult,
  run: LlmStructuredAdjustmentRun | null | undefined,
): ForecastResult {
  if (!run?.adjustment || !run.adjustment.shouldApply) {
    return {
      ...forecast,
      diagnostics: {
        ...forecast.diagnostics,
        phase4LlmAdjustment: {
          enabled: Boolean(run?.enabled),
          applied: false,
          model: run?.model ?? null,
          error: run?.error ?? null,
          reason: run?.adjustment
            ? "LLM returned shouldApply=false."
            : "No structured adjustment was available.",
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
        phase4LlmAdjustment: {
          enabled: run.enabled,
          applied: false,
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
   * Hard application caps.
   *
   * Low confidence: max ±2pp
   * Medium confidence: max ±5pp
   * High confidence: max ±8pp
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
      llmAdjustmentReason: requested?.reason ?? null,
      llmAdjustmentEvidenceTags: requested?.evidenceTags ?? [],
    };
  });

  const normalized = normalizeOutcomes(adjustedPreNormalize);

  const topOutcome =
    [...normalized].sort(
      (a, b) => getOutcomeProbability(b) - getOutcomeProbability(a),
    )[0] ?? null;

  const nextForecast = {
    ...forecast,
    outcomeProbabilities: normalized as unknown as ForecastOutcome[],
    outcomes: normalized as unknown as ForecastOutcome[],
    probabilities: normalized as unknown as ForecastOutcome[],
    topOutcome: topOutcome as unknown as ForecastOutcome | null,
    diagnostics: {
      ...forecast.diagnostics,
      phase4LlmAdjustment: {
        enabled: run.enabled,
        applied: true,
        model: run.model,
        error: run.error,
        confidence: run.adjustment.confidence,
        globalTemperatureBiasC: run.adjustment.globalTemperatureBiasC,
        maxAbsoluteAdjustmentPct: requestedCapPct,
        rationale: run.adjustment.rationale,
        warnings: run.adjustment.warnings,
        watchPoints: run.adjustment.watchPoints,
        adjustment: run.adjustment,
      },
    },
    warnings: [
      ...(Array.isArray(forecast.warnings) ? forecast.warnings : []),
      ...run.adjustment.warnings.map((item) => `Phase 4 LLM: ${item}`),
    ],
    keyDrivers: [
      ...(Array.isArray(forecast.keyDrivers) ? forecast.keyDrivers : []),
      `Phase 4 LLM structured adjustment applied: ${run.adjustment.rationale}`,
    ],
  };

  return nextForecast as ForecastResult;
}
