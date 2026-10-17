import { describe, expect, it } from 'vitest';

import { recordingIO } from '../../test/harness.js';
import { Redactor } from './redact.js';
import { createLogger, renderSummary, writeOutputs } from './report.js';

describe('Redactor', () => {
  it('replaces secrets, longest first, including URL-encoded forms', () => {
    const redactor = new Redactor();
    redactor.add(['abc', 'abc:def', '']);
    expect(redactor.redact('x abc:def y abc z abc%3Adef')).toBe('x *** y *** z ***');
    expect(redactor.redact('nothing here')).toBe('nothing here');
  });
});

describe('createLogger', () => {
  it('redacts every level and shows debug lines as info when verbose', () => {
    const redactor = new Redactor();
    redactor.add(['tok']);
    const { io, recorded } = recordingIO({});
    createLogger(io, redactor, true).debug('using tok');
    createLogger(io, redactor, false).debug('using tok');
    createLogger(io, redactor, false).warning('tok!');
    expect(recorded.logs).toEqual([
      { level: 'info', message: '[debug] using ***' },
      { level: 'debug', message: 'using ***' },
      { level: 'warning', message: '***!' },
    ]);
  });
});

describe('writeOutputs', () => {
  it('writes snake_case results and counts', () => {
    const { io, recorded } = recordingIO({});
    const redactor = new Redactor();
    redactor.add(['s3cret']);
    writeOutputs(io, redactor, [
      { id: 'a', provider: 'fake', ok: true, attempts: 1, messageId: '42' },
      { id: 'b', provider: 'fake', ok: false, attempts: 4, error: 'HTTP 401: s3cret' },
    ]);
    expect(recorded.results()).toEqual([
      { id: 'a', provider: 'fake', ok: true, attempts: 1, message_id: '42' },
      { id: 'b', provider: 'fake', ok: false, attempts: 4, error: 'HTTP 401: ***' },
    ]);
    expect(recorded.outputs['success-count']).toBe('1');
    expect(recorded.outputs['failure-count']).toBe('1');
  });

  it('stays valid JSON whatever the secret is', () => {
    const { io, recorded } = recordingIO({});
    const redactor = new Redactor();
    redactor.add(['t', '"', ',']);
    writeOutputs(io, redactor, [{ id: 'a', provider: 'fake', ok: true, attempts: 1 }]);
    expect(recorded.results()).toEqual([{ id: 'a', provider: 'fake', ok: true, attempts: 1 }]);
  });
});

describe('renderSummary', () => {
  it('renders an escaped, redacted table', () => {
    const redactor = new Redactor();
    redactor.add(['s3cret']);
    const html = renderSummary(
      redactor,
      [
        { id: 'a', provider: 'fake', ok: true, attempts: 1 },
        { id: 'b', provider: 'fake', ok: false, attempts: 2, error: '<script> s3cret' },
      ],
      false,
    );
    expect(html).toContain('<tr><td>a</td><td>fake</td><td>✅ sent</td><td>1</td></tr>');
    expect(html).toContain('<td>❌ failed: &lt;script&gt; ***</td>');
  });
});
