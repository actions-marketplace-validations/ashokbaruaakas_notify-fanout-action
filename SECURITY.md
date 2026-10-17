# Security policy

## Supported versions

| Version     | Supported |
| ----------- | --------- |
| 1.x (`@v1`) | ✅        |

Security fixes are released as patch versions, and the `v1` tag is moved to them.

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately through GitHub instead: go to the [Security tab](https://github.com/ashokbaruaakas/notify-fanout-action/security) and click **Report a vulnerability**.

Include what you found, how to reproduce it, and the impact you expect. You'll get a reply within 7 days. Once a fix is released, the advisory is published with credit to you, unless you'd rather stay anonymous.

## Scope

In scope:

- Secrets (bot tokens, URLs containing tokens) appearing in logs, outputs, job summaries or error messages.
- Event data (PR titles, commit messages, branch names) injecting markup or links into messages.
- Anything that makes the action send messages, or reach hosts, it wasn't configured for.

Out of scope: workflows that pass untrusted input through GitHub expressions (`${{ }}`) themselves, and `pull_request_target` workflows that run untrusted code with secrets. See the [fork guidance](docs/recipes.md#pull-requests-from-forks).
