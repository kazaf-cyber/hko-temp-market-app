import { z } from "zod";

export const outcomeSchema = z.object({
  name: z.string().min(1),
  lower: z.number().nullable(),
  upper: z.number().nullable()
});

export const marketStateSchema = z.object({
  stationCode: z.literal("HKO"),
  stationName: z.string().min(1),
  manualMaxOverrideC: z.number().nullable(),
  rainEtaMinutes: z.number().int().nonnegative().nullable(),
  rainProbability60m: z.number().min(0).max(1),
  rainProbability120m: z.number().min(0).max(1),
  expectedRainIntensity: z.enum([
    "none",
    "light",
    "moderate",
    "heavy",
    "thunderstorm"
  ]),
  cloudCoverPct: z.number().min(0).max(100),
  useAI: z.boolean(),
  outcomes: z.array(outcomeSchema).min(2)
});

export const forecastApiRequestSchema = z.object({
  state: marketStateSchema.optional(),
  saveHistory: z.boolean().optional(),
  forceAI: z.boolean().optional()
});
