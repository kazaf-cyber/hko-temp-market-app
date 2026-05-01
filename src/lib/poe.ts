import type { ForecastResult } from "@/lib/forecast";
import { summarizeForecastForPrompt } from "@/lib/forecast";

const POE_CHAT_COMPLETIONS_ENDPOINT = "https://api.poe.com/v1/chat/completions";

export type PoeChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type PoeCallOptions = {
  model?: string;
  temperature?: number;
  maxTokens?: number;
};

export type PoeCallResult = {
  enabled: boolean;
  model: string | null;
  content: string | null;
  error: string | null;
};

export type PoeForecastCommentary = PoeCallResult & {
  promptPreview: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function extractPoeContent(raw: unknown): string | null {
  if (!isRecord(raw)) return null;

  const choices = raw.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;

  const firstChoice = choices[0];
  if (!isRecord(firstChoice)) return null;

  const message = firstChoice.message;

  if (isRecord(message) && typeof message.content === "string") {
    const content = message.content.trim();
    return content ? content : null;
  }

  if (typeof firstChoice.text === "string") {
    const text = firstChoice.text.trim();
    return text ? text : null;
  }

  return null;
}

async function readErrorBody(response: Response) {
  try {
    const text = await response.text();
    return text.slice(0, 800);
  } catch {
    return "";
  }
}

export async function callPoe(
  messages: PoeChatMessage[],
  options: PoeCallOptions = {}
): Promise<PoeCallResult> {
  const apiKey = process.env.POE_API_KEY;
  const model = options.model ?? process.env.POE_MODEL ?? "Claude-Sonnet-4.6";

  if (!apiKey) {
    return {
      enabled: false,
      model,
      content: null,
      error: "POE_API_KEY is not configured."
    };
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: false
  };

  if (typeof options.temperature === "number" && Number.isFinite(options.temperature)) {
    body.temperature = clamp(options.temperature, 0, 2);
  }

  if (typeof options.maxTokens === "number" && Number.isFinite(options.maxTokens)) {
    body.max_tokens = Math.max(1, Math.floor(options.maxTokens));
  }

  try {
    const response = await fetch(POE_CHAT_COMPLETIONS_ENDPOINT, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorBody = await readErrorBody(response);

      return {
        enabled: true,
        model,
        content: null,
        error: `Poe request failed: ${response.status} ${response.statusText}${
          errorBody ? ` - ${errorBody}` : ""
        }`
      };
    }

    const raw = await response.json();
    const content = extractPoeContent(raw);

    if (!content) {
      return {
        enabled: true,
        model,
        content: null,
        error: "Poe response did not contain message content."
      };
    }

    return {
      enabled: true,
      model,
      content,
      error: null
    };
  } catch (error) {
    return {
      enabled: true,
      model,
      content: null,
      error: error instanceof Error ? error.message : "Unknown Poe request error."
    };
  }
}

export function buildMultiChannelForecastPrompt(forecast: ForecastResult) {
  const compactForecast = summarizeForecastForPrompt(forecast);

  return [
    "你是一名嚴謹的香港天氣與 prediction market 分析員。",
    "",
    "請根據以下 multi-channel forecast JSON，用繁體中文寫一段可直接放在 dashboard 上的分析。",
    "",
    "要求：",
    "1. 先用 1 句說明目前最高機率 outcome。",
    "2. 解釋 HKO observed max、Open-Meteo、Windy、rain/cloud、CLOB/Gamma price 如何影響機率。",
    "3. 如果某些 outcome 已因 observed max 達到 upper bound 而不可能，請明確指出。",
    "4. 不要捏造 JSON 沒有提供的數據。",
    "5. 不要給投資建議；只說明概率、風險與不確定性。",
    "6. 最後用 2-4 個 bullet points 列出 watch points。",
    "",
    "Forecast JSON:",
    "```json",
    JSON.stringify(compactForecast, null, 2),
    "```"
  ].join("\n");
}

export async function getPoeForecastCommentary(
  forecast: ForecastResult,
  options: PoeCallOptions = {}
): Promise<PoeForecastCommentary> {
  const prompt = buildMultiChannelForecastPrompt(forecast);

  const result = await callPoe(
    [
      {
        role: "system",
        content:
          "You are a careful weather-market analyst. Write in Traditional Chinese. Be concise, numerical, and do not invent facts."
      },
      {
        role: "user",
        content: prompt
      }
    ],
    {
      temperature: options.temperature ?? 0.2,
      maxTokens: options.maxTokens ?? 850,
      model: options.model
    }
  );

  return {
    ...result,
    promptPreview: prompt.slice(0, 1600)
  };
}

/*
  Backward-compatible simple helpers.
  These are intentionally generic so older routes/components can still call a plain Poe prompt.
*/
export async function askPoe(prompt: string, system?: string): Promise<string | null> {
  const result = await callPoe(
    [
      {
        role: "system",
        content: system ?? "You are a helpful assistant. Reply in Traditional Chinese when appropriate."
      },
      {
        role: "user",
        content: prompt
      }
    ],
    {
      temperature: 0.2,
      maxTokens: 900
    }
  );

  if (result.error) {
    console.warn("Poe error:", result.error);
  }

  return result.content;
}

export async function generatePoeAnalysis(prompt: string): Promise<string | null> {
  return askPoe(prompt);
}

export async function getPoeAnalysis(prompt: string): Promise<string | null> {
  return askPoe(prompt);
}
