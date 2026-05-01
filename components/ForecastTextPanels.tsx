"use client";

import React, { useMemo, useState } from "react";

type ForecastTextPanelsProps = {
  keyDrivers?: unknown[] | null;
  warnings?: unknown[] | null;

  /*
    Pass whichever explanation field your API returns:
      poeAiExplanation
      aiExplanation
      explanation
  */
  poeAiExplanation?: string | null;
  aiExplanation?: string | null;

  /*
    Optional but recommended.

    If you pass bucket-level probabilities here, this component can fix bad
    top-outcome display such as:
      "22°C or higher at 100.0%"
    into:
      "Top bucket is "26°C" at 99.65% final probability."

    Accepted row examples:
      { label: "26°C", probability: 0.9965 }
      { outcome: "26°C", finalProbability: 0.9965 }
      { bucket: "26°C", prob: "99.65%" }
  */
  buckets?: unknown[] | null;
  probabilities?: unknown[] | null;
  outcomes?: unknown[] | null;

  /*
    If true, raw technical warning details are easier to inspect.
  */
  debug?: boolean;
};

type ParsedOutcome = {
  label: string;
  probability: number;
  raw: unknown;
};

type DisplayWarning = {
  summary: string;
  detail: string;
};

const WRAP_STYLE: React.CSSProperties = {
  overflowWrap: "anywhere",
  wordBreak: "break-word"
};

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value === null || value === undefined) {
    return "";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function compactText(value: unknown): string {
  return stringifyUnknown(value).replace(/\s+/g, " ").trim();
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const items = value
    .map((item) => compactText(item))
    .filter((item) => item.length > 0);

  return Array.from(new Set(items));
}

function truncateMiddle(text: string, maxLength = 260): string {
  if (text.length <= maxLength) {
    return text;
  }

  const keep = Math.max(20, Math.floor((maxLength - 1) / 2));

  return `${text.slice(0, keep)}…${text.slice(-keep)}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readFirstString(
  record: Record<string, unknown>,
  keys: string[]
): string | null {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return null;
}

function parseProbability(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 0 && value <= 1) {
      return value;
    }

    if (value > 1 && value <= 100) {
      return value / 100;
    }

    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const raw = value.trim();

  if (!raw) {
    return null;
  }

  const hasPercent = raw.includes("%");
  const cleaned = raw.replace(/,/g, "").replace(/[^\d.+-]/g, "");

  if (!/[+-]?\d/.test(cleaned)) {
    return null;
  }

  const parsed = Number(cleaned);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  if (hasPercent) {
    return parsed / 100;
  }

  if (parsed >= 0 && parsed <= 1) {
    return parsed;
  }

  if (parsed > 1 && parsed <= 100) {
    return parsed / 100;
  }

  return null;
}

function readFirstProbability(
  record: Record<string, unknown>,
  keys: string[]
): number | null {
  for (const key of keys) {
    const parsed = parseProbability(record[key]);

    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function extractOutcomeLabel(row: unknown): string | null {
  if (typeof row === "string") {
    return row.trim() || null;
  }

  const record = asRecord(row);

  if (!record) {
    return null;
  }

  return readFirstString(record, [
    "label",
    "outcome",
    "name",
    "title",
    "bucket",
    "bucketLabel",
    "temperatureBucket",
    "displayName"
  ]);
}

function extractOutcomeProbability(row: unknown): number | null {
  const record = asRecord(row);

  if (!record) {
    return null;
  }

  return readFirstProbability(record, [
    "probability",
    "finalProbability",
    "finalProb",
    "finalProbabilityPct",
    "probabilityPct",
    "p",
    "prob",
    "chance",
    "marketProbability",
    "weatherProbability"
  ]);
}

function normalizeOutcomeRows(rows: unknown[] | null | undefined): ParsedOutcome[] {
  if (!Array.isArray(rows)) {
    return [];
  }

  const parsed: ParsedOutcome[] = [];

  for (const row of rows) {
    const label = extractOutcomeLabel(row);
    const probability = extractOutcomeProbability(row);

    if (!label || probability === null) {
      continue;
    }

    parsed.push({
      label,
      probability,
      raw: row
    });
  }

  return parsed;
}

function labelLooksCumulative(label: string): boolean {
  return /(or\s+higher|or\s+above|and\s+above|above|at\s+least|>=|≥|或以上|以上)/i.test(
    label
  );
}

function labelLooksLowerBound(label: string): boolean {
  return /(or\s+below|or\s+lower|below|at\s+most|<=|≤|或以下|以下)/i.test(
    label
  );
}

function chooseTopBucket(
  buckets?: unknown[] | null,
  probabilities?: unknown[] | null,
  outcomes?: unknown[] | null
): ParsedOutcome | null {
  const parsed = [
    ...normalizeOutcomeRows(buckets),
    ...normalizeOutcomeRows(probabilities),
    ...normalizeOutcomeRows(outcomes)
  ];

  if (parsed.length === 0) {
    return null;
  }

  /*
    Prefer true finite buckets:
      25°C
      26°C
      27°C

    Avoid cumulative threshold labels:
      22°C or higher
      23°C or higher
      29°C or higher
  */
  const finiteBuckets = parsed.filter(
    (row) =>
      !labelLooksCumulative(row.label) &&
      !labelLooksLowerBound(row.label) &&
      row.probability > 0
  );

  if (finiteBuckets.length > 0) {
    return [...finiteBuckets].sort(
      (a, b) => b.probability - a.probability
    )[0];
  }

  /*
    Fallback:
    if only threshold rows exist, avoid rows already effectively certain.
  */
  const nonCertainRows = parsed.filter(
    (row) => row.probability > 0 && row.probability < 0.9995
  );

  if (nonCertainRows.length > 0) {
    return [...nonCertainRows].sort(
      (a, b) => b.probability - a.probability
    )[0];
  }

  return null;
}

function formatProbability(probability: number): string {
  const pct = probability * 100;

  if (pct >= 99) {
    return `${pct.toFixed(2).replace(/\.?0+$/, "")}%`;
  }

  if (pct >= 10) {
    return `${pct.toFixed(1).replace(/\.0$/, "")}%`;
  }

  return `${pct.toFixed(2).replace(/\.?0+$/, "")}%`;
}

function driverLooksLikeRawWarning(driver: string): boolean {
  const lower = driver.toLowerCase();

  return (
    /^main warning:/i.test(driver) ||
    lower.includes("response body:") ||
    lower.includes("request failed: 400") ||
    lower.includes("invalid api key") ||
    lower.includes("bad request")
  );
}

function driverLooksLikeBadTopOutcome(driver: string): boolean {
  return /^top outcome/i.test(driver) && labelLooksCumulative(driver);
}

function normalizeKeyDrivers(
  rawDrivers: string[],
  rawWarnings: string[],
  topBucket: ParsedOutcome | null
): string[] {
  const output: string[] = [];
  let replacedTopOutcome = false;
  let sawRawWarningDriver = false;

  for (const driver of rawDrivers) {
    if (!driver) {
      continue;
    }

    if (driverLooksLikeRawWarning(driver)) {
      sawRawWarningDriver = true;
      continue;
    }

    if (driverLooksLikeBadTopOutcome(driver)) {
      if (topBucket && !replacedTopOutcome) {
        output.push(
          `Top bucket is "${topBucket.label}" at ${formatProbability(
            topBucket.probability
          )} final probability.`
        );
        replacedTopOutcome = true;
      } else {
        output.push(
          "Lower threshold outcomes are effectively certain after the observed max; use bucket-level probabilities for the top outcome."
        );
      }

      continue;
    }

    output.push(truncateMiddle(driver, 340));
  }

  if (
    topBucket &&
    !replacedTopOutcome &&
    !output.some((line) => /^top bucket/i.test(line))
  ) {
    output.unshift(
      `Top bucket is "${topBucket.label}" at ${formatProbability(
        topBucket.probability
      )} final probability.`
    );
  }

  if (
    (sawRawWarningDriver || rawWarnings.length > 0) &&
    !output.some((line) => line.toLowerCase().includes("see warnings"))
  ) {
    output.push("Optional data-source fallback is active; see Warnings.");
  }

  return Array.from(new Set(output)).filter(Boolean);
}

function humanizeWarning(raw: string): DisplayWarning {
  const lower = raw.toLowerCase();

  if (
    lower.includes("windy") &&
    (lower.includes("invalid api key") ||
      lower.includes("request failed") ||
      lower.includes("400 bad request") ||
      lower.includes("bad request"))
  ) {
    return {
      summary:
        "Windy data unavailable: API key was rejected, so the forecast used fallback weather sources.",
      detail: raw
    };
  }

  if (lower.includes("insufficient market prices")) {
    return {
      summary:
        "Insufficient market prices are available; final probabilities may be weather-only.",
      detail: raw
    };
  }

  if (
    lower.includes("market blending is disabled") ||
    lower.includes("marketblendenabled=false") ||
    lower.includes("weather-only")
  ) {
    return {
      summary:
        "Market blending is disabled or unavailable; final probabilities may be weather-only or fallback-normalized.",
      detail: raw
    };
  }

  if (lower.includes("open-meteo")) {
    return {
      summary:
        "Open-Meteo fallback data is limited or unavailable; model uncertainty may be higher.",
      detail: raw
    };
  }

  if (lower.includes("hko")) {
    return {
      summary: truncateMiddle(raw, 220),
      detail: raw
    };
  }

  return {
    summary: truncateMiddle(raw, 220),
    detail: raw
  };
}

function explanationLooksCutOff(text: string): boolean {
  const trimmed = text.trim();

  if (!trimmed) {
    return false;
  }

  /*
    Common sign from your screenshot:
      ### Watch points
      - **是

    That is not a display-wrap issue. It usually means the AI response itself
    was cut mid-markdown.
  */
  return (
    /(^|\n)\s*[-*]\s+\*\*[^*\n]{0,80}$/.test(trimmed) ||
    /(\*\*|__|`|\[|\(|\{)$/.test(trimmed)
  );
}

export default function ForecastTextPanels({
  keyDrivers = [],
  warnings = [],
  poeAiExplanation = null,
  aiExplanation = null,
  buckets = [],
  probabilities = [],
  outcomes = [],
  debug = false
}: ForecastTextPanelsProps) {
  const [showRawWarnings, setShowRawWarnings] = useState(debug);
  const [expandedExplanation, setExpandedExplanation] = useState(false);
  const [copied, setCopied] = useState(false);

  const rawWarnings = useMemo(() => toStringArray(warnings), [warnings]);

  const topBucket = useMemo(
    () => chooseTopBucket(buckets, probabilities, outcomes),
    [buckets, probabilities, outcomes]
  );

  const drivers = useMemo(
    () =>
      normalizeKeyDrivers(
        toStringArray(keyDrivers),
        rawWarnings,
        topBucket
      ),
    [keyDrivers, rawWarnings, topBucket]
  );

  const displayWarnings = useMemo(
    () => rawWarnings.map(humanizeWarning),
    [rawWarnings]
  );

  const explanation = String(poeAiExplanation ?? aiExplanation ?? "").trim();
  const looksCutOff = explanationLooksCutOff(explanation);

  async function copyExplanation() {
    if (!explanation) {
      return;
    }

    try {
      await navigator.clipboard.writeText(explanation);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="space-y-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <article className="min-w-0 rounded-2xl border border-slate-700 bg-slate-950 p-5 text-slate-100 shadow">
          <h2 className="text-xl font-bold text-white">Key drivers</h2>

          {drivers.length > 0 ? (
            <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-100 marker:text-slate-400">
              {drivers.map((driver, index) => (
                <li
                  key={`${driver}-${index}`}
                  className="min-w-0 whitespace-normal"
                  style={WRAP_STYLE}
                >
                  {driver}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-slate-400">
              No key drivers were returned.
            </p>
          )}
        </article>

        <article className="min-w-0 rounded-2xl border border-slate-700 bg-slate-950 p-5 text-slate-100 shadow">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="text-xl font-bold text-white">Warnings</h2>

            {rawWarnings.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowRawWarnings((value) => !value)}
                className="rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-cyan-300 ring-1 ring-slate-700 hover:bg-slate-800"
              >
                {showRawWarnings ? "Hide raw" : "Show raw"}
              </button>
            ) : null}
          </div>

          {displayWarnings.length > 0 ? (
            <ul className="mt-4 list-disc space-y-3 pl-5 text-sm leading-6 text-amber-200 marker:text-amber-300">
              {displayWarnings.map((warning, index) => (
                <li
                  key={`${warning.summary}-${index}`}
                  className="min-w-0 whitespace-normal"
                  style={WRAP_STYLE}
                >
                  <span>{warning.summary}</span>

                  {showRawWarnings && warning.detail !== warning.summary ? (
                    <details className="mt-2 rounded-xl border border-slate-700 bg-slate-900 p-3 text-xs text-slate-300">
                      <summary className="cursor-pointer text-cyan-300">
                        Technical details
                      </summary>

                      <pre
                        className="mt-2 whitespace-pre-wrap font-sans leading-5"
                        style={WRAP_STYLE}
                      >
                        {warning.detail}
                      </pre>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-slate-400">
              No active warnings.
            </p>
          )}
        </article>
      </div>

      <article className="min-w-0 rounded-2xl border border-slate-700 bg-slate-950 p-5 text-slate-100 shadow">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-white">
              Poe AI explanation
            </h2>

            <p className="mt-1 text-sm text-slate-400" style={WRAP_STYLE}>
              {expandedExplanation
                ? "Full view mode. The page will grow to show the whole explanation."
                : "Long output is scrollable inside this panel. Use Show full to remove the height cap."}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {explanation ? (
              <button
                type="button"
                onClick={copyExplanation}
                className="rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-cyan-300 ring-1 ring-slate-700 hover:bg-slate-800"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => setExpandedExplanation((value) => !value)}
              className="rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-cyan-300 ring-1 ring-slate-700 hover:bg-slate-800"
            >
              {expandedExplanation ? "Use scroll panel" : "Show full"}
            </button>
          </div>
        </div>

        {looksCutOff ? (
          <div
            className="mt-4 rounded-xl border border-amber-500 bg-amber-950 p-3 text-sm leading-6 text-amber-100"
            style={WRAP_STYLE}
          >
            The AI explanation appears to end mid-markdown. If Show full still
            ends abruptly, the API response itself was truncated. Increase the
            Poe / AI max output tokens, or ask the model for a shorter answer.
          </div>
        ) : null}

        <pre
          className="mt-4 min-w-0 rounded-xl border border-slate-700 bg-slate-950 p-4 font-sans text-sm leading-7 text-slate-50"
          style={{
            ...WRAP_STYLE,
            whiteSpace: "pre-wrap",
            maxHeight: expandedExplanation ? "none" : "72vh",
            overflowY: expandedExplanation ? "visible" : "auto",
            overflowX: "hidden"
          }}
        >
          {explanation || "No Poe AI explanation returned."}
        </pre>
      </article>
    </section>
  );
}
