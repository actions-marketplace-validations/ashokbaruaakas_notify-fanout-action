import * as core from '@actions/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { run } from './main.js';

vi.mock('@actions/core', () => ({
  info: vi.fn(),
  setFailed: vi.fn(),
}));

describe('run', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('completes without failing the step', () => {
    run();
    expect(core.setFailed).not.toHaveBeenCalled();
  });
});
