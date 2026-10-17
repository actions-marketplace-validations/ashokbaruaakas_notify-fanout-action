# Contributing

Thanks for helping! Bug reports, docs fixes and new providers are all welcome.

## Before you start

- **Bugs:** open an issue with your workflow step (secrets removed), the log output, and what you expected.
- **Features and new providers:** open an issue first, so we can agree on the design before you write code.
- **Security issues:** don't open an issue. See [SECURITY.md](SECURITY.md).

## Development

You need Node.js 24 (see `.nvmrc`).

```sh
npm ci
npm run all        # format check, lint, typecheck, tests, build
npm test           # tests only
npx vitest run src/providers/telegram   # one folder or file
npx vitest run -t "splits long"         # tests matching a name
npm run format     # fix formatting
```

### `dist/` is committed

The action runs `dist/index.js`, so **run `npm run build` and commit `dist/`** with every source change. CI fails if `dist/` is out of date.

### Golden files

Rendering and escaping are covered by golden files in `test/golden/`. After an intended rendering change, run `npx vitest run -u` and check the diff carefully: it is exactly what users will see.

## How the code is organized

| Folder           | Responsibility                                                |
| ---------------- | ------------------------------------------------------------- |
| `src/config/`    | Read and validate inputs and targets.                         |
| `src/context/`   | Turn the GitHub context into template variables.              |
| `src/message/`   | Message model, presets, templates, markdown subset, escaping. |
| `src/providers/` | One folder per platform, plus the registry and HTTP helper.   |
| `src/engine/`    | Fan-out, concurrency, retries, failure policy.                |
| `src/report/`    | Outputs, job summary, logging, redaction.                     |

`src/main.ts` only wires these together. Everything with side effects is injected, so tests run without network access or a GitHub runner.

## Adding a provider

1. Create `src/providers/<name>/` implementing `Provider` from `src/providers/types.ts`:
   - `validate(raw)`: read options with `ObjectReader` and call `assertNoUnknownKeys()`. Errors must not echo secret values.
   - `secrets(config)`: every value to mask.
   - `escapeRaw(value, config)`: escaping for the native format (`format: raw`).
   - `render(message, config)`: **pure**, with no network. Returns the exact request(s) to send, which is also what dry runs print.
   - `send(rendered, config, context)`: **network only**. Use `httpRequest` and `httpStatusError` from `src/providers/http.ts`. Throw `DeliveryError` with `retryable` set correctly. Use `context.state` if a send takes several requests.
2. Register it in `src/providers/index.ts`.
3. Add tests: option validation, golden render tests for every format, and send tests with a mocked `fetch`.
4. Add `docs/providers/<name>.md` and update the README.

## Pull requests

- Keep changes focused, and add tests with them.
- Don't add a dependency without a short justification in the PR. Node built-ins are preferred.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:` …).
- Add a line under `## [Unreleased]` in `CHANGELOG.md` for user-facing changes.

## Releasing (maintainers)

1. Move the `Unreleased` entries into a new version section in `CHANGELOG.md`, and set `version` in `package.json` to match.
2. Commit, then tag and push: `git tag v1.2.3 && git push origin v1.2.3`.
3. The release workflow checks the tag matches `package.json` and `dist/` is up to date, creates the GitHub release from the changelog, and moves the major tag (`v1`).

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE) and that you'll follow the [code of conduct](CODE_OF_CONDUCT.md).
