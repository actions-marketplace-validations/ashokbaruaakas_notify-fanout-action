import * as core from '@actions/core';

export function run(): void {
  try {
    core.info('notify-fanout: scaffold only, nothing to send yet.');
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}
