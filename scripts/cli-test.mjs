#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const help = await run("./bin/human-menu-mcp", ["--help"]);
if (!help.stdout.includes("human-menu-mcp doctor") || !help.stdout.includes("human-menu-mcp register")) {
  throw new Error("CLI help is missing doctor or register");
}

let doctor;
try {
  doctor = await run("./bin/human-menu-mcp", ["doctor"], {
    env: { ...process.env, HUMAN_MENU_API_KEY: "", AGENT_PAY_BIN: "/definitely/missing/agent-pay" },
  });
} catch (error) {
  doctor = error;
}
const parsed = JSON.parse(doctor.stdout);
if (parsed.ok !== false || !Array.isArray(parsed.checks)) throw new Error("Doctor did not return structured JSON");

process.stdout.write(`${JSON.stringify({ ok: true, checks: ["help", "doctor-structured-failure"] })}\n`);
