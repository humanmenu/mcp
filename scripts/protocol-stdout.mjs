#!/usr/bin/env node
import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["dist/index.js"], {
  env: { ...process.env },
  stdio: ["pipe", "pipe", "pipe"],
});
let stdout = "";
let stderr = "";
child.stdout.on("data", chunk => { stdout += chunk.toString(); });
child.stderr.on("data", chunk => { stderr += chunk.toString(); });

child.stdin.write(`${JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "stdout-test", version: "1.0.0" },
  },
})}\n`);

await new Promise(resolve => setTimeout(resolve, 300));
child.kill("SIGTERM");
await new Promise(resolve => child.once("close", resolve));

const lines = stdout.trim().split("\n").filter(Boolean);
if (lines.length !== 1) throw new Error(`Expected exactly one JSON-RPC stdout line, received ${lines.length}: ${stdout}`);
const message = JSON.parse(lines[0]);
if (message.jsonrpc !== "2.0" || message.id !== 1 || !message.result) throw new Error(`Invalid JSON-RPC initialize response: ${stdout}`);
process.stdout.write(`${JSON.stringify({ ok: true, stdout_json_rpc_only: true, stderr_bytes: Buffer.byteLength(stderr) })}\n`);
