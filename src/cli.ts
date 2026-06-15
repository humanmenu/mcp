import { HumanMenuApi, publicEnvelope, type JsonObject } from "./api.js";
import { AgentPay, decimalToCents } from "./pay.js";

function write(value: JsonObject): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function usage(): void {
  process.stdout.write(`human-menu-mcp

Run without a subcommand to start the MCP stdio server.

Human-run commands:
  human-menu-mcp doctor
  human-menu-mcp register --handle <handle> --email <email>
\n`);
}

async function doctor(): Promise<JsonObject> {
  const apiKey = process.env.HUMAN_MENU_API_KEY?.trim() ?? "";
  const baseUrl = process.env.HUMAN_MENU_BASE_URL?.trim() || "https://human.menu/api/";
  const maxAutopay = process.env.HUMAN_MENU_MAX_AUTOPAY_USDC?.trim() || "1.00";
  const api = new HumanMenuApi({ apiKey, baseUrl });
  const agentPay = new AgentPay({ bin: process.env.AGENT_PAY_BIN?.trim() || "agent-pay", apiKey });

  const checks: JsonObject[] = [];
  const limitValid = decimalToCents(maxAutopay) !== null;
  checks.push({ name: "autopay_limit", ok: limitValid, configured_usdc: limitValid ? maxAutopay : undefined, message: limitValid ? "Autopay limit is valid." : "HUMAN_MENU_MAX_AUTOPAY_USDC is invalid." });

  const reachable = publicEnvelope(await api.get("list_tasks", { limit: 1 }));
  checks.push({
    name: "api_reachable",
    ok: reachable.ok === true,
    message: reachable.ok === true ? "human.menu API is reachable." : "human.menu API could not be reached.",
    http_status: reachable.http_status,
  });

  if (!apiKey) {
    checks.push({ name: "api_key", ok: false, message: "HUMAN_MENU_API_KEY is missing." });
  } else {
    const status = publicEnvelope(await api.get("api_key_status"));
    checks.push({ name: "api_key", ok: status.ok === true, message: status.ok === true ? "API key is valid." : "API key validation failed.", http_status: status.http_status });
  }

  const wallet = await agentPay.walletStatus();
  const ethFunded = wallet.ok === true && Number(wallet.eth) > 0;
  const usdcFunded = wallet.ok === true && Number(wallet.usdc) > 0;
  checks.push({
    name: "agent_pay_wallet",
    ok: wallet.ok === true && ethFunded && usdcFunded,
    message: wallet.ok !== true
      ? "agent-pay or its wallet configuration is unavailable."
      : ethFunded && usdcFunded
        ? "agent-pay wallet has USDC and gas ETH."
        : "agent-pay wallet is readable but needs USDC and/or gas ETH.",
    ...(wallet.ok === true ? { address: wallet.address, eth: wallet.eth, usdc: wallet.usdc, eth_funded: ethFunded, usdc_funded: usdcFunded } : { details: wallet.details }),
  });

  const ok = checks.every(check => check.ok === true);
  return { ok, checks };
}

async function register(args: string[]): Promise<JsonObject> {
  const handle = option(args, "--handle");
  const email = option(args, "--email");
  if (!handle || !email) {
    return { ok: false, error: "missing_arguments", message: "Usage: human-menu-mcp register --handle <handle> --email <email>" };
  }
  const baseUrl = process.env.HUMAN_MENU_BASE_URL?.trim() || "https://human.menu/api/";
  const api = new HumanMenuApi({ apiKey: "", baseUrl });
  return publicEnvelope(await api.post("register_ai_client", { handle, email }));
}

export async function runCli(args: string[]): Promise<void> {
  const command = args[0];
  if (command === "--help" || command === "-h") {
    usage();
    return;
  }
  const result = command === "doctor"
    ? await doctor()
    : command === "register"
      ? await register(args.slice(1))
      : { ok: false, error: "unknown_command", message: `Unknown command: ${command ?? ""}` };
  write(result);
  if (result.ok !== true) process.exitCode = 1;
}
