# Notify Fanout

[![CI](https://github.com/ashokbaruaakas/notify-fanout-action/actions/workflows/ci.yml/badge.svg)](https://github.com/ashokbaruaakas/notify-fanout-action/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/ashokbaruaakas/notify-fanout-action)](https://github.com/ashokbaruaakas/notify-fanout-action/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Send CI/CD notifications to one or many Telegram chats from a single workflow step. Each target has its own settings.

- **One step, many targets.** Several chats, each with its own topic, format and message.
- **Useful messages without configuration.** Presets for workflows, pushes, pull requests, issues, releases and deployments, worded for the job status.
- **Customize anything.** Override the title, message, fields or links, inline or with a template file, globally or per target.
- **Safe formatting.** PR titles and commit messages are escaped, so they can't break the markup.
- **Reliable delivery.** Targets are sent independently, with retries, rate-limit handling and a configurable failure policy.
- **Telegram in depth.** Forum topics, silent messages, link buttons, automatic splitting of long messages, and editing a message in place.
- **Secure by default.** Tokens are masked everywhere. No backend, no telemetry.

Telegram is the first provider. The design makes adding other platforms cheap, and they are planned.

## Quick start (5 minutes)

**1. Create a bot.** In Telegram, message [@BotFather](https://t.me/BotFather) and send `/newbot`. Copy the token it gives you, which looks like `123456789:AAE...`.

**2. Get the chat ID.** Add the bot to your group or channel (for a channel, make it an admin) and send any message there. Then open this URL in your browser:

```
https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
```

Copy the `chat.id` value. Group IDs look like `-1001234567890`. For a public channel you can also use `@channelname`. [More ways to find the chat ID](docs/providers/telegram.md#finding-the-chat-id).

**3. Add two repository secrets** (Settings → Secrets and variables → Actions): `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.

**4. Add the step** at the end of a job:

```yaml
- uses: ashokbaruaakas/notify-fanout-action@v1
  if: always() # notify on failure and cancellation too
  with:
    status: ${{ job.status }}
    telegram-bot-token: ${{ secrets.TELEGRAM_BOT_TOKEN }}
    telegram-chat-id: ${{ secrets.TELEGRAM_CHAT_ID }}
```

On the next run you'll get a message like this, with a **View run** button:

```
✅ CI succeeded on main

Repository: octo/app
Commit: 1a2b3c4 Fix login retry logic
Pushed by: octocat
```

## Multiple targets

Use `targets` (YAML or JSON) to send to several chats with different settings. Each target can override the global `title`, `message`, `template-file` and `format`.

```yaml
- uses: ashokbaruaakas/notify-fanout-action@v1
  if: always()
  with:
    status: ${{ job.status }}
    targets: |
      - id: team
        provider: telegram
        token: ${{ secrets.TELEGRAM_BOT_TOKEN }}
        chat_id: "-1001234567890"
        topic_id: 5
        silent: true
      - id: ops
        provider: telegram
        token: ${{ secrets.TELEGRAM_BOT_TOKEN }}
        chat_id: "-1009876543210"
        message: "Build {{STATUS}} on {{BRANCH}}: {{RUN_URL}}"
```

Quote numeric chat IDs. A failure in one target never stops the others.

## Customizing the message

The preset (`auto` by default, picked from the triggering event) provides a title, fields and links. You can override each part:

```yaml
with:
  status: ${{ job.status }}
  title: '{{EMOJI}} Deploy of {{REPOSITORY}} {{STATUS}}'
  format: markdown
  message: |
    **{{COMMIT_SHORT}}** {{COMMIT_MESSAGE}}
    Triggered by _{{AUTHOR}}_
  fields: |
    - name: Environment
      value: production
  links: |
    - label: Open app
      url: https://app.example.com
```

- Variables use `{{NAME}}`: `REPOSITORY`, `BRANCH`, `COMMIT_SHORT`, `PR_TITLE`, `RUN_URL` and more. See the [full list](docs/config.md#variables).
- `format: markdown` supports `**bold**`, `*italic*`, `` `code` ``, code blocks and `[links](url)`, and converts them to Telegram's format. Variable values are escaped automatically.
- `template-file: .github/notify.md` loads the body from a file in your repository.

## Inputs

| Input                | Default | Description                                                                                                               |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| `status`             | `info`  | `${{ job.status }}`, or `success`, `failure`, `cancelled`, `warning`, `info`, `started`, or any custom text.              |
| `preset`             | `auto`  | `auto`, `workflow`, `deployment`, `release`, `pull_request`, `issue`, `push` or `custom`. See [presets](docs/presets.md). |
| `title`              | preset  | Overrides the title. Supports variables.                                                                                  |
| `message`            | preset  | Overrides the body. Supports variables.                                                                                   |
| `fields`             | preset  | YAML/JSON list of `{ name, value, short? }`. Replaces the preset fields.                                                  |
| `links`              | preset  | YAML/JSON list of `{ label, url }`, shown as buttons. Replaces the preset links.                                          |
| `template-file`      |         | Body template file, relative to the repository root.                                                                      |
| `format`             | `text`  | Body format: `text`, `markdown` or `raw` (the provider's native markup).                                                  |
| `targets`            |         | YAML/JSON list of targets (multi-target mode).                                                                            |
| `telegram-bot-token` |         | Simple mode: bot token.                                                                                                   |
| `telegram-chat-id`   |         | Simple mode: chat ID or `@channel`.                                                                                       |
| `fail-on`            | `any`   | Fail the step if `any` target fails, only if `all` fail, or `none` (only warn).                                           |
| `retries`            | `3`     | Retries for network errors, rate limits and 5xx responses (0–10).                                                         |
| `timeout-seconds`    | `15`    | Timeout for each request (1–300).                                                                                         |
| `concurrency`        | `5`     | Maximum parallel sends (1–50).                                                                                            |
| `dry-run`            | `false` | Render and print each message without sending anything.                                                                   |
| `debug`              | `false` | Verbose logs. Secrets stay masked.                                                                                        |

## Outputs

| Output          | Description                                                         |
| --------------- | ------------------------------------------------------------------- |
| `results`       | JSON array: `[{ id, provider, ok, attempts, message_id?, error? }]` |
| `success-count` | Number of targets delivered.                                        |
| `failure-count` | Number of targets that failed after retries.                        |

A job summary table lists every target and its result.

## Edit a message in place

Send a "started" message, then turn the same message into the result:

```yaml
- id: started
  uses: ashokbaruaakas/notify-fanout-action@v1
  with:
    status: started
    telegram-bot-token: ${{ secrets.TELEGRAM_BOT_TOKEN }}
    telegram-chat-id: ${{ secrets.TELEGRAM_CHAT_ID }}

# ... build steps ...

- uses: ashokbaruaakas/notify-fanout-action@v1
  if: always()
  with:
    status: ${{ job.status }}
    targets: |
      - provider: telegram
        token: ${{ secrets.TELEGRAM_BOT_TOKEN }}
        chat_id: ${{ secrets.TELEGRAM_CHAT_ID }}
        edit_message_id: ${{ fromJSON(steps.started.outputs.results)[0].message_id }}
```

## Documentation

- [Configuration reference](docs/config.md): inputs, targets, variables, formats, limits
- [Presets](docs/presets.md)
- [Telegram provider](docs/providers/telegram.md): options, formatting, splitting, errors
- [Recipes](docs/recipes.md): failure alerts, deploy notices, release announcements, PR notices and more

## Security

- Tokens are masked with `core.setSecret` and redacted from every log, output and job summary, including tokens inside request URLs and API error messages.
- Values from the event (PR titles, commit messages, branch names) are escaped for the message format.
- **Forks:** workflows triggered by `pull_request` from a fork don't get your secrets, so the step fails with a configuration error. Don't switch to `pull_request_target` just to get notifications: it runs with your secrets in the context of untrusted code. See [recipes](docs/recipes.md#pull-requests-from-forks).

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Each provider is self-contained, so adding a platform means adding one folder plus tests.

## License

[MIT](LICENSE)
