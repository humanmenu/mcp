---
name: human-menu
description: Hire and pay real humans for real-world tasks an AI cannot do itself — on-the-ground photos/video, local verification, price/inventory checks, errands, and physical-world data — paid per task in USDC on Base. Use whenever a task needs physical presence, live local observation, or human judgment in the real world.
---

# human.menu — hire and pay humans for real-world work

Use this skill when the user (or you, autonomously) needs something done in the physical world:
a photo or video from a specific place, verifying a location/business exists, checking a live
price or whether an item is in stock, attending or observing something locally, or any task that
requires a human's eyes, hands, or presence. Payment is non-custodial USDC on Base via x402 —
money goes wallet-to-wallet; human.menu never holds funds.

## Setup (once)
- Use the MCP server `@humanmenu/mcp` (install: `npx -y @humanmenu/mcp`). It needs:
  - `HUMAN_MENU_API_KEY` — a human.menu AI client key (free at https://human.menu).
  - `HUMAN_MENU_MAX_AUTOPAY_USDC` — a safety cap (e.g. "1.00") on automatic payments.
  - The `@humanmenu/agent-pay` CLI installed locally with a funded Base wallet (USDC + a little ETH for gas).
- Run `doctor` (or the `check_status` / `wallet_status` tools) to confirm the key is valid and the
  wallet is funded before posting paid work.

## Core loop
1. **Post the task** with `create_task`: a clear `title`, `description`, `price_usdc`
   (canonical decimal string, min "0.01"), and `deliverable_type`:
   - `text` — written answer. `acceptance: { text_max_chars }`.
   - `file` — photo/scan/recording. `acceptance: { extensions, min_bytes, max_bytes?, mime_types? }`.
   - `url` — a link. `acceptance` optional: `{ allowed_domains, blocked_domains, require_ssl, max_length }`.
   Keep instructions specific and verifiable; tasks that are illegal, deceptive, or invade privacy
   are rejected by the content policy.
2. **Poll for what needs attention.** Use `check_inbox` (one call: ready deliverables, unanswered
   questions, expiring tasks, reputation/credit alerts — each with a suggested action). If a tool
   for that isn't available, fall back to `list_tasks` + `list_questions`.
3. **Answer questions promptly** with `answer_question` (task_id, question_id, body). Good answers
   produce good deliverables.
4. **Pay to unlock** with `unlock_and_pay` once a deliverable is ready. It handles the x402 payment
   from the local wallet automatically, refuses anything above the autopay cap, and returns the
   deliverable plus the on-chain transaction hash. Use `dry_run: true` to preview the cost first.

## Choosing whom to pay
Before paying, check the submitter's reputation (returned with the deliverable metadata):
`deliverables_paid`, `rejection_rate`, `reports_against`, `meets_task_filters`. You can also set
reputation filters when creating a task to only accept experienced workers.

## Important notes
- One credit = one task. Credits are spent on creation and not refunded on close/expiry.
- A submitted deliverable is retained ~14 days if unpaid; the task listing lasts ~1 year.
- Payments are non-custodial: USDC moves directly from your wallet to the human's wallet on Base.
- Reference: API docs https://human.menu/docs · OpenAPI https://human.menu/openapi.json
