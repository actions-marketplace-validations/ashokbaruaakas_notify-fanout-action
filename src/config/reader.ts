/** A configuration mistake. Messages name the setting but never echo its value. */
export class ConfigError extends Error {
  override name = 'ConfigError';
}

/** Runs `read`, prefixing any `ConfigError` with where the setting lives. */
export function withPrefix<T>(prefix: string, read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof ConfigError) throw new ConfigError(`${prefix}: ${error.message}`);
    throw error;
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads typed values from a parsed YAML mapping and tracks which keys were
 * used, so leftover (misspelled) keys can be reported.
 */
export class ObjectReader {
  private readonly used = new Set<string>();

  private constructor(private readonly object: Record<string, unknown>) {}

  static from(value: unknown, what: string): ObjectReader {
    if (!isPlainObject(value)) throw new ConfigError(`${what} must be a mapping of keys to values`);
    return new ObjectReader(value);
  }

  private take(key: string): unknown {
    this.used.add(key);
    return Object.hasOwn(this.object, key) ? this.object[key] : undefined;
  }

  optionalString(key: string): string | undefined {
    const value = this.take(key);
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'boolean') return String(value);
    throw new ConfigError(`${key} must be a string`);
  }

  requiredString(key: string): string {
    const value = this.optionalString(key);
    if (value === undefined || value.trim() === '') throw new ConfigError(`${key} is required`);
    return value;
  }

  optionalBoolean(key: string): boolean | undefined {
    const value = this.take(key);
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === 'false') return value === 'true';
    throw new ConfigError(`${key} must be true or false`);
  }

  /** Accepts numbers and numeric strings. A blank string counts as unset (e.g. an empty step output). */
  optionalInteger(key: string, min: number, max: number): number | undefined {
    const value = this.take(key);
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string' && value.trim() === '') return undefined;
    const number = typeof value === 'string' ? Number(value) : value;
    if (typeof number !== 'number' || !Number.isInteger(number) || number < min || number > max) {
      throw new ConfigError(`${key} must be an integer from ${String(min)} to ${String(max)}`);
    }
    return number;
  }

  optionalEnum<T extends string>(key: string, values: readonly T[]): T | undefined {
    const value = this.optionalString(key);
    if (value === undefined) return undefined;
    const match = values.find((v) => v === value.toLowerCase());
    if (match === undefined) throw new ConfigError(`${key} must be one of: ${values.join(', ')}`);
    return match;
  }

  /** The keys not read so far, as a new mapping. */
  rest(): Record<string, unknown> {
    return Object.fromEntries(Object.entries(this.object).filter(([key]) => !this.used.has(key)));
  }

  assertNoUnknownKeys(): void {
    const unknown = Object.keys(this.object).filter((key) => !this.used.has(key));
    if (unknown.length > 0) {
      throw new ConfigError(`unknown option(s): ${unknown.map((k) => `"${k}"`).join(', ')}`);
    }
  }
}
