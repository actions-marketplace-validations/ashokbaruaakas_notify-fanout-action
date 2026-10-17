# Telegram

Sends messages with the [Telegram Bot API](https://core.telegram.org/bots/api), using `sendMessage`, or `editMessageText` for edits.

## Setup

1. Message [@BotFather](https://t.me/BotFather), send `/newbot`, and copy the token.
2. Add the bot to the chat:
   - **Group or supergroup:** add it as a member. To post in a forum topic, the bot needs permission to post there.
   - **Channel:** add it as an administrator with permission to post messages.
   - **Private chat:** open the bot and press **Start**. A bot can't message a user first.
3. Store the token as a secret, such as `TELEGRAM_BOT_TOKEN`.

### Finding the chat ID

Send a message in the chat (in a group, mention the bot, like `@your_bot hi`), then open:

```
https://api.telegram.org/bot<TOKEN>/getUpdates
```

and copy `result[].message.chat.id`.

- Groups and channels have negative IDs, such as `-1001234567890`.
- Public channels can also use `@channelname`.
- If `getUpdates` is empty, send another message and reload. Telegram keeps updates for at most 24 hours, and `getUpdates` doesn't work while the bot has a webhook set.

For a **forum topic**, the topic ID is the number at the end of a message link in that topic: `https://t.me/c/1234567890/5/100` is topic `5`. To post in the General topic, leave `topic_id` unset.

## Options

Use these keys in a `targets` entry with `provider: telegram`. Simple mode (`telegram-bot-token`, `telegram-chat-id`) sets only `token` and `chat_id`.

| Option                 | Default  | Description                                                                                                  |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `token`                | required | Bot token. Masked everywhere.                                                                                |
| `chat_id`              | required | Numeric chat ID (quote it in YAML) or `@channelname`.                                                        |
| `topic_id`             |          | Forum topic ID (`message_thread_id`).                                                                        |
| `parse_mode`           | `html`   | `html`, `markdownv2` or `none`. Escaping is handled for you.                                                 |
| `silent`               | `false`  | Deliver without a notification sound.                                                                        |
| `disable_link_preview` | `false`  | Don't show link previews.                                                                                    |
| `reply_to_message_id`  |          | Reply to this message. The message is still sent if the original is gone.                                    |
| `edit_message_id`      |          | Edit this message instead of sending a new one. A blank value counts as unset.                               |
| `split`                | `true`   | Split messages over 4096 characters into several messages. With `false`, long text is cut and ends with "…". |

Numeric options also accept strings, so values from step outputs work directly.

## How messages look

```
<b>✅ CI succeeded on main</b>        ← title, bold

body (message / template)

<b>Repository:</b> octo/app          ← fields, one per line
<b>Commit:</b> 0123456 Fix login retry logic

[ View run ] [ View pull request ]   ← links as buttons, two per row
```

- **Links** become inline buttons on the last message. A URL that isn't `http(s)://` or `tg://` can't be a button (Telegram rejects it), so it's listed as text after the fields.
- **Fields** are shown one per line. Telegram has no columns, so `short` has no effect.

## Formatting

Every body format works in every parse mode:

|                    | `parse_mode: html`             | `parse_mode: markdownv2`    | `parse_mode: none`                         |
| ------------------ | ------------------------------ | --------------------------- | ------------------------------------------ |
| `format: text`     | escaped plain text             | escaped plain text          | plain text                                 |
| `format: markdown` | converted to HTML              | converted to MarkdownV2     | markup removed; links become `label (url)` |
| `format: raw`      | your Telegram HTML, sent as-is | your MarkdownV2, sent as-is | sent as-is                                 |

Use `format: raw` for features beyond the markdown subset, such as `<u>underline</u>`, `<tg-spoiler>spoilers</tg-spoiler>` or `<blockquote>`. In raw mode, variable values are still escaped for the parse mode. For example:

```yaml
format: raw
message: '<blockquote>{{COMMIT_MESSAGE}}</blockquote>'
```

Telegram doesn't allow code inside other formatting, so ``**bold `code`**`` renders the code span without the bold.

## Long messages

Telegram allows 4096 characters per message, counted after formatting is parsed. Longer messages are split:

- at a blank line if possible, otherwise at a line break, otherwise at a space;
- without ever breaking formatting: tags open at a cut are closed and reopened in the next message;
- with the reply (`reply_to_message_id`) on the first message and the buttons on the last;
- `message_id` in the results is the first message's ID.

If a later part fails and is retried, the parts already delivered are not sent again.

Raw HTML bodies are split safely as well. Raw MarkdownV2 bodies can't be parsed, so they are split as plain text, and a cut inside an entity can make Telegram reject the message. Keep raw MarkdownV2 messages short, or use `format: markdown`.

## Editing a message in place

Edits are stateless. One step sends a message, and a later step edits it by ID:

```yaml
- id: started
  uses: ashokbaruaakas/notify-fanout-action@v1
  with:
    status: started
    telegram-bot-token: ${{ secrets.TELEGRAM_BOT_TOKEN }}
    telegram-chat-id: ${{ secrets.TELEGRAM_CHAT_ID }}

# ... job steps ...

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

- An edit replaces the text and buttons. It can't split, so long text is cut with "…".
- Editing to identical content counts as success.
- To edit across jobs, pass the ID through a job output (`jobs.<id>.outputs`).

## Errors

Errors are reported with Telegram's description plus a hint:

| Telegram says                            | Hint                                                         | Retried |
| ---------------------------------------- | ------------------------------------------------------------ | ------- |
| `Unauthorized` (401)                     | the bot token is invalid or was revoked                      | no      |
| `chat not found`                         | check `chat_id`, and that the bot has been added to the chat | no      |
| `bot was kicked` / `bot is not a member` | add the bot to the chat again                                | no      |
| `bot was blocked by the user`            | the user blocked the bot                                     | no      |
| `not enough rights`                      | give the bot permission to post                              | no      |
| `message thread not found`               | check `topic_id` and that topics are enabled                 | no      |
| `can't parse entities`                   | the formatting is invalid; check raw bodies                  | no      |
| `message to edit not found`              | check `edit_message_id`                                      | no      |
| group upgraded to a supergroup           | the new `chat_id` to use                                     | no      |
| `Too Many Requests` (429)                | waits `retry_after` (up to 60s)                              | yes     |
| 5xx, network errors, timeouts            |                                                              | yes     |

## Rate limits

Telegram allows about one message per second per chat, 20 per minute in a group, and about 30 per second overall. Normal CI notifications stay far below this. If you hit a limit, the action waits as long as Telegram asks and retries.
