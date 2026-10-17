# Presets

A preset supplies the title, fields and links. Override any part with the `title`, `message`, `fields` and `links` inputs; the rest still comes from the preset. Preset bodies are empty, so `message` adds a body without losing anything.

## Choosing a preset

`preset: auto` (the default) picks by event:

| Event                                                                                       | Preset         |
| ------------------------------------------------------------------------------------------- | -------------- |
| `push`                                                                                      | `push`         |
| `pull_request`, `pull_request_target`, `pull_request_review`, `pull_request_review_comment` | `pull_request` |
| `issues`, `issue_comment`                                                                   | `issue`        |
| `release`                                                                                   | `release`      |
| `deployment`, `deployment_status`                                                           | `deployment`   |
| anything else (`workflow_dispatch`, `schedule`, `workflow_run`, …)                          | `workflow`     |

`custom` means no preset: the message is only what you configure.

## Status wording

Titles include the status:

| Status      | Wording                | Emoji |
| ----------- | ---------------------- | ----- |
| `success`   | succeeded              | ✅    |
| `failure`   | failed                 | ❌    |
| `cancelled` | was cancelled          | ⚪    |
| `warning`   | finished with warnings | ⚠️    |
| `started`   | started                | ⏳    |
| `info`      | _(none)_               | ℹ️    |
| custom text | the text as given      | ℹ️    |

## Presets

Fields whose value is empty for the current event are left out. Links show as buttons in Telegram.

### `workflow`

- **Title:** `{{EMOJI}} {{WORKFLOW}} <status>`, for example `✅ CI succeeded`
- **Fields:** Repository, Branch, Commit (`{{COMMIT_SHORT}} {{COMMIT_MESSAGE}}`), Triggered by, Run (number)
- **Links:** View run

### `push`

- **Title:** `{{EMOJI}} {{WORKFLOW}} <status> on {{BRANCH}}`, for example `✅ CI succeeded on main`
- **Fields:** Repository, Commit, Pushed by
- **Links:** View run

### `pull_request`

- **Title:** `{{EMOJI}} {{WORKFLOW}} <status> · PR #{{PR_NUMBER}}`, for example `❌ CI failed · PR #7`
- **Fields:** Pull request (title), Repository, Branch (head), Triggered by, Commit
- **Links:** View pull request, View run

### `issue`

- **Title:** `{{EMOJI}} Issue #{{ISSUE_NUMBER}}: {{ISSUE_TITLE}}`
- **Fields:** Repository, Event, Triggered by
- **Links:** View issue

### `release`

- **Title:** `{{EMOJI}} Release {{TAG}} <status>`. Success reads "published", for example `✅ Release v1.2.0 published`.
- **Fields:** Repository, Triggered by
- **Links:** View release, View run

### `deployment`

- **Title:** `{{EMOJI}} Deployment <status>`, for example `✅ Deployment succeeded`
- **Fields:** Environment, Repository, Branch, Commit, Triggered by
- **Links:** View run

### `custom`

Empty. Set at least a `title` or `message`.

## Example output

The `push` preset with `status: success`, rendered for Telegram:

```
✅ CI succeeded on main

Repository: octo/app
Commit: 0123456 Fix login retry logic
Pushed by: octocat

[ View run ]
```
