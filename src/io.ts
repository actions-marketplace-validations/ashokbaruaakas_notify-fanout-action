import * as core from '@actions/core';

/** Everything the action reads from or writes to the runner, so tests can capture it. */
export interface ActionIO {
  getInput(name: string): string;
  info(message: string): void;
  warning(message: string): void;
  error(message: string): void;
  debug(message: string): void;
  setSecret(value: string): void;
  setOutput(name: string, value: string): void;
  setFailed(message: string): void;
  appendSummary(html: string): Promise<void>;
}

export function createCoreIO(): ActionIO {
  return {
    getInput: (name) => core.getInput(name),
    info: (message) => {
      core.info(message);
    },
    warning: (message) => {
      core.warning(message);
    },
    error: (message) => {
      core.error(message);
    },
    debug: (message) => {
      core.debug(message);
    },
    setSecret: (value) => {
      core.setSecret(value);
    },
    setOutput: (name, value) => {
      core.setOutput(name, value);
    },
    setFailed: (message) => {
      core.setFailed(message);
    },
    appendSummary: async (html) => {
      await core.summary.addRaw(html, true).write();
    },
  };
}
