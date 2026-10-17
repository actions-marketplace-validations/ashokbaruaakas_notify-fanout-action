import { readFile } from 'node:fs/promises';

import { readInputs } from './config/inputs.js';
import { parseTargets } from './config/targets.js';
import type { Target } from './config/targets.js';
import { TemplateFiles } from './config/template-files.js';
import { buildVariables, loadEventPayload } from './context/variables.js';
import type { Env } from './context/variables.js';
import { deliverAll } from './engine/deliver.js';
import type { DeliveryResult } from './engine/deliver.js';
import { shouldFail } from './engine/policy.js';
import { createCoreIO } from './io.js';
import type { ActionIO } from './io.js';
import { composeMessage } from './message/compose.js';
import type { GlobalContent } from './message/compose.js';
import { resolveStatus } from './message/model.js';
import { presetContent, resolvePreset } from './message/presets.js';
import { createDefaultRegistry } from './providers/index.js';
import type { ProviderRegistry, RenderedTarget } from './providers/registry.js';
import { Redactor } from './report/redact.js';
import { createLogger, renderSummary, writeOutputs } from './report/report.js';

export interface Dependencies {
  io: ActionIO;
  env: Env;
  registry: ProviderRegistry;
  readFile: (path: string) => Promise<string>;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  cwd: string;
}

export function createDefaultDependencies(): Dependencies {
  return {
    io: createCoreIO(),
    env: process.env,
    registry: createDefaultRegistry(),
    readFile: (path) => readFile(path, 'utf8'),
    fetch: globalThis.fetch,
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    random: Math.random,
    cwd: process.cwd(),
  };
}

type Prepared = { target: Target; rendered: RenderedTarget } | { target: Target; error: string };

export async function run(deps: Dependencies = createDefaultDependencies()): Promise<void> {
  const { io, env } = deps;
  const redactor = new Redactor();
  const mask = (secrets: readonly string[]): void => {
    for (const secret of secrets) if (secret !== '') io.setSecret(secret);
    redactor.add(secrets);
  };

  try {
    // Mask the simple-mode token before anything (including validation) can log it.
    mask([io.getInput('telegram-bot-token').trim()]);
    const inputs = readInputs((name) => io.getInput(name));
    const log = createLogger(io, redactor, inputs.debug);
    const targets = parseTargets(inputs, deps.registry, mask);

    const status = resolveStatus(inputs.status);
    if (!status.known) {
      log.warning(`Unknown status "${status.label}"; using the info style.`);
    }
    const eventName = env.GITHUB_EVENT_NAME ?? '';
    const presetName = resolvePreset(inputs.preset, eventName);
    log.debug(`Preset: ${presetName} (event "${eventName}")`);
    const preset = presetContent(presetName, status);
    const variables = buildVariables(env, await loadEventPayload(env, deps.readFile));
    const templates = new TemplateFiles(env.GITHUB_WORKSPACE || deps.cwd, deps.readFile);

    const warned = new Set<string>();
    const onUnknownVariable = (name: string): void => {
      if (warned.has(name)) return;
      warned.add(name);
      log.warning(`Unknown template variable {{${name}}} rendered as empty.`);
    };

    const prepare = async (target: Target): Promise<Prepared> => {
      try {
        const global: GlobalContent = {
          title: inputs.title,
          message: inputs.message,
          template: inputs.templateFile && (await templates.load(inputs.templateFile)),
          format: inputs.format,
          fields: inputs.fields,
          links: inputs.links,
        };
        const { templateFile, ...content } = target.content;
        const message = composeMessage({
          preset,
          status,
          global,
          target: { ...content, template: templateFile && (await templates.load(templateFile)) },
          variables,
          escapeRaw: (value) => target.bound.escapeRaw(value),
          onUnknownVariable,
        });
        return { target, rendered: target.bound.render(message) };
      } catch (error) {
        return { target, error: describe(error) };
      }
    };
    // Sequential, so warnings appear in target order.
    const prepared: Prepared[] = [];
    for (const target of targets) prepared.push(await prepare(target));

    const results: DeliveryResult[] = new Array<DeliveryResult>(prepared.length);
    const deliverable: { index: number; target: Target; rendered: RenderedTarget }[] = [];
    prepared.forEach((p, index) => {
      const base = { id: p.target.id, provider: p.target.provider };
      if ('error' in p) {
        results[index] = { ...base, ok: false, attempts: 0, error: p.error };
      } else if (inputs.dryRun) {
        log.info(`Dry run: ${p.target.id} (${p.target.provider})\n${preview(p.rendered)}`);
        results[index] = { ...base, ok: true, attempts: 0 };
      } else {
        deliverable.push({ index, ...p });
      }
    });

    if (deliverable.length > 0) {
      const delivered = await deliverAll(
        deliverable.map(({ target, rendered }) => ({
          id: target.id,
          provider: target.provider,
          send: (context) => rendered.send(context),
        })),
        {
          concurrency: inputs.concurrency,
          retries: inputs.retries,
          timeoutMs: inputs.timeoutSeconds * 1000,
          fetch: deps.fetch,
          sleep: deps.sleep,
          random: deps.random,
          debug: (message) => {
            log.debug(message);
          },
        },
      );
      delivered.forEach((result, i) => {
        const slot = deliverable[i];
        if (slot) results[slot.index] = result;
      });
    }

    for (const result of results) {
      if (result.ok) {
        if (!inputs.dryRun) log.info(`${result.id}: sent (${String(result.attempts)} attempt(s))`);
      } else {
        log.error(`${result.id}: ${result.error ?? 'failed'}`);
      }
    }

    writeOutputs(io, redactor, results);
    if (env.GITHUB_STEP_SUMMARY) {
      try {
        await io.appendSummary(renderSummary(redactor, results, inputs.dryRun));
      } catch (error) {
        log.warning(`Could not write the job summary: ${describe(error)}`);
      }
    }

    const failed = results.filter((r) => !r.ok).length;
    if (failed > 0) {
      const summary = `${String(failed)} of ${String(results.length)} target(s) failed.`;
      if (shouldFail(results, inputs.failOn)) io.setFailed(redactor.redact(summary));
      else log.warning(`${summary} Not failing the step (fail-on: ${inputs.failOn}).`);
    }
  } catch (error) {
    io.setFailed(redactor.redact(describe(error)));
  }
}

function preview(rendered: RenderedTarget): string {
  return typeof rendered.preview === 'string'
    ? rendered.preview
    : JSON.stringify(rendered.preview, null, 2);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
