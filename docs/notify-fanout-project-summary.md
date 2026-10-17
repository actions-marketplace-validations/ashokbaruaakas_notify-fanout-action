# Notify Fanout — Project Summary & Build Spec

> Send one CI/CD message to Telegram and other chat platforms from a single GitHub Action step, configured per target.

- **Name:** Notify Fanout (repo slug: `notify-fanout`)
- **Type:** GitHub Action (JavaScript/TypeScript, bundled), free and open source
- **First provider:** Telegram. Architecture must make adding providers cheap.
- **Status:** Planning complete. This file is the source of truth for the first build.

---

## 1. Goal

Build and publish a free, open-source GitHub Action that:

1. Sends a notification to **one or many messaging platforms** from a single workflow step, chosen by configuration.
2. Lets the user **customize the message** (title, body, fields, links, templates, per-platform overrides).
3. Starts with **Telegram**, but is designed so each new platform is one self-contained provider.
4. Is **reliable** (one failing target never blocks the others), **secure** (secrets never leak), and **simple** to use in the common case.

## 2. Non-goals

- Not a hosted service. No backend, no external bot/token service, no telemetry.
- No persistent state between runs (message IDs are passed through step outputs/inputs, not stored).
- No inbound or two-way bot behavior. Outbound notifications only.
- No Docker-based action (slow startup). Use a JavaScript action with a committed, bundled `dist/`.
- No paid tier or gated features.

## 3. Market context (why build this)

A review of existing actions found:

| Group | Examples | Limitation |
|---|---|---|
| Telegram-only | `appleboy/telegram-action`, `xinthink/action-telegram`, `telegram-notify-action` | Single platform. `appleboy` is richest (photos, files, topics, templates). |
| Webhook-based multi-platform | `Netail/webhook-notifier` | Webhook platforms only (Discord, Slack, Teams). No Telegram. |
| Multi-platform, simple | `hunghg255/action-notifications`, UniNotify | Basic title/message, little customization. |
| Closest competitor | `HasanHajHasan/multi-notification-channels` (Marketplace: "Multi Notification Channel") | Wraps Apprise, one URL input per platform, one message for all platforms, 3 presets, no per-target overrides, README inconsistencies, very early (v0.1.x). |

### Gaps we fill

1. Multiple targets per platform (e.g. two Telegram chats with different settings) in one step.
2. Per-platform message control, inline, not only via template files.
3. Native formatting per platform from one shared message model (escaping, blocks, embeds).
4. Presets for many events: workflow, deployment, release, PR, issue, push, plus custom.
5. Defined failure behavior: independent sends, retries, rate-limit handling, configurable failure policy.
6. Deep Telegram support inside a multi-platform action (topics, silent, splitting, edit-in-place).
7. Provider plugin architecture: new platform = one folder + tests.
8. Strong docs, tests, semver releases, security defaults.

## 4. Feature scope (all in scope)

Phases in section 12 are an **implementation order**, not feature cuts.

### 4.1 Configuration: two modes

**Simple mode** — one platform, minimal inputs:

```yaml
- uses: <owner>/notify-fanout@v1
  if: always()
  with:
    status: ${{ job.status }}
    telegram-bot-token: ${{ secrets.TELEGRAM_BOT_TOKEN }}
    telegram-chat-id: ${{ secrets.TELEGRAM_CHAT_ID }}
```

**Multi-target mode** — a `targets` input (YAML; JSON is valid YAML), any number of targets, any mix of providers:

```yaml
- uses: <owner>/notify-fanout@v1
  if: always()
  with:
    status: ${{ job.status }}
    preset: workflow
    targets: |
      - id: team
        provider: telegram
        token: ${{ secrets.TG_TOKEN }}
        chat_id: "-1001234567890"
        topic_id: 5
        silent: true
      - id: ops
        provider: telegram
        token: ${{ secrets.TG_TOKEN }}
        chat_id: "-1009876543210"
        message: "Build {{STATUS}} on {{BRANCH}} — {{RUN_URL}}"
```

Rules:
- Simple-mode inputs are shortcuts that produce a single target. Anything beyond token/chat ID uses `targets`.
- Per-target fields override global ones (`title`, `message`, `template-file`, `format`, provider options).
- Every target has an optional `id` used in results and logs. Auto-generate one if omitted (`telegram-1`, ...).

### 4.2 Message model (provider-neutral)

```
Message {
  title: string
  body: string                      // plain text, or neutral markdown subset
  status: success | failure | cancelled | warning | info | started
  fields: [{ name, value, short? }]
  links:  [{ label, url }]          // rendered as buttons where supported, else as text links
}
```

- Providers **render** this model into their native format (pure function, no network).
- Neutral markdown subset: bold, italic, inline code, code block, links. Converted per provider.
- A **raw mode** per target lets advanced users pass native format untouched (e.g. Telegram HTML as-is).
- Status maps to emoji: success ✅, failure ❌, cancelled ⚪, warning ⚠️, info ℹ️, started ⏳.

### 4.3 Templates and variables

- Template syntax: `{{VARIABLE}}` (double braces, so it never clashes with JSON in Slack/Teams payloads).
- Templates can be inline (`message`) or file-based (`template-file`, path relative to the repo root), globally or per target.
- **Variable values are escaped for the target format** (e.g. HTML-escaped for Telegram HTML), so PR titles or commit messages cannot break formatting or inject markup. Template text itself is not escaped.
- Variables (from GitHub context): `TITLE`, `MESSAGE`, `STATUS`, `EMOJI`, `REPOSITORY`, `BRANCH`, `WORKFLOW`, `JOB`, `EVENT`, `COMMIT`, `COMMIT_SHORT`, `COMMIT_MESSAGE`, `AUTHOR`, `RUN_URL`, `RUN_NUMBER`, `SERVER_URL`, `ENVIRONMENT`, and event-specific: `PR_NUMBER`, `PR_TITLE`, `PR_URL`, `ISSUE_NUMBER`, `ISSUE_TITLE`, `ISSUE_URL`, `TAG`, `RELEASE_URL`.
- Unknown variable: render as empty and emit a warning (do not fail).

### 4.4 Presets

`preset` input: `auto` (default) | `workflow` | `deployment` | `release` | `pull_request` | `issue` | `push` | `custom`.

- `auto` picks by `github.context.eventName`, falling back to `workflow`.
- A preset produces `title`, `body`, `fields`, `links`. Any of them can be overridden individually by `title`, `message`, `fields`, `links` inputs.
- `custom` means no preset: the user supplies content.
- Presets are status-aware (emoji, wording).

### 4.5 Reliable delivery

- Targets are sent **concurrently** (bounded by `concurrency`, default 5) and **independently**: one failure never blocks or cancels the others.
- Per-request timeout (`timeout-seconds`, default 15).
- Retries (`retries`, default 3) with exponential backoff plus jitter.
  - Retry on: network errors, HTTP 429, HTTP 5xx.
  - Do not retry on: other 4xx (bad token, bad chat ID, bad payload). Report the error clearly.
  - Honor `retry_after` (Telegram `parameters.retry_after`) and the `Retry-After` header.
- `fail-on` input controls the step result: `any` (default) | `all` | `none`.
  - `any`: step fails if any target failed after retries.
  - `all`: step fails only if every target failed.
  - `none`: never fail the step; only warn.
- Outputs and job summary report per-target results (see 4.8).

### 4.6 Telegram provider (first provider, full depth)

Uses the Telegram Bot API over HTTPS with Node's built-in `fetch`.

Target options:

| Option | Notes |
|---|---|
| `token` | Bot token. **Masked everywhere.** |
| `chat_id` | Chat, group, or channel (`@name` or numeric ID). |
| `topic_id` | Forum topic (`message_thread_id`). |
| `parse_mode` | `html` (default) \| `markdownv2` \| `none`. Escaping handled by the provider. |
| `silent` | `disable_notification`. |
| `disable_link_preview` | Disable link previews. |
| `reply_to_message_id` | Reply threading. |
| `edit_message_id` | Edit an existing message instead of sending a new one (see below). |
| `split` | Auto-split long messages (default `true`). |

Behavior:
- **Link buttons:** render `links` as an inline keyboard of URL buttons.
- **Splitting:** split at paragraph/line boundaries when text exceeds the 4096-character limit. With HTML, never break tags (close and reopen as needed).
- **Edit-in-place (stateless):** each target returns its `message_id` in the `results` output. A later step passes it as `edit_message_id` so "started" becomes "succeeded" in the same message. No persistence needed.
- **Errors:** map common API errors (`401` bad token, `400 chat not found`, `403 bot was blocked/kicked`, `429` rate limit) to clear, actionable messages.
- **Attachments** (photo/document) are planned after core delivery (see phases).
- Verify current limits and rate limits against the official Bot API docs when implementing.

### 4.7 Provider architecture (plugin-style)

Each provider is a self-contained folder implementing one interface. Adding a platform must not require touching the core engine except registering the provider.

```ts
interface Provider<Config> {
  id: string;                                   // 'telegram'
  validate(raw: unknown): Config;               // schema validation; throws a clear config error
  secrets(config: Config): string[];            // values that must be masked
  render(msg: Message, config: Config): Rendered; // PURE: no network, easy to unit test
  send(rendered: Rendered, config: Config, ctx: SendContext): Promise<SendResult>; // network only
}
```

Separation of concerns (keep these layers independent):

1. **Config** — read inputs, parse `targets`, validate.
2. **Context** — map GitHub context/event payload to variables.
3. **Message** — presets, templates, escaping, the neutral model.
4. **Providers** — render (pure) and send (network).
5. **Engine** — fan-out, concurrency, retry, results.
6. **Reporting** — outputs, job summary, logs, masking.

### 4.8 Outputs, summary, dry-run

- `results` output: JSON array `[{ id, provider, ok, attempts, message_id?, error? }]`.
- `success-count` and `failure-count` outputs.
- Job summary table (target id, provider, status, attempts). Never include secrets.
- `dry-run: true`: render and print each target's final message (secrets masked) without sending anything.
- `debug: true`: verbose logs (still masked).

### 4.9 Security by default

- Call `core.setSecret` on every secret value (tokens, URLs containing tokens) before any logging.
- Telegram tokens appear in the request URL path. **Redact URLs in all logs and error messages.**
- Never log full request payloads or headers in normal mode.
- Validate and bound all inputs (message size, target count).
- Escape variable values per target format (see 4.3).
- Minimal dependencies; bundle into `dist/`. Prefer Node built-ins (`fetch`, `crypto`).
- Own workflows use least-privilege `permissions:` and pinned action SHAs. Dependabot enabled.
- Docs include a note on forks and `pull_request_target` (secrets are not available to forks; do not echo untrusted input unescaped).
- `SECURITY.md` with a private vulnerability reporting process.

### 4.10 Quality and release

- Unit tests with mocked HTTP; golden tests for rendering and escaping; config validation tests.
- A manually triggered live e2e workflow using a real test Telegram bot (secrets stored in the repo).
- CI: lint, typecheck, test, build, and a `check-dist` job that fails if `dist/` is out of date.
- Semver releases: `v1.0.0` plus a moving `v1` tag; GitHub Releases with a changelog.
- Marketplace listing with branding (icon, color) and a clear description. Pick the best-fit category.
- Docs: README (quick start, simple vs multi-target, inputs table), per-provider docs, config reference, presets reference, recipes (failure alerts, deploy notices, release announcements, PR notices, split success/failure chats).
- License: MIT. Files: `LICENSE`, `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`.

## 5. Inputs reference (initial)

| Input | Default | Description |
|---|---|---|
| `status` | `info` | Pass `${{ job.status }}` for job results; also accepts `started`, `warning`, custom. |
| `preset` | `auto` | See 4.4. |
| `title` | preset | Override title. |
| `message` | preset | Override body (supports `{{VARIABLES}}`). |
| `fields` | none | YAML/JSON list of `{name, value, short?}`. |
| `links` | preset | YAML/JSON list of `{label, url}`. |
| `template-file` | none | Global template file path. |
| `format` | `text` | `text` or `markdown` (neutral subset). |
| `targets` | none | YAML/JSON list of targets (multi-target mode). |
| `telegram-bot-token` | none | Simple-mode shortcut. |
| `telegram-chat-id` | none | Simple-mode shortcut. |
| `fail-on` | `any` | `any` \| `all` \| `none`. |
| `retries` | `3` | Retry attempts for retryable errors. |
| `timeout-seconds` | `15` | Per-request timeout. |
| `concurrency` | `5` | Max parallel sends. |
| `dry-run` | `false` | Render only. |
| `debug` | `false` | Verbose masked logs. |

Outputs: `results`, `success-count`, `failure-count`.

Input naming: kebab-case in `action.yml`; snake_case keys inside `targets` entries.

## 6. Proposed tech stack (confirm before starting)

- **Language:** TypeScript, strict mode.
- **Runtime:** the current Node runtime supported for JavaScript actions (verify in GitHub docs at build time; Node 20 is being phased out in favor of Node 24).
- **Libraries:** `@actions/core`, `@actions/github`; a small YAML parser for `targets`; a schema validator (e.g. `zod`) if it earns its weight. Everything bundled into `dist/` (esbuild or `@vercel/ncc`).
- **HTTP:** built-in `fetch`.
- **Tests:** Vitest (or Jest) with a mocked HTTP layer.
- **Lint/format:** ESLint + Prettier.

## 7. Proposed repository layout

```
notify-fanout/
├─ action.yml
├─ src/
│  ├─ main.ts                  # entrypoint: wires the layers together only
│  ├─ config/                  # inputs, targets parsing, validation
│  ├─ context/                 # GitHub context -> variables
│  ├─ message/                 # model, presets, templates, escaping
│  ├─ providers/
│  │  ├─ index.ts              # registry
│  │  └─ telegram/             # validate, render, send, errors, tests
│  ├─ engine/                  # fan-out, concurrency, retry, backoff
│  └─ report/                  # outputs, summary, masking, logging
├─ dist/                       # committed bundle
├─ test/                       # shared fixtures, golden files
├─ docs/                       # config.md, presets.md, providers/telegram.md, recipes.md
├─ .github/workflows/          # ci.yml, check-dist.yml, release.yml, e2e.yml (manual)
├─ README.md  LICENSE  CHANGELOG.md  CONTRIBUTING.md  SECURITY.md  CODE_OF_CONDUCT.md
└─ package.json  tsconfig.json
```

## 8. Provider roadmap

| Order | Providers | Notes |
|---|---|---|
| 1 | **Telegram** | Full depth (4.6). |
| 2 | Slack, Discord | Webhooks; Slack Block Kit, Discord embeds. |
| 3 | Microsoft Teams, Google Chat, ntfy, Gotify, generic webhook, Mattermost, Matrix | Verify current Teams webhook approach (older connectors were retired). |
| 4 (optional) | Email (SMTP), Apprise fallback provider | Both add dependency weight; decide later. |

## 9. Implementation phases

Complete one phase, run its acceptance checks, then stop and report before the next phase.

**Phase 0 — Scaffold**
- Repo, TypeScript, lint, test, build, `action.yml`, CI, `check-dist`.
- *Accept:* CI is green on an empty-but-valid action.

**Phase 1 — Core engine (no network providers yet)**
- Config parsing and validation (simple + `targets`), context variables, message model, templates with per-target escaping, presets, engine (fan-out, concurrency, retry/backoff), results, masking, dry-run, job summary.
- A fake provider for tests.
- *Accept:* dry-run renders correct output for every preset; engine tests prove independence of targets, retry rules, and `fail-on` behavior; secrets never appear in logs.

**Phase 2 — Telegram provider**
- All options in 4.6 except attachments: HTML/MarkdownV2 escaping, topics, silent, reply, link buttons, splitting, edit-in-place, error mapping.
- *Accept:* unit and golden tests pass; a live e2e run against a test bot succeeds for single and multi-target configs.

**Phase 3 — Hardening and v1.0.0**
- Docs, recipes, SECURITY.md, CONTRIBUTING.md, changelog, branding, release workflow, Marketplace publish.
- *Accept:* a new user can follow the README to a working notification in under 5 minutes; `v1.0.0` and `v1` tags published.

**Phase 4 — Slack and Discord providers** (then the rest of the roadmap, one provider at a time)
- Each provider ships with validation, render, send, tests, and docs.

**Phase 5 — Extras**
- Telegram attachments (photo/document), optional email, optional Apprise fallback.

## 10. Working agreement for the coding agent

- Follow the layers in 4.7. `main.ts` only wires layers together.
- Keep `render` pure and `send` network-only in every provider.
- Do not add a dependency without a one-line justification. Prefer Node built-ins.
- Write tests alongside each module; render and escaping logic needs golden tests.
- Verify against current official docs before implementing anything that may have changed: GitHub Actions runtime and metadata syntax, Telegram Bot API limits and rate limits, Marketplace publishing rules.
- Work in small commits. Do not implement features from a later phase early.
- Ask before deviating from this spec. If something here is ambiguous or wrong, stop and raise it.

## 11. Open decisions (assumptions made — confirm or change)

1. **Native providers instead of wrapping Apprise.** Chosen for control, speed, and no Python dependency. Apprise may return later as an optional fallback.
2. **TypeScript** as the implementation language.
3. **MIT** license.
4. **`fail-on` default = `any`** (visible misconfiguration; users can add `continue-on-error`).
5. **YAML for `targets`** (JSON accepted as valid YAML).
6. **Name availability:** a quick search found no Marketplace action named "Notify Fanout", but uniqueness is only confirmed at publish time. Also confirm the repo owner/org.

## 12. Ideas parked for later (not committed)

- Per-target `when` filter (e.g. failures to an ops chat, successes to a team chat).
- Run duration and changed-files summary in presets (needs extra API calls).
- A reusable-workflow wrapper for common setups.
