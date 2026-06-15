#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const testKey = "ai_local_integration_test";
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "humanmenu-mcp-"));
const invocationMarker = path.join(tempDir, "agent-pay-invoked");
const fakeAgentPay = path.join(tempDir, "agent-pay");
fs.writeFileSync(fakeAgentPay, `#!/bin/sh\ntouch "${invocationMarker}"\nexit 99\n`, { mode: 0o755 });
const server = http.createServer((request, response) => {
  if (request.headers["x-api-key"] !== testKey) {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: false, error: "bad_test_key" }));
    return;
  }
  const url = new URL(request.url, "http://127.0.0.1");
  const action = url.searchParams.get("action");
  response.setHeader("content-type", "application/json");
  if (action === "get_deliverable_meta") {
    response.end(JSON.stringify({ ok: true, ready: true, type: "text", status: "ready" }));
  } else if (action === "unlock_deliverable") {
    response.writeHead(402);
    response.end(JSON.stringify({
      ok: false,
      error: "payment_required",
      amountRequired: "0.75",
      payTo: "0x1111111111111111111111111111111111111111",
      invoiceId: "integration-invoice",
      asset: "0x2222222222222222222222222222222222222222",
      expiresAt: "2099-01-01T00:00:00Z",
    }));
  } else if (action === "api_key_status") {
    response.end(JSON.stringify({ ok: true, credits_total: 10, credits_remaining: 9 }));
  } else if (action === "agent_inbox") {
    response.end(JSON.stringify({ ok: true, attention_needed: false, credits_remaining: 9, summary: { ready_deliverables: 0 }, poll_after_seconds: 60 }));
  } else if (action === "list_tasks") {
    response.end(JSON.stringify({ ok: true, tasks: [] }));
  } else if (action === "create_task") {
    response.writeHead(201);
    response.end(JSON.stringify({ ok: true, task_id: 123 }));
  } else {
    response.end(JSON.stringify({ ok: true }));
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const port = typeof address === "object" && address ? address.port : 0;

function makeClient(maxAutopay) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    env: {
      ...process.env,
      HUMAN_MENU_API_KEY: testKey,
      HUMAN_MENU_BASE_URL: `http://127.0.0.1:${port}/api/`,
      HUMAN_MENU_MAX_AUTOPAY_USDC: maxAutopay,
      AGENT_PAY_BIN: fakeAgentPay,
    },
  });
  return { transport, client: new Client({ name: "human-menu-mcp-integration", version: "0.1.0" }) };
}

function parsed(result) {
  return JSON.parse(result.content.find(item => item.type === "text")?.text || "{}");
}
function check(name, condition) {
  if (!condition) throw new Error(`Integration check failed: ${name}`);
}

try {
  const { transport, client } = makeClient("1.00");
  await client.connect(transport);
  const dryRun = parsed(await client.callTool({ name: "unlock_and_pay", arguments: { task_id: 123, dry_run: true } }));
  check("dry-run succeeds", dryRun.ok === true && dryRun.dry_run === true && dryRun.payment_attempted === false);
  check("dry-run amount", dryRun.invoice.amountRequired === "0.75");
  const inbox = parsed(await client.callTool({ name: "check_inbox", arguments: { counts_only: true } }));
  check("check-inbox succeeds", inbox.ok === true && inbox.attention_needed === false && inbox.poll_after_seconds === 60);

  const overCap = parsed(await client.callTool({ name: "unlock_and_pay", arguments: { task_id: 123, max_price_usdc: "0.50" } }));
  check("over-cap refuses", overCap.ok === false && overCap.error === "exceeds_autopay_limit" && overCap.payment_attempted === false);
  await client.close();

  const envLimited = makeClient("0.50");
  await envLimited.client.connect(envLimited.transport);
  const envOverCap = parsed(await envLimited.client.callTool({ name: "unlock_and_pay", arguments: { task_id: 123 } }));
  check("environment cap refuses", envOverCap.ok === false && envOverCap.error === "exceeds_autopay_limit" && envOverCap.payment_attempted === false);
  await envLimited.client.close();

  check("no payment process", !fs.existsSync(invocationMarker));

  process.stdout.write(`${JSON.stringify({ ok: true, checks: ["dry-run", "per-call-cap", "environment-cap", "no-payment-process"] })}\n`);
} finally {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(tempDir, { recursive: true, force: true });
}
