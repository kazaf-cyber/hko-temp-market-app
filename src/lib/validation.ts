import { z } from "zod";

/**
 * Accept a number, numeric string, null, or undefined.
 * This helps when JSON / DB / external APIs return numeric values as strings.
 */
const optionalNullableNumber = z.preprocess(
  (value) => {
    if (value === "" || value === null || value === undefined) {
      return value;
    }

    if (typeof value === "number") {
      return value;
    }

    if (typeof value === "string") {
      const parsed = Number(value);

      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return value;
  },
  z.number().nullable().optional()
);

const requiredNullableNumber = z.preprocess(
  (value) => {
    if (value === null) {
      return null;
    }

    if (typeof value === "number") {
      return value;
    }

    if (typeof value === "string") {
      const parsed = Number(value);

      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return value;
  },
  z.number().nullable()
);

const optionalNullableString = z
  .string()
  .nullable()
  .optional();

/**
 * IMPORTANT:
 * .passthrough() is required.
 *
 * Without .passthrough(), Zod strips important Polymarket/CLOB fields:
 * - marketPrice
 * - clobMidpoint
 * - yesAsk
 * - noAsk
 * - yesBid
 * - tokenId
 * - yesTokenId
 * - noTokenId
 *
 * If those fields are stripped, Poe will receive null market prices.
 */
export const outcomeSchema = z
  .object({
    name: z.string().min(1),

    lower: requiredNullableNumber,
    upper: requiredNullableNumber,

    /**
     * Polymarket / Gamma / CLOB price fields.
     */
    marketPrice: optionalNullableNumber,
    price: optionalNullableNumber,
    marketPriceSource: optionalNullableString,

    /**
     * Gamma binary market prices.
     */
    yesPrice: optionalNullableNumber,
    noPrice: optionalNullableNumber,

    /**
     * Token IDs.
     */
    tokenId: optionalNullableString,
    clobTokenId: optionalNullableString,
    yesTokenId: optionalNullableString,
    noTokenId: optionalNullableString,

    /**
     * CLOB-derived market fields.
     */
    clobMidpoint: optionalNullableNumber,
    yesAsk: optionalNullableNumber,
    noAsk: optionalNullableNumber,
    yesBid: optionalNullableNumber,
    clobSpread: optionalNullableNumber
  })
  .passthrough();

export const marketStateSchema = z
  .object({
    useAI: z.boolean(),

    outcomes: z.array(outcomeSchema).min(1),

    manualMaxOverrideC: optionalNullableNumber,
    rainEtaMinutes: z
      .preprocess(
        (value) => {
          if (value === "" || value === null || value === undefined) {
            return value;
          }

          if (typeof value === "number") {
            return value;
          }

          if (typeof value === "string") {
            const parsed = Number(value);

            if (Number.isFinite(parsed)) {
              return parsed;
            }
          }

          return value;
        },
        z.number().int().nonnegative().nullable().optional()
      )
      .default(null),

    rainProbability60m: z
      .preprocess(
        (value) => {
          if (typeof value === "number") return value;

          if (typeof value === "string") {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) return parsed;
          }

          return value;
        },
        z.number().min(0).max(1)
      ),

    rainProbability120m: z
      .preprocess(
        (value) => {
          if (typeof value === "number") return value;

          if (typeof value === "string") {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) return parsed;
          }

          return value;
        },
        z.number().min(0).max(1)
      ),

    expectedRainIntensity: z.union([
      z.literal("none"),
      z.literal("light"),
      z.literal("moderate"),
      z.literal("heavy"),
      z.literal("violent"),
      z.literal("thunderstorm"),
      z.string()
    ]),

    cloudCoverPct: z.preprocess(
      (value) => {
        if (typeof value === "number") return value;

        if (typeof value === "string") {
          const parsed = Number(value);
          if (Number.isFinite(parsed)) return parsed;
        }

        return value;
      },
      z.number().min(0).max(100)
    ),

    /**
     * Optional app fields.
     */
    stationCode: z.string().optional(),
    stationName: z.string().optional(),

    /**
     * Optional Polymarket fields.
     * Keeping these allows /api/forecast to refresh / preserve market context.
     */
    polymarketUrl: z.string().nullable().optional(),
    polymarketSlug: z.string().nullable().optional()
  })
  .passthrough();

export const forecastApiRequestSchema = z
  .object({
    state: marketStateSchema.optional(),
    saveHistory: z.boolean().optional(),
    forceAI: z.boolean().optional()
  })
  .passthrough();
