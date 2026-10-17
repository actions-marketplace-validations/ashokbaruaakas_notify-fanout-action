# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-10-17

First stable release.

### Added

- Telegram provider: HTML, MarkdownV2 and plain parse modes; forum topics; silent messages; link previews off; replies; links as inline buttons; automatic splitting of long messages without breaking formatting; editing messages in place; clear error messages with hints.
- Simple mode (`telegram-bot-token`, `telegram-chat-id`) and multi-target mode (`targets`), with per-target title, message, template file and format.
- Presets for workflows, pushes, pull requests, issues, releases and deployments, chosen automatically from the event and worded for the job status.
- Templates with `{{VARIABLES}}` from the GitHub context, inline or from a file. Variable values are escaped for the target's format.
- A neutral markdown subset (`format: markdown`) converted to each provider's format, plus `format: raw` for native markup.
- Independent, concurrent delivery with retries, exponential backoff, rate-limit handling and a `fail-on` policy.
- `results`, `success-count` and `failure-count` outputs, a job summary, `dry-run` and `debug`.
- Secret masking and redaction in all logs, outputs and summaries.

[Unreleased]: https://github.com/ashokbaruaakas/notify-fanout-action/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/ashokbaruaakas/notify-fanout-action/releases/tag/v1.0.0
