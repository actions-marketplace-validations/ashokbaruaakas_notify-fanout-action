import { isAbsolute, relative, resolve } from 'node:path';

import { MAX_INPUT_LENGTH } from './inputs.js';
import { ConfigError } from './reader.js';

/** Loads template files relative to the workspace, once per path. */
export class TemplateFiles {
  private readonly cache = new Map<string, Promise<string>>();

  constructor(
    private readonly workspace: string,
    private readonly readFile: (path: string) => Promise<string>,
  ) {}

  load(path: string): Promise<string> {
    let content = this.cache.get(path);
    if (!content) {
      content = this.read(path);
      this.cache.set(path, content);
    }
    return content;
  }

  private async read(path: string): Promise<string> {
    const full = resolve(this.workspace, path);
    const inside = relative(this.workspace, full);
    if (inside.startsWith('..') || isAbsolute(inside)) {
      throw new ConfigError(`template file "${path}" is outside the repository`);
    }
    let content: string;
    try {
      content = await this.readFile(full);
    } catch {
      throw new ConfigError(`template file "${path}" could not be read`);
    }
    if (content.length > MAX_INPUT_LENGTH) {
      throw new ConfigError(
        `template file "${path}" is longer than ${String(MAX_INPUT_LENGTH)} characters`,
      );
    }
    return content;
  }
}
