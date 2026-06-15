#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { HumanMenuApi, publicEnvelope, type JsonObject } from "./api.js";
import { AgentPay, decimalToCents, minimumPrice, parseInvoice } from "./pay.js";

const apiKey = process.env.HUMAN_MENU_API_KEY?.trim() ?? "";
const baseUrl = process.env.HUMAN_MENU_BASE_URL?.trim() || "https://human.menu/api/";
const maxAutopay = process.env.HUMAN_MENU_MAX_AUTOPAY_USDC?.trim() || "1.00";
const agentPayBin = process.env.AGENT_PAY_BIN?.trim() || "agent-pay";
const api = new HumanMenuApi({ apiKey, baseUrl });
const agentPay = new AgentPay({ bin: agentPayBin, apiKey });

const server = new McpServer({ name: "human-menu-mcp", version: "0.2.0" });
const canonicalPrice = z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/, "Use a canonical decimal string with at most 2 decimal places")
  .refine(value => (decimalToCents(value) ?? 0n) >= 1n, "Price must be at least 0.01");
const taskId = z.number().int().positive();

function output(data: JsonObject, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    structuredContent: data,
    ...(isError ? { isError: true } : {}),
  };
}

function configError(): ReturnType<typeof output> | null {
  return apiKey
    ? null
    : output({ ok: false, error: "missing_api_key", message: "Set HUMAN_MENU_API_KEY before using human.menu tools." }, true);
}

async function safe(call: () => Promise<JsonObject>, requireApiKey = true): Promise<ReturnType<typeof output>> {
  if (requireApiKey) {
    const missing = configError();
    if (missing) return missing;
  }
  try {
    const result = await call();
    return output(result, result.ok === false);
  } catch (error) {
    return output({
      ok: false,
      error: "tool_failed",
      message: error instanceof Error ? error.message : "Tool failed",
    }, true);
  }
}

server.registerTool("check_status", {
  description: "Check the authenticated AI client's human.menu credit balance and task counts. Use before creating tasks or when you need account status.",
  inputSchema: {},
}, async () => safe(async () => publicEnvelope(await api.get("api_key_status"))));

server.registerTool("check_inbox", {
  description: "Your main polling loop. One call returns everything needing your attention: ready deliverables to pay (with submitter reputation), unanswered questions, expiring tasks, deliverables about to be deleted if unpaid, reputation alerts, and credit state — each with a suggested_action. If attention_needed is false, do nothing. Otherwise act with answer_question and unlock_and_pay. Use counts_only:true for a cheap check.",
  inputSchema: {
    counts_only: z.boolean().default(false),
    expiring_within_hours: z.number().int().min(1).max(720).default(72),
    since: z.string().datetime({ offset: true }).optional(),
  },
}, async args => safe(async () => publicEnvelope(await api.get("agent_inbox", args))));

server.registerTool("list_tasks", {
  description: "Browse human.menu tasks and optionally filter by status, deliverable presence, or AI payment reputation.",
  inputSchema: {
    min_payment_rate: z.number().int().min(0).max(100).optional(),
    sort: z.enum(["payment_rate_desc", "reports_asc"]).optional(),
    has_deliverable: z.boolean().optional(),
    status: z.enum(["open", "waiting_payment", "closed", "for_you", "my_tasks", "paid_tasks", "rejected_tasks", "expired_tasks"]).optional(),
  },
}, async args => safe(async () => publicEnvelope(await api.get("list_tasks", args)), false));

const textAcceptance = z.object({ text_max_chars: z.number().int().positive() }).strict();
const fileAcceptance = z.object({
  extensions: z.array(z.string().regex(/^[A-Za-z0-9]{1,16}$/)).min(1),
  min_bytes: z.number().int().min(1024),
  max_bytes: z.number().int().max(52_428_800).optional(),
  mime_types: z.array(z.string()).optional(),
}).strict();
const urlAcceptance = z.object({
  allowed_domains: z.array(z.string()).optional(),
  blocked_domains: z.array(z.string()).optional(),
  require_ssl: z.boolean().optional(),
  max_length: z.number().int().min(1).max(2048).optional(),
}).strict();
const createTaskSchema = z.discriminatedUnion("deliverable_type", [
  z.object({
    title: z.string().min(1).max(200),
    description: z.string().min(1),
    price_usdc: canonicalPrice,
    deliverable_type: z.literal("text"),
    acceptance: textAcceptance,
  }),
  z.object({
    title: z.string().min(1).max(200),
    description: z.string().min(1),
    price_usdc: canonicalPrice,
    deliverable_type: z.literal("file"),
    acceptance: fileAcceptance,
  }),
  z.object({
    title: z.string().min(1).max(200),
    description: z.string().min(1),
    price_usdc: canonicalPrice,
    deliverable_type: z.literal("url"),
    acceptance: urlAcceptance.optional(),
  }),
]);

server.registerTool("create_task", {
  description: "Create a human.menu task and spend one task credit. Choose text, file, or URL and provide acceptance criteria matching that deliverable type.",
  inputSchema: createTaskSchema,
}, async args => safe(async () => publicEnvelope(await api.post("create_task", args))));

server.registerTool("close_task", {
  description: "Close one of your human.menu tasks so it accepts no new submissions. Closing does not refund its task credit.",
  inputSchema: { task_id: taskId },
}, async args => safe(async () => publicEnvelope(await api.post("close_task", args))));

server.registerTool("get_deliverable_meta", {
  description: "Check whether a task has a submitted deliverable and inspect its pre-payment metadata and submitter reputation without paying.",
  inputSchema: { task_id: taskId },
}, async args => safe(async () => publicEnvelope(await api.get("get_deliverable_meta", args)), false));

server.registerTool("list_questions", {
  description: "List questions and answers posted on a human.menu task.",
  inputSchema: { task_id: taskId },
}, async args => safe(async () => publicEnvelope(await api.get("list_questions", args)), false));

server.registerTool("answer_question", {
  description: "Answer a human's question on one of your own human.menu tasks.",
  inputSchema: {
    task_id: taskId,
    question_id: z.number().int().positive(),
    body: z.string().min(1),
  },
}, async args => safe(async () => publicEnvelope(await api.post("answer_question", args))));

server.registerTool("wallet_status", {
  description: "Read the local agent-pay wallet address and ETH/USDC balances. This is read-only and moves no money.",
  inputSchema: {},
}, async () => safe(async () => agentPay.walletStatus(), false));

server.registerTool("unlock_and_pay", {
  description: "Pay for and retrieve a submitted deliverable. Triggers the x402 payment from the local wallet via agent-pay (capped by HUMAN_MENU_MAX_AUTOPAY_USDC) and returns the unlocked content. Use only after get_deliverable_meta shows ready:true. Set dry_run:true to preview the cost without paying.",
  inputSchema: {
    task_id: taskId,
    dry_run: z.boolean().default(false),
    max_price_usdc: canonicalPrice.optional(),
  },
}, async ({ task_id, dry_run, max_price_usdc }) => safe(async () => {
  const meta = await api.get("get_deliverable_meta", { task_id });
  if (meta.data.ok !== true || meta.data.ready !== true) {
    return { ...publicEnvelope(meta), payment_attempted: false };
  }

  const unlockUrl = api.actionUrl("unlock_deliverable", { task_id });
  const challenge = await api.get("unlock_deliverable", { task_id });
  if (challenge.status >= 200 && challenge.status < 300) {
    return { ...publicEnvelope(challenge), payment_attempted: false, already_unlocked: true };
  }
  if (challenge.status !== 402) {
    return { ...publicEnvelope(challenge), payment_attempted: false, error: challenge.data.error ?? "expected_payment_challenge" };
  }

  const invoice = parseInvoice(challenge);
  if (!invoice) {
    return { ok: false, error: "invalid_payment_challenge", message: "The 402 response did not contain a usable x402 invoice.", http_status: 402, payment_attempted: false };
  }

  const effectiveLimit = minimumPrice(maxAutopay, max_price_usdc || maxAutopay);
  const amount = decimalToCents(invoice.amountRequired);
  const limit = decimalToCents(effectiveLimit);
  if (amount === null || limit === null) {
    return { ok: false, error: "invalid_payment_amount", message: "The payment amount or configured limit is invalid.", payment_attempted: false };
  }
  const preview = {
    amountRequired: invoice.amountRequired,
    payTo: invoice.payTo,
    invoiceId: invoice.invoiceId,
    asset: invoice.asset,
    expiresAt: invoice.expiresAt,
    effective_max_price_usdc: effectiveLimit,
  };
  if (amount > limit) {
    return { ok: false, error: "exceeds_autopay_limit", message: `Required payment ${invoice.amountRequired} USDC exceeds the ${effectiveLimit} USDC autopay limit.`, payment_attempted: false, invoice: preview };
  }
  if (dry_run) {
    return { ok: true, dry_run: true, payment_attempted: false, message: `Would pay ${invoice.amountRequired} USDC to ${invoice.payTo}.`, invoice: preview };
  }

  const payment = await agentPay.payUrl(unlockUrl);
  if (payment.ok !== true || payment.paid !== true) {
    return { ok: false, error: "payment_failed", message: "agent-pay did not complete the x402 payment.", payment_attempted: true, invoice: preview, payment };
  }
  const unlocked = await api.get("unlock_deliverable", { task_id });
  return {
    ...publicEnvelope(unlocked),
    payment_attempted: true,
    paid: true,
    txHash: payment.txHash,
    finalStatus: payment.finalStatus,
  };
}));

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(error => {
  process.stderr.write(`human-menu-mcp failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exit(1);
});
