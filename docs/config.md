# Configuration reference

- [Inputs](#inputs)
- [Targets](#targets)
- [Message content](#message-content)
- [Variables](#variables)
- [Formats and escaping](#formats-and-escaping)
- [Delivery and failure behavior](#delivery-and-failure-behavior)
- [Outputs](#outputs)
- [Limits](#limits)

## Inputs

Inputs use kebab-case. Empty inputs count as unset. Enum and boolean values are case-insensitive.

| Input                | Default | Description                                                                                                                                                                                       |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`             | `info`  | Message status. Usually `${{ job.status }}` (`success`, `failure`, `cancelled`). Also `warning`, `info`, `started`. Any other text is shown as given, with the ℹ️ style and a warning in the log. |
| `preset`             | `auto`  | Content preset. See [presets](presets.md).                                                                                                                                                        |
| `title`              | preset  | Title template. Always plain text.                                                                                                                                                                |
| `message`            | preset  | Body template, in `format`.                                                                                                                                                                       |
| `fields`             | preset  | YAML/JSON list of `{ name, value, short? }`. Replaces the preset's fields. Values support variables.                                                                                              |
| `links`              | preset  | YAML/JSON list of `{ label, url }`. Replaces the preset's links. Both support variables.                                                                                                          |
| `template-file`      |         | Body template file, relative to the repository root (`GITHUB_WORKSPACE`). It must be inside the repository.                                                                                       |
| `format`             | `text`  | Body format: `text`, `markdown` or `raw`. See [formats](#formats-and-escaping).                                                                                                                   |
| `targets`            |         | YAML/JSON list of targets. See [targets](#targets).                                                                                                                                               |
| `telegram-bot-token` |         | Simple mode: creates one Telegram target. Must be set together with `telegram-chat-id`.                                                                                                           |
| `telegram-chat-id`   |         | Simple mode: chat ID or `@channel` username.                                                                                                                                                      |
| `fail-on`            | `any`   | `any`, `all` or `none`. See [failure behavior](#delivery-and-failure-behavior).                                                                                                                   |
| `retries`            | `3`     | Retries after the first attempt, for retryable errors only (0–10).                                                                                                                                |
| `timeout-seconds`    | `15`    | Timeout for each attempt (1–300).                                                                                                                                                                 |
| `concurrency`        | `5`     | Maximum number of targets sent at once (1–50).                                                                                                                                                    |
| `dry-run`            | `false` | Render every target and print the exact request (secrets masked) without sending.                                                                                                                 |
| `debug`              | `false` | Print debug lines (preset choice, retries, message chunks) as normal log lines. Secrets stay masked.                                                                                              |

## Targets

`targets` is a YAML list (JSON also works, since JSON is valid YAML). Keys inside a target use snake_case.

```yaml
targets: |
  - id: team            # optional; used in results and logs
    provider: telegram  # required
    title: "..."        # optional overrides of the global content settings
    message: "..."
    template_file: .github/notify-team.md
    format: markdown
    # provider options (see the provider docs)
    token: ${{ secrets.TELEGRAM_BOT_TOKEN }}
    chat_id: "-1001234567890"
```

| Key                                           | Description                                                                                                                                                             |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                          | Optional. Letters, digits, `.`, `_` and `-`, up to 64 characters, unique. If omitted, IDs are generated as `<provider>-1`, `<provider>-2`, … skipping IDs already used. |
| `provider`                                    | Required. Available: `telegram`.                                                                                                                                        |
| `title`, `message`, `template_file`, `format` | Override the matching global input for this target.                                                                                                                     |
| anything else                                 | Provider options. Unknown keys are rejected, which catches typos.                                                                                                       |

If you set both the simple-mode inputs and `targets`, the simple-mode target comes first (ID `telegram-1` unless that ID is taken).

Configuration errors fail the step before anything is sent. They name the setting (for example `targets[1] (ops): chat_id is required`) but never print its value.

Provider options: [Telegram](providers/telegram.md#options).

## Message content

Each target gets a provider-neutral message:

| Part   | Source                                                                                                   |
| ------ | -------------------------------------------------------------------------------------------------------- |
| Title  | target `title` → `title` input → preset                                                                  |
| Body   | target `template_file` or `message` → `template-file` or `message` input → preset                        |
| Fields | `fields` input → preset. Fields whose value renders empty are dropped.                                   |
| Links  | `links` input → preset. Links whose URL renders empty are dropped; an empty label falls back to the URL. |

The most specific source wins. A target's `message` therefore replaces a global `template-file`.

Inside a template, `{{MESSAGE}}` is the resolved message (from the `message` inputs or the preset) and `{{TITLE}}` is the resolved title. This lets a template file wrap the message:

```markdown
{{TITLE}}

{{MESSAGE}}

_Commit {{COMMIT_SHORT}} by {{AUTHOR}}_
```

Titles are collapsed to a single line. Bodies are trimmed.

## Variables

Templates use `{{NAME}}`; spaces inside the braces are allowed. Every variable below is always defined. Values that don't apply to the current event are empty. Unknown variables render as empty and log one warning each.

| Variable                                   | Value                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `TITLE`                                    | The resolved title (inside the body).                                                       |
| `MESSAGE`                                  | The resolved message (inside a template).                                                   |
| `STATUS`                                   | The status: `success`, `failure`, …, or the custom text.                                    |
| `EMOJI`                                    | ✅ success, ❌ failure, ⚪ cancelled, ⚠️ warning, ℹ️ info (and custom statuses), ⏳ started |
| `REPOSITORY`                               | `owner/repo`                                                                                |
| `BRANCH`                                   | The branch. For pull requests, the head branch. Empty for tags.                             |
| `WORKFLOW`                                 | Workflow name.                                                                              |
| `JOB`                                      | Job ID.                                                                                     |
| `EVENT`                                    | Event name, such as `push`.                                                                 |
| `COMMIT`                                   | Full SHA. For pull requests, the head commit (not the merge commit).                        |
| `COMMIT_SHORT`                             | First 7 characters of `COMMIT`.                                                             |
| `COMMIT_MESSAGE`                           | First line of the head commit message (push events).                                        |
| `AUTHOR`                                   | The user who triggered the run (`github.actor`).                                            |
| `RUN_URL`                                  | Link to the workflow run.                                                                   |
| `RUN_NUMBER`                               | Run number.                                                                                 |
| `SERVER_URL`                               | `https://github.com`, or your GitHub Enterprise URL.                                        |
| `ENVIRONMENT`                              | Deployment environment (`deployment`, `deployment_status` events).                          |
| `PR_NUMBER`, `PR_TITLE`, `PR_URL`          | Pull request events.                                                                        |
| `ISSUE_NUMBER`, `ISSUE_TITLE`, `ISSUE_URL` | Issue and issue comment events.                                                             |
| `TAG`                                      | Release tag, or the tag name for tag pushes.                                                |
| `RELEASE_URL`                              | Release events.                                                                             |

To use other values, put a GitHub expression in the input directly. It is substituted before the action runs, so its value is **not** escaped. Prefer variables for anything user-controlled, such as titles and messages from the event.

## Formats and escaping

The title, fields and links are always plain text. The provider escapes them when rendering.

The body is written in `format`:

| Format     | Body                                                                                                             | Variable values are…                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `text`     | Plain text.                                                                                                      | Inserted as-is. The provider escapes the whole body.            |
| `markdown` | The neutral markdown subset below, converted to each provider's format.                                          | Escaped for markdown, so `*` or `_` in a PR title stay literal. |
| `raw`      | The provider's native markup, sent untouched. For Telegram, that's HTML or MarkdownV2 depending on `parse_mode`. | Escaped for the native format.                                  |

Template text is never escaped: that's where your markup goes. Values inserted with variables are always escaped. `{{MESSAGE}}` inside a template is not escaped, because it is already in the body's format.

### Markdown subset

| Syntax                                   | Result                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| `**bold**`                               | **bold**                                                                 |
| `*italic*` or `_italic_`                 | _italic_ (`_` inside words, as in `snake_case`, is not emphasis)         |
| `` `code` ``                             | `code`                                                                   |
| ` ```lang ` … ` ``` ` on their own lines | code block                                                               |
| `[label](url)`                           | link. Balanced parentheses are allowed in the URL.                       |
| `\` before any ASCII punctuation         | that character, literally. This works everywhere, including inside code. |

Unmatched markers are shown as typed.

## Delivery and failure behavior

- Targets are rendered first, then sent concurrently (up to `concurrency` at a time). Each target is independent: a failure never cancels or delays the others.
- If one target can't be rendered (for example, its template file is missing), only that target fails, with 0 attempts.
- **Retries** happen only for network errors, timeouts, HTTP 429 and 5xx. Other errors, such as a bad token, an unknown chat or invalid formatting, are reported immediately.
- **Backoff** is exponential with jitter: about 1s, 2s, 4s… (50–100% of each step, capped at 30s). When the server asks for a specific wait (Telegram `retry_after` or the `Retry-After` header), that wait is used. If it is over 60 seconds, the target fails instead of stalling the job.
- `retries: 3` means up to 4 attempts.
- **`fail-on`**: `any` fails the step if any target failed. `all` fails it only if every target failed (and otherwise warns). `none` never fails it and only warns. To ignore notification failures completely, you can also use `continue-on-error: true` on the step.

## Outputs

`results` is a JSON array with one entry per target, in configuration order:

```json
[
  { "id": "team", "provider": "telegram", "ok": true, "attempts": 1, "message_id": "128" },
  {
    "id": "ops",
    "provider": "telegram",
    "ok": false,
    "attempts": 1,
    "error": "Telegram Bad Request: chat not found (check chat_id, and that the bot has been added to the chat)"
  }
]
```

`message_id` is present when the provider returns one. In dry runs every entry has `"attempts": 0`. Read entries with `fromJSON(steps.<id>.outputs.results)`.

`success-count` and `failure-count` are numbers as strings.

## Limits

| What                             | Limit          |
| -------------------------------- | -------------- |
| Targets                          | 50             |
| Any input, and any template file | 64 KiB of text |
| `fields`                         | 25             |
| `links`                          | 10             |
| `retries`                        | 0–10           |
| `timeout-seconds`                | 1–300          |
| `concurrency`                    | 1–50           |
| Server-requested retry wait      | 60 s           |
