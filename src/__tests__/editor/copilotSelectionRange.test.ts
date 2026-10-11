/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

import {
  resolveCopilotSelectionLineRange,
  toChatAttachRange,
  type CanonicalCopilotBlock,
} from '../../editor/copilotSelectionRange';

function block(ordinal: number, kind: string, markdown: string): CanonicalCopilotBlock {
  return { ordinal, kind, markdown };
}

describe('resolveCopilotSelectionLineRange', () => {
  it('maps a single selected block to its exact source lines', () => {
    const rawMarkdown = ['# Title', '', 'First paragraph.', '', 'Second paragraph.'].join('\n');
    const blocks = [
      block(0, 'heading', '# Title'),
      block(1, 'paragraph', 'First paragraph.'),
      block(2, 'paragraph', 'Second paragraph.'),
    ];

    const result = resolveCopilotSelectionLineRange(rawMarkdown, blocks, 1, 1);
    expect(result).toEqual({ ok: true, range: { startLine: 3, endLine: 3 } });
  });

  it('maps a multi-block selection from the first to the last block line', () => {
    const rawMarkdown = ['# Title', '', 'First paragraph.', '', 'Second paragraph.'].join('\n');
    const blocks = [
      block(0, 'heading', '# Title'),
      block(1, 'paragraph', 'First paragraph.'),
      block(2, 'paragraph', 'Second paragraph.'),
    ];

    const result = resolveCopilotSelectionLineRange(rawMarkdown, blocks, 0, 2);
    expect(result).toEqual({ ok: true, range: { startLine: 1, endLine: 5 } });
  });

  it('normalizes reversed ordinal endpoints from pointer selections', () => {
    const rawMarkdown = ['# Title', '', 'First paragraph.', '', 'Second paragraph.'].join('\n');
    const blocks = [
      block(0, 'heading', '# Title'),
      block(1, 'paragraph', 'First paragraph.'),
      block(2, 'paragraph', 'Second paragraph.'),
    ];

    const result = resolveCopilotSelectionLineRange(rawMarkdown, blocks, 2, 0);
    expect(result).toEqual({ ok: true, range: { startLine: 1, endLine: 5 } });
  });

  it('covers the full multi-line span of a hard-wrapped paragraph', () => {
    const rawMarkdown = ['A hard-wrapped paragraph', 'spans two source lines.'].join('\n');
    const blocks = [block(0, 'paragraph', 'A hard-wrapped paragraph spans two source lines.')];

    const result = resolveCopilotSelectionLineRange(rawMarkdown, blocks, 0, 0);
    expect(result).toEqual({ ok: true, range: { startLine: 1, endLine: 2 } });
  });

  it('maps list, table, and code blocks to their full source spans', () => {
    const rawMarkdown = [
      '- alpha',
      '- beta',
      '',
      '| Name | Value |',
      '| --- | --- |',
      '| one | two |',
      '',
      '```ts',
      'const answer = 42;',
      '```',
    ].join('\n');
    const blocks = [
      block(0, 'bulletList', '* alpha\n* beta'),
      block(1, 'table', '| Name | Value |\n| --- | --- |\n| one | two |'),
      block(2, 'codeBlock', '```typescript\nconst answer = 42;\n```'),
    ];

    expect(resolveCopilotSelectionLineRange(rawMarkdown, blocks, 0, 0)).toEqual({
      ok: true,
      range: { startLine: 1, endLine: 2 },
    });
    expect(resolveCopilotSelectionLineRange(rawMarkdown, blocks, 1, 1)).toEqual({
      ok: true,
      range: { startLine: 4, endLine: 6 },
    });
    expect(resolveCopilotSelectionLineRange(rawMarkdown, blocks, 2, 2)).toEqual({
      ok: true,
      range: { startLine: 8, endLine: 10 },
    });
  });

  it('keeps YAML frontmatter as one anchored block', () => {
    const rawMarkdown = [
      '---',
      'title: Demo',
      'tags: [a, b]',
      '---',
      '',
      'Body paragraph.',
    ].join('\n');
    const blocks = [
      block(0, 'frontmatter', '---\ntitle: Demo\ntags: [a, b]\n---'),
      block(1, 'paragraph', 'Body paragraph.'),
    ];

    expect(resolveCopilotSelectionLineRange(rawMarkdown, blocks, 0, 0)).toEqual({
      ok: true,
      range: { startLine: 1, endLine: 4 },
    });
    expect(resolveCopilotSelectionLineRange(rawMarkdown, blocks, 1, 1)).toEqual({
      ok: true,
      range: { startLine: 6, endLine: 6 },
    });
  });

  it('preserves CRLF source line locations', () => {
    const rawMarkdown = 'Caf\u00e9 \ud83d\ude00 is wrapped\r\nacross two lines.\r\n\r\n## R\u00e9sum\u00e9\r\n';
    const blocks = [
      block(0, 'paragraph', 'Caf\u00e9 \ud83d\ude00 is wrapped across two lines.'),
      block(1, 'heading', '## R\u00e9sum\u00e9'),
    ];

    expect(resolveCopilotSelectionLineRange(rawMarkdown, blocks, 0, 1)).toEqual({
      ok: true,
      range: { startLine: 1, endLine: 4 },
    });
  });

  it('fails closed for three-space ordered-list roots', () => {
    const rawMarkdown = ['   1. first', '   2. second'].join('\n');
    const blocks = [block(0, 'orderedList', '1. first\n2. second')];

    const result = resolveCopilotSelectionLineRange(rawMarkdown, blocks, 0, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('MD4H-FB-ANCHOR-002');
    }
  });

  it('fails closed when canonical and raw block counts disagree', () => {
    const rawMarkdown = ['# Title', '', 'Only one paragraph.'].join('\n');
    const blocks = [
      block(0, 'heading', '# Title'),
      block(1, 'paragraph', 'Only one paragraph.'),
      block(2, 'paragraph', 'A block that has no source counterpart.'),
    ];

    const result = resolveCopilotSelectionLineRange(rawMarkdown, blocks, 0, 2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('MD4H-FB-ANCHOR-002');
    }
  });

  it('rejects ordinal selections outside the canonical block set', () => {
    const rawMarkdown = ['# Title'].join('\n');
    const blocks = [block(0, 'heading', '# Title')];

    const result = resolveCopilotSelectionLineRange(rawMarkdown, blocks, 0, 3);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('MD4H-FB-ANCHOR-001');
      expect(result.error.reason).toBe('selection-out-of-range');
    }
  });

  it('rejects non-integer ordinals', () => {
    const rawMarkdown = ['# Title'].join('\n');
    const blocks = [block(0, 'heading', '# Title')];

    const result = resolveCopilotSelectionLineRange(rawMarkdown, blocks, 0, 1.5);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('MD4H-FB-ANCHOR-001');
    }
  });

  it('narrows the range to the source lines containing the selection anchors', () => {
    const rawMarkdown = [
      'First paragraph line.',
      'Second paragraph line.',
      '',
      'Next block line.',
      'Final block line.',
    ].join('\n');
    const blocks = [
      block(0, 'paragraph', 'First paragraph line. Second paragraph line.'),
      block(1, 'paragraph', 'Next block line. Final block line.'),
    ];

    const result = resolveCopilotSelectionLineRange(rawMarkdown, blocks, 0, 1, {
      startText: 'Second paragraph line',
      endText: 'Final block line',
    });
    expect(result).toEqual({ ok: true, range: { startLine: 2, endLine: 5 } });
  });

  it('keeps whole-block range when anchors cannot be located', () => {
    const rawMarkdown = [
      'First paragraph line.',
      'Second paragraph line.',
      '',
      'Next block line.',
      'Final block line.',
    ].join('\n');
    const blocks = [
      block(0, 'paragraph', 'First paragraph line. Second paragraph line.'),
      block(1, 'paragraph', 'Next block line. Final block line.'),
    ];

    const result = resolveCopilotSelectionLineRange(rawMarkdown, blocks, 0, 1, {
      startText: 'missing start anchor words',
      endText: 'missing end anchor words',
    });
    expect(result).toEqual({ ok: true, range: { startLine: 1, endLine: 5 } });
  });
});

describe('toChatAttachRange', () => {
  it('produces a 1-based internal range spanning whole lines', () => {
    const text = ['# Title', '', 'First paragraph.', '', 'Second paragraph.'].join('\n');

    expect(toChatAttachRange(text, { startLine: 3, endLine: 5 })).toEqual({
      startLineNumber: 3,
      startColumn: 1,
      endLineNumber: 5,
      endColumn: 18,
    });
  });

  it('ends one past the last character of the final line', () => {
    const text = 'abc\ndefgh\n';

    expect(toChatAttachRange(text, { startLine: 1, endLine: 2 })).toEqual({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 2,
      endColumn: 6,
    });
  });

  it('handles a single-character line', () => {
    const text = 'a\nb\n';

    expect(toChatAttachRange(text, { startLine: 1, endLine: 1 })).toEqual({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 2,
    });
  });

  it('handles CRLF documents without counting the carriage return', () => {
    const text = 'abc\r\ndef\r\n';

    expect(toChatAttachRange(text, { startLine: 1, endLine: 2 })).toEqual({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 2,
      endColumn: 4,
    });
  });

  it('clamps an end line beyond the document to the last line', () => {
    const text = 'abc\ndef';

    expect(toChatAttachRange(text, { startLine: 1, endLine: 99 })).toEqual({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 2,
      endColumn: 4,
    });
  });
});