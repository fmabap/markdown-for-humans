/** @jest-environment jsdom */

/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

import { Editor } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { buildCopilotSelectionMessage } from '../../webview/features/copilotSelection';
import { MarkdownParagraph } from '../../webview/extensions/markdownParagraph';

const DOCUMENT_MARKDOWN = [
    '# Title',
    '',
    'First paragraph.',
    '',
    'Second paragraph.',
    '',
    'Third paragraph.',
].join('\n');

function createEditor(markdown: string): Editor {
    const element = document.createElement('div');
    document.body.appendChild(element);
    return new Editor({
        element,
        extensions: [
            StarterKit.configure({ paragraph: false }),
            MarkdownParagraph,
            Markdown.configure({ markedOptions: { gfm: true, breaks: true } }),
        ],
        content: markdown,
        contentType: 'markdown',
    });
}

/** Select the rendered text of one top-level block by its ordinal. */
function selectBlock(editor: Editor, ordinal: number): void {
    const node = editor.state.doc.child(ordinal);
    const from = positionOfBlock(editor, ordinal) + 1;
    editor.commands.setTextSelection({ from, to: from + node.content.size });
}

function positionOfBlock(editor: Editor, ordinal: number): number {
    let position = 0;
    for (let index = 0; index < ordinal; index += 1) {
        position += editor.state.doc.child(index).nodeSize;
    }
    return position;
}

describe('buildCopilotSelectionMessage', () => {
    afterEach(() => document.body.replaceChildren());

    it('returns null for an empty selection', () => {
        const editor = createEditor(DOCUMENT_MARKDOWN);
        try {
            editor.commands.setTextSelection(1);
            expect(buildCopilotSelectionMessage(editor)).toBeNull();
        } finally {
            editor.destroy();
        }
    });

    it('captures the canonical blocks and ordinal range for one selected block', () => {
        const editor = createEditor(DOCUMENT_MARKDOWN);
        try {
            selectBlock(editor, 1);

            const message = buildCopilotSelectionMessage(editor);
            expect(message).not.toBeNull();
            expect(message?.type).toBe('addSelectionToCopilot');
            expect(message?.startOrdinal).toBe(1);
            expect(message?.endOrdinal).toBe(1);
            expect(message?.blocks.map(block => block.ordinal)).toEqual([0, 1, 2, 3]);
            expect(message?.selectionText).toContain('First paragraph.');
            expect(message?.selectionStartText).toBe('First paragraph.');
            expect(message?.selectionEndText).toBe('First paragraph.');
        } finally {
            editor.destroy();
        }
    });

    it('spans every covered block for a multi-block selection', () => {
        const editor = createEditor(DOCUMENT_MARKDOWN);
        try {
            const from = positionOfBlock(editor, 1) + 1;
            const to = positionOfBlock(editor, 2) + editor.state.doc.child(2).nodeSize - 1;
            editor.commands.setTextSelection({ from, to });

            const message = buildCopilotSelectionMessage(editor);
            expect(message).not.toBeNull();
            expect(message?.startOrdinal).toBe(1);
            expect(message?.endOrdinal).toBe(2);
            // Short selections are below the anchor word cap, so both endpoints carry
            // the complete selected text; the host still finds the exact lines.
            expect(message?.selectionStartText).toBe('First paragraph. Second paragraph.');
            expect(message?.selectionEndText).toBe('First paragraph. Second paragraph.');
        } finally {
            editor.destroy();
        }
    });
});