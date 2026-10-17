import { parse, YAMLParseError } from 'yaml';

import { ConfigError } from './reader.js';

/**
 * Parses a YAML (or JSON) input. Errors give only the position: the parser's
 * own messages quote the source, which may contain secrets.
 */
export function parseYaml(source: string, inputName: string): unknown {
  try {
    // prettyErrors adds `linePos`; its message (which quotes the source) is not used.
    return parse(source, { prettyErrors: true }) as unknown;
  } catch (error) {
    const position = error instanceof YAMLParseError ? error.linePos?.[0] : undefined;
    const where = position
      ? ` at line ${String(position.line)}, column ${String(position.col)}`
      : '';
    throw new ConfigError(`${inputName}: invalid YAML${where}`);
  }
}

export function parseYamlList(source: string, inputName: string, maxItems: number): unknown[] {
  const value = parseYaml(source, inputName);
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new ConfigError(`${inputName} must be a YAML list`);
  if (value.length > maxItems) {
    throw new ConfigError(`${inputName} has more than ${String(maxItems)} entries`);
  }
  return value;
}
