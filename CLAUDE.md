# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

Notify Fanout is a GitHub Action (TypeScript, bundled JavaScript action, not Docker) that sends one CI/CD notification to many chat targets in a single step. Telegram is the first provider.

`docs/notify-fanout-project-summary.md` is the build spec and the **source of truth**: read the relevant section before implementing anything. If the spec is ambiguous or wrong, stop and ask before deviating.

## Commands

Node 24 (`.nvmrc`; the action itself runs on `node24`).

- `npm run all`: format check, lint, typecheck, test, build. Run this before committing.
- `npm test`: Vitest, once. `npx vitest run src/main.test.ts` runs one file; add `-t "<name>"` for one test. `npm run test:watch` watches.
- `npm run lint` / `npm run typecheck` / `npm run format`
- `npm run build`: bundles `src/index.ts` into `dist/index.js` with esbuild (`scripts/build.mjs`).

## Stack notes

- ESM throughout (`"type": "module"`), because `@actions/core` 3.x is ESM-only. Relative imports use the `.js` extension (`NodeNext` resolution).
- TypeScript is pinned to 6.0.x, since typescript-eslint does not support TypeScript 7 yet. ESLint uses `strictTypeChecked`. `tsconfig.json` sets `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- `src/index.ts` is the bundle entry and only calls `run()`. Keep logic in `src/main.ts` and below so tests can import it without side effects.
- Workflows pin third-party actions to full commit SHAs, with the version in a trailing comment.

## Implementation phases

Work goes phase by phase (spec §9): 0 scaffold → 1 core engine with a fake provider → 2 Telegram → 3 hardening and v1.0.0 → 4 Slack/Discord → 5 extras. After each phase, run its acceptance checks, then stop and report. Do not build features from a later phase early.

## Architecture (spec §4.7, §7)

The code is split into six layers that must stay independent. `src/main.ts` only wires them together:

1. `src/config/`: reads inputs, parses `targets` (YAML; JSON is valid YAML), validates. Simple-mode inputs (`telegram-bot-token`, `telegram-chat-id`) produce a single target. Per-target fields override global ones. Targets without an `id` get one auto-generated (`telegram-1`, ...).
2. `src/context/`: maps the GitHub context and event payload to `{{VARIABLE}}` values.
3. `src/message/`: the provider-neutral `Message` model (title, body, status, fields, links), plus presets, templates and escaping.
4. `src/providers/`: one self-contained folder per platform, registered in `providers/index.ts`. Each one implements `validate`, `secrets`, `render` and `send`. **`render` must be pure (no network) and `send` does network only.** Adding a provider must not touch the engine beyond registering it.
5. `src/engine/`: fan-out with bounded concurrency, retry with exponential backoff and jitter, and per-target results. Targets are independent: one failure never blocks or cancels another.
6. `src/report/`: outputs (`results`, `success-count`, `failure-count`), job summary, logging and masking.

`dist/` is committed, and CI has a `check-dist` job that fails when the bundle is stale. Rebuild `dist/` whenever `src/` changes.

## Rules that are easy to get wrong

- **Escaping:** variable values are escaped for the target's format (for example, HTML-escaped for Telegram HTML). Template text itself is not escaped. Unknown variables render as empty and emit a warning; they do not fail the run.
- **Retries:** retry on network errors, HTTP 429 and 5xx. Do not retry on other 4xx errors. Honor Telegram's `parameters.retry_after` and the `Retry-After` header.
- **`fail-on`:** `any` (default) fails the step if any target failed. `all` fails it only if every target failed. `none` only warns.
- **Secrets:** call `core.setSecret` on every secret before any logging. Telegram tokens sit in the request URL path, so redact URLs in all logs and error messages. Never log full payloads or headers outside `debug`, and keep `debug` masked too.
- **Naming:** `action.yml` inputs use kebab-case. Keys inside `targets` entries use snake_case.
- **Telegram:** the message limit is 4096 characters. Split at paragraph or line boundaries, and never break HTML tags (close and reopen them across chunks). Edit-in-place is stateless: `message_id` comes back through the `results` output and a later step passes it in as `edit_message_id`.

## Working agreement (spec §10)

- Justify every new dependency in one line. Prefer Node built-ins (`fetch`, `crypto`).
- Write tests alongside each module. Rendering and escaping logic needs golden tests. HTTP is mocked in unit tests.
- Before implementing anything that may have changed, check the current official docs: GitHub Actions Node runtime (Node 20 is being replaced by Node 24) and metadata syntax, Telegram Bot API limits and rate limits, and Marketplace publishing rules.
- Make small commits.
