#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const shouldPay = process.argv.includes("--pay") || process.env.SMOKE_PAY === "1";
const smokeTaskId = process.env.SMOKE_TASK_ID ? Number(process.env.SMOKE_TASK_ID) : null;
const results = [];
let transport;

function record(name, result, required = true) {
  const text = result?.content?.find(item => item.type === "text")?.text;
  let parsed = {};
  try { parsed = JSON.parse(text || "{}"); } catch { parsed = { ok: false, error: "invalid_json_tool_output", text }; }
  const passed = parsed.ok === true;
  results.push({ name, required, passed, result: parsed });
  process.stdout.write(`${JSON.stringify({ name, required, passed, result: parsed })}\n`);
  return parsed;
}

async function call(client, name, args = {}, required = true) {
  try {
    return record(name, await client.callTool({ name, arguments: args }), required);
  } catch (error) {
    const result = { ok: false, error: "mcp_call_failed", message: error instanceof Error ? error.message : String(error) };
    results.push({ name, required, passed: false, result });
    process.stdout.write(`${JSON.stringify({ name, required, passed: false, result })}\n`);
    return result;
  }
}

try {
  transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    env: { ...process.env },
    stderr: "pipe",
  });
  const client = new Client({ name: "human-menu-mcp-smoke", version: "0.1.0" });
  await client.connect(transport);

  const tools = await client.listTools();
  const expected = ["check_status", "list_tasks", "create_task", "close_task", "get_deliverable_meta", "list_questions", "answer_question", "wallet_status", "unlock_and_pay"];
  const toolNames = tools.tools.map(tool => tool.name);
  const toolsPassed = expected.every(name => toolNames.includes(name)) && toolNames.length === expected.length;
  results.push({ name: "tools/list", required: true, passed: toolsPassed, result: { ok: toolsPassed, tools: toolNames } });
  process.stdout.write(`${JSON.stringify({ name: "tools/list", required: true, passed: toolsPassed, result: { ok: toolsPassed, tools: toolNames } })}\n`);

  await call(client, "check_status");
  await call(client, "wallet_status");
  await call(client, "list_tasks", { status: "open" });
  const created = await call(client, "create_task", {
    title: `[MCP-SMOKE] ${new Date().toISOString()}`,
    description: "Automated MCP smoke test. Return the word OK.",
    price_usdc: "0.01",
    deliverable_type: "text",
    acceptance: { text_max_chars: 100 },
  });
  if (created.task_id) {
    await call(client, "list_questions", { task_id: Number(created.task_id) });
  } else {
    const skipped = { name: "list_questions", required: true, passed: false, result: { ok: false, error: "create_task_did_not_return_task_id" } };
    results.push(skipped);
    process.stdout.write(`${JSON.stringify(skipped)}\n`);
  }

  if (smokeTaskId && Number.isInteger(smokeTaskId) && smokeTaskId > 0) {
    await call(client, "unlock_and_pay:dry_run", { task_id: smokeTaskId, dry_run: true });
    if (shouldPay) await call(client, "unlock_and_pay:pay", { task_id: smokeTaskId, dry_run: false });
  } else {
    results.push({ name: "unlock_and_pay:dry_run", required: false, passed: true, result: { ok: true, skipped: true, reason: "SMOKE_TASK_ID is unset" } });
    process.stdout.write(`${JSON.stringify(results.at(-1))}\n`);
  }

  await client.close();
} catch (error) {
  results.push({ name: "handshake", required: true, passed: false, result: { ok: false, error: error instanceof Error ? error.message : String(error) } });
} finally {
  if (transport) await transport.close().catch(() => {});
}

const failures = results.filter(result => result.required && !result.passed).map(result => result.name);
const summary = { ok: failures.length === 0, passed: results.length - failures.length, failed: failures.length, failures, real_payment_enabled: shouldPay };
process.stdout.write(`${JSON.stringify({ summary })}\n`);
process.exitCode = summary.ok ? 0 : 1;
