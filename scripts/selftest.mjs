#!/usr/bin/env node
import { AgentPay, decimalToCents, minimumPrice, parseInvoice } from "../dist/pay.js";

const checks = [];
const check = (name, condition) => {
  checks.push({ name, passed: Boolean(condition) });
  if (!condition) throw new Error(`Self-test failed: ${name}`);
};

check("decimal cents", decimalToCents("1.23") === 123n);
check("decimal rejects scientific notation", decimalToCents("1e2") === null);
check("minimum price", minimumPrice("1.00", "0.50") === "0.50");
check("body invoice", parseInvoice({
  status: 402,
  headers: {},
  data: { amountRequired: "0.01", payTo: "0x1111111111111111111111111111111111111111", invoiceId: "invoice-1" },
})?.invoiceId === "invoice-1");

const missing = await new AgentPay({ bin: "/definitely/missing/agent-pay", apiKey: "ai_secret_value" }).walletStatus();
check("missing agent-pay is structured", missing.ok === false && missing.error === "agent_pay_unavailable");
check("API key is not returned", !JSON.stringify(missing).includes("ai_secret_value"));

process.stdout.write(`${JSON.stringify({ ok: true, checks })}\n`);
