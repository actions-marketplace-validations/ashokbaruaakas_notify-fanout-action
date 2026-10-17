# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

Notify Fanout is a GitHub Action (TypeScript, bundled JavaScript action, not Docker) that sends one CI/CD notification to many chat targets in a single step. Telegram is the first provider.

`docs/notify-fanout-project-summary.md` is the build spec and the **source of truth**: read the relevant section before implementing anything. If the spec is ambiguous or wrong, stop and ask before deviating.

## Commands

Node 24 (`.nvmrc`; the action itself runs on `node24`).

- `npm run all`: format check, lint, typecheck, test, build. Run this before committing.
- `npm test`: Vitest, once. Live Telegram checks run in the manual `e2e.yml` workflow (`gh workflow run e2e.yml`), which needs the `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` secrets. `npx vitest run src/main.test.ts` runs one file; add `-t "<name>"` for one test. `npm run test:watch` watches.
- `npm run lint` / `npm run typecheck` / `npm run format`
- `npm run build`: bundles `src/index.ts` into `dist/index.js` with esbuild (`scripts/build.mjs`).

## Stack notes

- ESM throughout (`"type": "module"`), because `@actions/core` 3.x is ESM-only. Relative imports use the `.js` extension (`NodeNext` resolution).
- TypeScript is pinned to 6.0.x, since typescript-eslint does not support TypeScript 7 yet. ESLint uses `strictTypeChecked`. `tsconfig.json` sets `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- `src/index.ts` is the bundle entry and only calls `run()`. Keep logic in `src/main.ts` and below so tests can import it without side effects.
- `run(deps)` takes every side effect as an injected `Dependencies` value: runner I/O (`ActionIO` in `src/io.ts`), env, file reads, fetch, sleep and random. Tests drive it with the recorder and the `fake` provider in `test/harness.ts` and `test/fake-provider.ts`; no real providers are needed.
- Golden files live in `test/golden/` (written with `toMatchFileSnapshot`). After an intended rendering change, run `npx vitest run -u` and review the diff.
- The only runtime dependencies are `@actions/core` and `yaml`. The GitHub context is read straight from env and `GITHUB_EVENT_PATH`, not through `@actions/github`. Validation is hand-written with `ObjectReader` (`src/config/reader.ts`), which also rejects unknown keys.
- Workflows pin third-party actions to full commit SHAs, with the version in a trailing comment.

## Implementation phases

Work goes phase by phase (spec §9): 0 scaffold → 1 core engine with a fake provider → 2 Telegram → 3 hardening and v1.0.0 → 4 Slack/Discord → 5 extras. After each phase, run its acceptance checks, then stop and report. Do not build features from a later phase early.

Status: phases 0–3 are done, and v1.0.0 is the stable release. Phases 4 and 5 are on hold at the user's request; don't start them unless asked.

## Releases and user-facing docs

- `v1` is a moving major tag that users pin to (`ashokbaruaakas/notify-fanout-action@v1`). Anything that breaks existing workflows needs a v2.
- To release: move the `CHANGELOG.md` `Unreleased` entries into a version section, bump `package.json`, commit, and push a `vX.Y.Z` tag. `release.yml` verifies the tag, version and `dist/`, creates the GitHub release from the changelog, and moves `vX`. Marketplace listing happens in the web UI, not via API.
- User docs live in `README.md` and `docs/` (`config.md`, `presets.md`, `providers/telegram.md`, `recipes.md`). Keep them in step with behavior changes: limits, variables, preset wording and error hints are all documented there.

## Architecture (spec §4.7, §7)

The code is split into six layers that must stay independent. `src/main.ts` only wires them together:

1. `src/config/`: reads inputs, parses `targets` (YAML; JSON is valid YAML), validates. Simple-mode inputs (`telegram-bot-token`, `telegram-chat-id`) produce a single target. Per-target fields override global ones. Targets without an `id` get one auto-generated (`telegram-1`, ...).
2. `src/context/`: maps the GitHub context and event payload to `{{VARIABLE}}` values.
3. `src/message/`: the provider-neutral `Message` model (title, body, status, fields, links), plus presets, templates and escaping.
4. `src/providers/`: one self-contained folder per platform, registered in `providers/index.ts`. Each one implements `Provider` in `providers/types.ts`: `validate`, `secrets`, `escapeRaw`, `render` and `send`. **`render` must be pure (no network) and `send` does network only.** Adding a provider must not touch the engine beyond registering it. The registry binds each target's config into a `BoundTarget`, so the rest of the code never handles provider-specific types. Use `providers/http.ts` for requests: it applies the timeout signal, turns network errors into retryable `DeliveryError`s, classifies HTTP statuses and never puts the URL in errors. Markdown bodies are parsed with `parseMarkdown` (`message/markdown.ts`) and converted from the resulting tree.
5. `src/engine/`: fan-out with bounded concurrency, retry with exponential backoff and jitter, and per-target results. Targets are independent: one failure never blocks or cancels another.
6. `src/report/`: outputs (`results`, `success-count`, `failure-count`), job summary, logging and masking.

`dist/` is committed, and CI has a `check-dist` job that fails when the bundle is stale. Rebuild `dist/` whenever `src/` changes.

## Rules that are easy to get wrong

- **Escaping:** only the body has a format: `text`, `markdown` (neutral subset) or `raw` (provider-native, passed through). Variable values in the body are escaped for that format: `escapeMarkdown` for markdown, and the provider's `escapeRaw` for raw. Title, fields and links are always plain text, which providers escape when rendering. Template text is never escaped, and neither is `{{MESSAGE}}` inside a template, because it is already in the body's format. In the markdown subset a backslash escape works everywhere, including inside code. Unknown variables render as empty and emit one warning each; they do not fail the run.
- **Content precedence:** the body comes from the target's `template_file`/`message`, then the global `template-file`/`message`, then the preset. `{{TITLE}}` and `{{MESSAGE}}` are the resolved title and message. Fields and links whose value renders empty are dropped.
- **Target independence:** a failure to render or load a template fails only that target (0 attempts). A config error fails the whole step.
- **Retries:** retry on network errors, HTTP 429 and 5xx. Do not retry on other 4xx errors. Honor Telegram's `parameters.retry_after` and the `Retry-After` header by passing `retryAfterMs` on the `DeliveryError`. A requested wait over 60s fails the target instead. `retries: 3` means up to 4 attempts.
- **`action.yml`:** never write `${{ … }}` in it, even inside a description. The runner evaluates it and the action fails to load.
- **`fail-on`:** `any` (default) fails the step if any target failed. `all` fails it only if every target failed. `none` only warns.
- **Secrets:** call `core.setSecret` on every secret before any logging. The runner masks secrets only in logs, so all logs, outputs and the job summary also pass through `Redactor`. Redact individual values, not serialized JSON, so outputs stay valid. Telegram tokens sit in the request URL path, so redact URLs in all logs and error messages. Never log full payloads or headers outside `debug`, and keep `debug` masked too.
- **Naming:** `action.yml` inputs use kebab-case. Keys inside `targets` entries use snake_case.
- **Telegram** (`src/providers/telegram/`): the message is built as text runs with formatting marks (`runs.ts`). Splitting counts visible characters only (the 4096 limit applies after entity parsing), and each chunk is serialized independently, so tags are always balanced. Raw HTML bodies are parsed into runs too; raw MarkdownV2 bodies cannot be, so they split as plain text. Edits and `split: false` cut to one chunk with "…". Telegram does not allow code inside other entities, so code runs drop their outer marks. Links become inline buttons, two per row on the last chunk; URLs that aren't http(s) or tg:// are listed as text instead. Edit-in-place is stateless: `message_id` (the first chunk's) comes back in the `results` output, and a later step passes it in as `edit_message_id`. "message is not modified" counts as success.
- **Multi-request sends:** `SendContext.state` persists across retry attempts of one target. Telegram records the chunks it has delivered, so a retry resumes instead of resending them.

## Working agreement (spec §10)

- Justify every new dependency in one line. Prefer Node built-ins (`fetch`, `crypto`).
- Write tests alongside each module. Rendering and escaping logic needs golden tests. HTTP is mocked in unit tests.
- Before implementing anything that may have changed, check the current official docs: GitHub Actions Node runtime (Node 20 is being replaced by Node 24) and metadata syntax, Telegram Bot API limits and rate limits, and Marketplace publishing rules.
- Make small commits.
