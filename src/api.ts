export type JsonObject = Record<string, unknown>;

export interface ApiResult {
  status: number;
  headers: Record<string, string>;
  data: JsonObject;
}

export interface HumanMenuConfig {
  apiKey: string;
  baseUrl: string;
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("HUMAN_MENU_BASE_URL must use HTTPS");
  }
  return url.toString().endsWith("/") ? url.toString() : `${url.toString()}/`;
}

function headersToObject(headers: Headers): Record<string, string> {
  const output: Record<string, string> = {};
  headers.forEach((value, key) => {
    output[key] = value;
  });
  return output;
}

function safeJson(text: string, status: number): JsonObject {
  if (!text.trim()) return { ok: status >= 200 && status < 300 };
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as JsonObject
      : { ok: false, error: "invalid_api_response", message: "human.menu returned non-object JSON" };
  } catch {
    return { ok: false, error: "invalid_api_response", message: `human.menu returned non-JSON HTTP ${status}` };
  }
}

export class HumanMenuApi {
  readonly apiKey: string;
  readonly baseUrl: string;

  constructor(config: HumanMenuConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
  }

  actionUrl(action: string, query: Record<string, string | number | boolean | undefined> = {}): string {
    const url = new URL(this.baseUrl);
    url.searchParams.set("action", action);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  async get(action: string, query: Record<string, string | number | boolean | undefined> = {}): Promise<ApiResult> {
    return this.request(this.actionUrl(action, query), { method: "GET" });
  }

  async post(action: string, body: JsonObject): Promise<ApiResult> {
    return this.request(this.actionUrl(action), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  private async request(url: string, init: RequestInit): Promise<ApiResult> {
    try {
      const headers = new Headers(init.headers);
      headers.set("X-API-Key", this.apiKey);
      headers.set("accept", "application/json");
      const response = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(30_000) });
      return {
        status: response.status,
        headers: headersToObject(response.headers),
        data: safeJson(await response.text(), response.status),
      };
    } catch (error) {
      return {
        status: 0,
        headers: {},
        data: {
          ok: false,
          error: "human_menu_request_failed",
          message: error instanceof Error ? error.message : "human.menu request failed",
        },
      };
    }
  }
}

export function publicEnvelope(result: ApiResult): JsonObject {
  return { ...result.data, http_status: result.status };
}
