import { spawn } from "node:child_process";
import type { ApiResult, JsonObject } from "./api.js";

export interface AgentPayConfig {
  bin: string;
  apiKey: string;
}

export interface Invoice {
  amountRequired: string;
  payTo: string;
  invoiceId: string;
  asset?: string;
  expiresAt?: string;
}

interface CommandResult {
  ok: boolean;
  exitCode: number | null;
  data?: JsonObject;
  error?: JsonObject;
}

function redact(value: string, apiKey: string): string {
  return apiKey ? value.split(apiKey).join("[REDACTED]") : value;
}

function redactObject(value: unknown, apiKey: string): unknown {
  if (typeof value === "string") return redact(value, apiKey);
  if (Array.isArray(value)) return value.map(item => redactObject(item, apiKey));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactObject(item, apiKey)]));
  }
  return value;
}

function parseJsonOutput(stdout: string): JsonObject | undefined {
  try {
    const parsed = JSON.parse(stdout);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonObject : undefined;
  } catch {
    return undefined;
  }
}

export function parseInvoice(result: ApiResult): Invoice | null {
  const candidates: unknown[] = [
    result.data,
    result.data.paymentRequirements,
    result.data.payment_requirements,
  ];
  for (const headerName of ["payment-required", "x-payment-required", "x-payment-requirements"]) {
    const raw = result.headers[headerName];
    if (!raw) continue;
    try {
      candidates.push(JSON.parse(raw));
    } catch {
      try {
        candidates.push(JSON.parse(Buffer.from(raw, "base64").toString("utf8")));
      } catch {
        // Ignore malformed optional headers and continue to body candidates.
      }
    }
  }

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const source = candidate as JsonObject;
    const amountRequired = String(source.amountRequired ?? source.amount_required ?? "");
    const payTo = String(source.payTo ?? source.pay_to ?? "");
    const invoiceId = String(source.invoiceId ?? source.invoice_id ?? "");
    if (amountRequired && payTo && invoiceId) {
      return {
        amountRequired,
        payTo,
        invoiceId,
        asset: source.asset ? String(source.asset) : undefined,
        expiresAt: source.expiresAt ? String(source.expiresAt) : undefined,
      };
    }
  }
  return null;
}

export function decimalToCents(value: string): bigint | null {
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(value)) return null;
  const [whole, fractional = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fractional.padEnd(2, "0"));
}

export function minimumPrice(left: string, right: string): string {
  const leftCents = decimalToCents(left);
  const rightCents = decimalToCents(right);
  if (leftCents === null || rightCents === null) throw new Error("Invalid autopay limit");
  return leftCents <= rightCents ? left : right;
}

export class AgentPay {
  constructor(private readonly config: AgentPayConfig) {}

  async walletStatus(): Promise<JsonObject> {
    const address = await this.run(["address", "--json"]);
    if (!address.ok) return { ok: false, error: "agent_pay_unavailable", details: address.error };
    const balance = await this.run(["balance", "--json"], 60_000);
    if (!balance.ok) return { ok: false, error: "agent_pay_unavailable", details: balance.error };
    return {
      ok: true,
      address: address.data?.address,
      eth: balance.data?.eth,
      usdc: balance.data?.usdc,
    };
  }

  async payUrl(url: string): Promise<JsonObject> {
    const result = await this.run([
      "pay-url",
      url,
      "--header",
      `X-API-Key: ${this.config.apiKey}`,
      "--allowlist",
      "human.menu",
      "--yes",
      "--json",
    ], 360_000);
    if (!result.ok) {
      return { ok: false, error: "agent_pay_failed", details: result.error, txHash: result.data?.txHash };
    }
    return {
      ok: Boolean(result.data?.ok),
      paid: Boolean(result.data?.paid),
      txHash: result.data?.txHash,
      invoiceId: result.data?.invoiceId,
      finalStatus: result.data?.finalStatus,
    };
  }

  private run(args: string[], timeoutMs = 30_000): Promise<CommandResult> {
    return new Promise(resolve => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      const child = spawn(this.config.bin, args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
      const finish = (result: CommandResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        finish({ ok: false, exitCode: null, error: { code: "timeout", message: "agent-pay timed out" } });
      }, timeoutMs);
      child.stdout.on("data", chunk => { stdout += chunk.toString(); });
      child.stderr.on("data", chunk => { stderr += chunk.toString(); });
      child.on("error", error => {
        clearTimeout(timer);
        finish({
          ok: false,
          exitCode: null,
          error: {
            code: (error as NodeJS.ErrnoException).code === "ENOENT" ? "agent_pay_not_found" : "agent_pay_spawn_failed",
            message: (error as NodeJS.ErrnoException).code === "ENOENT"
              ? `agent-pay CLI not found at "${this.config.bin}". Install @humanmenu/agent-pay or set AGENT_PAY_BIN.`
              : redact(error.message, this.config.apiKey),
          },
        });
      });
      child.on("close", code => {
        clearTimeout(timer);
        const parsed = parseJsonOutput(stdout);
        const data = parsed ? redactObject(parsed, this.config.apiKey) as JsonObject : undefined;
        if (code === 0 && data) {
          finish({ ok: true, exitCode: code, data });
          return;
        }
        finish({
          ok: false,
          exitCode: code,
          data,
          error: {
            code: "agent_pay_command_failed",
            message: redact(stderr.trim() || "agent-pay returned an invalid response", this.config.apiKey),
          },
        });
      });
    });
  }
}
