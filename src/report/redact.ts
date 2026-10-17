export const REDACTED = '***';

/**
 * Removes known secrets from text. The runner masks registered secrets in
 * logs, but not in outputs or the job summary, so everything we emit goes
 * through this too.
 */
export class Redactor {
  private secrets: string[] = [];

  add(values: Iterable<string>): void {
    const next = new Set(this.secrets);
    for (const value of values) {
      if (value === '') continue;
      next.add(value);
      // Secrets placed in URLs may appear percent-encoded.
      next.add(encodeURIComponent(value));
    }
    this.secrets = [...next].sort((a, b) => b.length - a.length);
  }

  redact(text: string): string {
    let result = text;
    for (const secret of this.secrets) result = result.split(secret).join(REDACTED);
    return result;
  }
}
