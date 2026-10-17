const VARIABLE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export interface ExpandOptions {
  /** Escapes a variable value for the format of the surrounding template text. */
  escape: (value: string) => string;
  /** Variables whose values are already in the template's format; inserted without escaping. */
  preformatted?: ReadonlySet<string>;
  onUnknown: (name: string) => void;
}

/**
 * Replaces `{{NAME}}` placeholders. Template text is kept as written; only
 * variable values are escaped. Unknown variables render as empty.
 */
export function expand(
  template: string,
  variables: ReadonlyMap<string, string>,
  options: ExpandOptions,
): string {
  return template.replace(VARIABLE, (_match, name: string) => {
    const value = variables.get(name);
    if (value === undefined) {
      options.onUnknown(name);
      return '';
    }
    return options.preformatted?.has(name) ? value : options.escape(value);
  });
}
