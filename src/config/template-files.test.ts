import { describe, expect, it, vi } from 'vitest';

import { MAX_INPUT_LENGTH } from './inputs.js';
import { TemplateFiles } from './template-files.js';

describe('TemplateFiles', () => {
  const files: Record<string, string> = {
    '/repo/tpl/a.md': 'A',
    '/repo/big.md': 'x'.repeat(MAX_INPUT_LENGTH + 1),
  };
  const readFile = vi.fn((path: string) =>
    path in files ? Promise.resolve(files[path] ?? '') : Promise.reject(new Error('ENOENT')),
  );

  it('reads files relative to the workspace, once per path', async () => {
    const templates = new TemplateFiles('/repo', readFile);
    await expect(templates.load('tpl/a.md')).resolves.toBe('A');
    await expect(templates.load('tpl/a.md')).resolves.toBe('A');
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['../etc/passwd', 'template file "../etc/passwd" is outside the repository'],
    ['/etc/passwd', 'template file "/etc/passwd" is outside the repository'],
    ['missing.md', 'template file "missing.md" could not be read'],
    ['big.md', 'template file "big.md" is longer than'],
  ])('rejects %j', async (path, error) => {
    await expect(new TemplateFiles('/repo', readFile).load(path)).rejects.toThrow(error);
  });
});
