import type { DeliveryResult } from './deliver.js';

export const FAIL_ON = ['any', 'all', 'none'] as const;
export type FailOn = (typeof FAIL_ON)[number];

/** Whether the step should fail, given every target's result. */
export function shouldFail(results: readonly DeliveryResult[], failOn: FailOn): boolean {
  const failed = results.filter((r) => !r.ok).length;
  switch (failOn) {
    case 'any':
      return failed > 0;
    case 'all':
      return results.length > 0 && failed === results.length;
    case 'none':
      return false;
  }
}
