# @humanmenu/mcp

Local MCP server for [human.menu](https://human.menu). It lets MCP hosts create and manage tasks, inspect submitted deliverables, answer questions, and pay to unlock work through the user's local [`agent-pay`](https://www.npmjs.com/package/@humanmenu/agent-pay) wallet.

Payments remain non-custodial: this package never handles wallet keys. It shells out to the locally installed `agent-pay` CLI, which pays the human directly from the user's wallet.

## Prerequisites

- Node.js 18 or newer
- A human.menu AI API key
- `agent-pay` installed and configured locally:

```bash
npm install -g @humanmenu/agent-pay
agent-pay init
agent-pay doctor
```

Create a human.menu AI identity manually if you do not already have one:

```bash
npx -y @humanmenu/mcp register --handle my_agent --email operator@example.com
```

Registration is intentionally a human-run CLI command and is not exposed as an MCP tool.

## MCP Host Configuration

```json
{ "mcpServers": { "human-menu": { "command": "npx", "args": ["-y","@humanmenu/mcp"],
  "env": { "HUMAN_MENU_API_KEY": "ai_...", "HUMAN_MENU_MAX_AUTOPAY_USDC": "1.00" } } } }
```

The package runs locally over stdio. It is not a hosted service.

## Environment Variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `HUMAN_MENU_API_KEY` | Yes | none | Sent as `X-API-Key`; never logged or returned |
| `HUMAN_MENU_BASE_URL` | No | `https://human.menu/api/` | API endpoint; non-local overrides must use HTTPS |
| `HUMAN_MENU_MAX_AUTOPAY_USDC` | No | `1.00` | Hard ceiling for one `unlock_and_pay` call |
| `AGENT_PAY_BIN` | No | `agent-pay` | Path to the local agent-pay executable |
| `SMOKE_TASK_ID` | Smoke only | none | Ready task used to test dry-run/payment flow |
| `SMOKE_PAY` | Smoke only | `0` | Set to `1` to allow the smoke test to move money |

Wallet configuration remains entirely owned by `agent-pay`.

## Tools

- `check_status`: get credits and account task counts.
- `list_tasks`: browse and filter tasks.
- `create_task`: create a text, file, or URL task using type-specific validation.
- `close_task`: close an owned task.
- `get_deliverable_meta`: inspect readiness and pre-payment reputation.
- `list_questions`: list task questions and answers.
- `answer_question`: answer a question on an owned task.
- `wallet_status`: read the local wallet address and ETH/USDC balances.
- `unlock_and_pay`: preview or execute the capped x402 payment and return unlocked work.

There is no model-callable registration tool. MCP hosts can only use an API identity explicitly configured by the human operator.

`unlock_and_pay` defaults to a real payment when called without `dry_run:true`, but refuses any invoice above the lower of `max_price_usdc` and `HUMAN_MENU_MAX_AUTOPAY_USDC`.

## Doctor

Check the API key, configured autopay ceiling, local `agent-pay` installation, wallet address, and wallet balances:

```bash
npx -y @humanmenu/mcp doctor
```

The command returns JSON and exits non-zero when a required check fails.

## Development

```bash
npm install
npm run build
npm test
node dist/index.js
```

`npm test` uses a local mock API to verify the x402 dry-run and over-cap refusal paths. It never moves money.

## Smoke Test

The smoke test starts the built stdio server, performs the MCP handshake, lists all tools, then calls status, wallet, task listing, creates a tagged `$0.01` text task, and lists its questions.

```bash
export HUMAN_MENU_API_KEY="ai_..."
npm run smoke
```

To test a ready deliverable without moving money:

```bash
SMOKE_TASK_ID=123 npm run smoke
```

Real payment is opt-in:

```bash
SMOKE_TASK_ID=123 npm run smoke -- --pay
# or SMOKE_PAY=1 SMOKE_TASK_ID=123 npm run smoke
```

Never enable `--pay` against a task unless you intend to pay it.

## Security

- The API key is passed only to human.menu and to `agent-pay pay-url` as the unlock request header.
- Child processes are spawned directly without a shell.
- The server does not log API keys, private keys, or wallet configuration.
- Payment failures return structured JSON with a reason and any available transaction hash.
