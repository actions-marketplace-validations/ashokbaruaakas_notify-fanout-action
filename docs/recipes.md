# Recipes

All examples assume the `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` secrets. See the [quick start](../README.md#quick-start-5-minutes).

- [Notify only on failure](#notify-only-on-failure)
- [Successes and failures to different chats](#successes-and-failures-to-different-chats)
- [Started → finished in one message](#started--finished-in-one-message)
- [Deployment notices](#deployment-notices)
- [Release announcements](#release-announcements)
- [Pull request notices](#pull-request-notices)
- [Pull requests from forks](#pull-requests-from-forks)
- [Notify after all jobs finish](#notify-after-all-jobs-finish)
- [A custom message with a template file](#a-custom-message-with-a-template-file)
- [Post to a forum topic](#post-to-a-forum-topic)
- [Try it without sending](#try-it-without-sending)

## Notify only on failure

```yaml
- uses: ashokbaruaakas/notify-fanout-action@v1
  if: failure()
  with:
    status: failure
    telegram-bot-token: ${{ secrets.TELEGRAM_BOT_TOKEN }}
    telegram-chat-id: ${{ secrets.TELEGRAM_CHAT_ID }}
```

## Successes and failures to different chats

Use two steps with different conditions:

```yaml
- uses: ashokbaruaakas/notify-fanout-action@v1
  if: success()
  with:
    status: success
    targets: |
      - id: team
        provider: telegram
        token: ${{ secrets.TELEGRAM_BOT_TOKEN }}
        chat_id: ${{ secrets.TEAM_CHAT_ID }}
        silent: true

- uses: ashokbaruaakas/notify-fanout-action@v1
  if: failure()
  with:
    status: failure
    targets: |
      - id: team
        provider: telegram
        token: ${{ secrets.TELEGRAM_BOT_TOKEN }}
        chat_id: ${{ secrets.TEAM_CHAT_ID }}
      - id: on-call
        provider: telegram
        token: ${{ secrets.TELEGRAM_BOT_TOKEN }}
        chat_id: ${{ secrets.ONCALL_CHAT_ID }}
        message: "Main is broken. Please take a look."
```

## Started → finished in one message

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - id: notify-start
        uses: ashokbaruaakas/notify-fanout-action@v1
        with:
          status: started
          telegram-bot-token: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          telegram-chat-id: ${{ secrets.TELEGRAM_CHAT_ID }}

      - uses: actions/checkout@v5
      - run: npm ci && npm test

      - uses: ashokbaruaakas/notify-fanout-action@v1
        if: always()
        with:
          status: ${{ job.status }}
          targets: |
            - provider: telegram
              token: ${{ secrets.TELEGRAM_BOT_TOKEN }}
              chat_id: ${{ secrets.TELEGRAM_CHAT_ID }}
              edit_message_id: ${{ fromJSON(steps.notify-start.outputs.results)[0].message_id }}
```

If the first step couldn't send, `message_id` is empty, and the second step sends a new message instead of editing.

## Deployment notices

```yaml
deploy:
  runs-on: ubuntu-latest
  environment: production
  steps:
    # ... deploy steps ...
    - uses: ashokbaruaakas/notify-fanout-action@v1
      if: always()
      with:
        status: ${{ job.status }}
        preset: deployment
        fields: |
          - name: Environment
            value: production
          - name: Version
            value: ${{ github.sha }}
        links: |
          - label: Open app
            url: https://app.example.com
          - label: View run
            url: "{{RUN_URL}}"
        telegram-bot-token: ${{ secrets.TELEGRAM_BOT_TOKEN }}
        telegram-chat-id: ${{ secrets.TELEGRAM_CHAT_ID }}
```

`fields` and `links` replace the preset's own, so the example keeps the run link explicitly. With `deployment_status` events, `{{ENVIRONMENT}}` is filled in for you.

## Release announcements

```yaml
on:
  release:
    types: [published]

jobs:
  announce:
    runs-on: ubuntu-latest
    steps:
      - uses: ashokbaruaakas/notify-fanout-action@v1
        with:
          status: success # "✅ Release v1.2.0 published"
          format: markdown
          message: 'A new version of **{{REPOSITORY}}** is out.'
          targets: |
            - provider: telegram
              token: ${{ secrets.TELEGRAM_BOT_TOKEN }}
              chat_id: "@my_channel"
```

## Pull request notices

```yaml
on: pull_request

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - run: npm ci && npm test
      - uses: ashokbaruaakas/notify-fanout-action@v1
        if: always() && github.event.pull_request.head.repo.fork == false
        with:
          status: ${{ job.status }} # "❌ CI failed · PR #7" with the PR title and buttons
          telegram-bot-token: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          telegram-chat-id: ${{ secrets.TELEGRAM_CHAT_ID }}
```

## Pull requests from forks

Workflows triggered by `pull_request` from a fork don't receive repository secrets, so a notification step would fail with "No targets configured". Skip it for forks, as in the example above, with `github.event.pull_request.head.repo.fork == false`.

Don't switch to `pull_request_target` to get secrets for fork PRs. That event runs with your secrets, and checking out or building the fork's code exposes them to whoever opened the PR. The action escapes PR titles and other event values in messages, but it can't protect secrets from untrusted code in the same job.

## Notify after all jobs finish

```yaml
jobs:
  test: { ... }
  build: { ... }

  notify:
    needs: [test, build]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - uses: ashokbaruaakas/notify-fanout-action@v1
        with:
          # success only if every needed job succeeded
          status: ${{ contains(needs.*.result, 'failure') && 'failure' || contains(needs.*.result, 'cancelled') && 'cancelled' || 'success' }}
          telegram-bot-token: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          telegram-chat-id: ${{ secrets.TELEGRAM_CHAT_ID }}
```

## A custom message with a template file

`.github/notify.md`:

```markdown
**{{REPOSITORY}}** · `{{BRANCH}}`

{{MESSAGE}}

[Commit {{COMMIT_SHORT}}]({{SERVER_URL}}/{{REPOSITORY}}/commit/{{COMMIT}}) by {{AUTHOR}}
```

The workflow, which needs `actions/checkout` so the file exists:

```yaml
- uses: ashokbaruaakas/notify-fanout-action@v1
  if: always()
  with:
    status: ${{ job.status }}
    format: markdown
    template-file: .github/notify.md
    message: 'Nightly build {{STATUS}}.'
    telegram-bot-token: ${{ secrets.TELEGRAM_BOT_TOKEN }}
    telegram-chat-id: ${{ secrets.TELEGRAM_CHAT_ID }}
```

## Post to a forum topic

```yaml
targets: |
  - provider: telegram
    token: ${{ secrets.TELEGRAM_BOT_TOKEN }}
    chat_id: "-1001234567890"
    topic_id: 5
```

## Try it without sending

```yaml
- uses: ashokbaruaakas/notify-fanout-action@v1
  with:
    dry-run: true
    status: failure
    telegram-bot-token: ${{ secrets.TELEGRAM_BOT_TOKEN }}
    telegram-chat-id: ${{ secrets.TELEGRAM_CHAT_ID }}
```

The log shows the exact request each target would send, with secrets masked.
