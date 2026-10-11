/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

import {
  buildCopilotChatPlan,
  renderCopilotClipboardFallback,
  type CopilotChatPlanInput,
} from '../../editor/copilotChatAttach';

function baseInput(overrides: Partial<CopilotChatPlanInput> = {}): CopilotChatPlanInput {
  return {
    documentUri: 'file:///c%3A/docs/README.md',
    documentText: '# Title\n\nFirst paragraph.\n\nSecond paragraph.',
    selectionText: 'First paragraph.',
    lineRange: { startLine: 3, endLine: 3 },
    chatCommandAvailable: true,
    documentScheme: 'file',
    ...overrides,
  };
}

describe('buildCopilotChatPlan', () => {
  it('attaches a file chip with the resolved line range when chat is available', () => {
    const plan = buildCopilotChatPlan(baseInput());

    expect(plan).toEqual({
      action: 'attach',
      uri: 'file:///c%3A/docs/README.md',
      fragment: 'L3-3',
      range: {
        startLineNumber: 3,
        startColumn: 1,
        endLineNumber: 3,
        endColumn: 17,
      },
    });
  });

  it('attaches a whole-file chip without a range when line mapping failed', () => {
    const plan = buildCopilotChatPlan(baseInput({ lineRange: null }));

    expect(plan).toEqual({
      action: 'attach',
      uri: 'file:///c%3A/docs/README.md',
      fragment: undefined,
      range: undefined,
    });
  });

  it('gives each line range its own chip identity', () => {
    const first = buildCopilotChatPlan(baseInput({ lineRange: { startLine: 3, endLine: 7 } }));
    const second = buildCopilotChatPlan(baseInput({ lineRange: { startLine: 20, endLine: 24 } }));
    if (first.action !== 'attach' || second.action !== 'attach') {
      throw new Error('expected attach plans');
    }

    expect(first.fragment).toBe('L3-7');
    expect(second.fragment).toBe('L20-24');
    // The chat attachment model deduplicates by uri + range; a serialized
    // plain range stringifies identically, so the fragment must carry the
    // identity or the second range of a file is silently dropped.
    expect(first.fragment).not.toBe(second.fragment);
  });

  it('deduplicates identical re-attachments through a stable chip identity', () => {
    expect(buildCopilotChatPlan(baseInput())).toEqual(buildCopilotChatPlan(baseInput()));
  });

  it('falls back to the clipboard when the chat command is unavailable', () => {
    const plan = buildCopilotChatPlan(baseInput({ chatCommandAvailable: false }));

    expect(plan.action).toBe('clipboard');
  });

  it('falls back to the clipboard for untitled documents', () => {
    const plan = buildCopilotChatPlan(
      baseInput({ documentUri: 'untitled:Untitled-1', documentScheme: 'untitled' })
    );

    expect(plan.action).toBe('clipboard');
  });

  it('falls back to the clipboard for non-file schemes', () => {
    const plan = buildCopilotChatPlan(
      baseInput({ documentUri: 'output:extension-output', documentScheme: 'output' })
    );

    expect(plan.action).toBe('clipboard');
  });

  it('attaches for remote workspaces whose files resolve on disk', () => {
    const plan = buildCopilotChatPlan(
      baseInput({
        documentUri: 'vscode-remote://ssh-remote%2Bdev/doc.md',
        documentScheme: 'vscode-remote',
      })
    );

    expect(plan.action).toBe('attach');
  });

  it('prefers the clipboard fallback over attaching when both apply', () => {
    const plan = buildCopilotChatPlan(
      baseInput({ chatCommandAvailable: false, documentScheme: 'untitled' })
    );

    expect(plan.action).toBe('clipboard');
  });
});

describe('renderCopilotClipboardFallback', () => {
  it('renders the path, line span, and quoted selection', () => {
    const text = renderCopilotClipboardFallback({
      displayPath: 'docs/README.md',
      lineRange: { startLine: 3, endLine: 7 },
      selectionText: 'First paragraph.',
    });

    expect(text).toBe(
      'Context: docs/README.md lines 3-7\n\n> First paragraph.'
    );
  });

  it('renders a single-line span without a dash range', () => {
    const text = renderCopilotClipboardFallback({
      displayPath: 'docs/README.md',
      lineRange: { startLine: 4, endLine: 4 },
      selectionText: 'Only line.',
    });

    expect(text).toBe('Context: docs/README.md line 4\n\n> Only line.');
  });

  it('omits the line span when mapping failed', () => {
    const text = renderCopilotClipboardFallback({
      displayPath: 'docs/README.md',
      lineRange: null,
      selectionText: 'Only line.',
    });

    expect(text).toBe('Context: docs/README.md\n\n> Only line.');
  });

  it('quotes each line of a multi-line selection', () => {
    const text = renderCopilotClipboardFallback({
      displayPath: 'docs/README.md',
      lineRange: { startLine: 1, endLine: 2 },
      selectionText: 'alpha\nbeta',
    });

    expect(text).toBe('Context: docs/README.md lines 1-2\n\n> alpha\n> beta');
  });

  it('handles an empty selection without a quote block', () => {
    const text = renderCopilotClipboardFallback({
      displayPath: 'docs/README.md',
      lineRange: { startLine: 1, endLine: 2 },
      selectionText: '',
    });

    expect(text).toBe('Context: docs/README.md lines 1-2');
  });
});