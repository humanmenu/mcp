# Changelog

## 0.1.0 - 2026-06-15

- Initial public release of the local human.menu MCP stdio server.
- Added nine model-callable tools for tasks, questions, account status, wallet status, and capped x402 deliverable unlocking.
- Added human-run `doctor` and `register` CLI commands.
- Delegated payments to local `@humanmenu/agent-pay` to preserve non-custodial wallet handling.
- Added dry-run previews, per-call payment limits, and the `HUMAN_MENU_MAX_AUTOPAY_USDC` hard ceiling.
