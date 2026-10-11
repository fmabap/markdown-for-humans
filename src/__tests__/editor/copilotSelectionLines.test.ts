/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

import {
    extractSelectionAnchors,
    narrowCopilotLineRange,
} from '../../editor/copilotSelectionLines';

describe('narrowCopilotLineRange', () => {
    it('narrows both endpoints inside a hard-wrapped paragraph', () => {
        const rawMarkdown = ['A hard-wrapped paragraph', 'spans two source lines here.'].join('\n');

        expect(
            narrowCopilotLineRange(
                rawMarkdown,
                { startLine: 1, endLine: 2 },
                { startLine: 1, endLine: 2 },
                { startText: 'spans two', endText: 'lines here' }
            )
        ).toEqual({ startLine: 2, endLine: 2 });
    });

    it('keeps whole-block bounds when no anchors are provided', () => {
        const rawMarkdown = ['A hard-wrapped paragraph', 'spans two source lines here.'].join('\n');

        expect(
            narrowCopilotLineRange(
                rawMarkdown,
                { startLine: 1, endLine: 2 },
                { startLine: 1, endLine: 2 },
                { startText: '', endText: '' }
            )
        ).toEqual({ startLine: 1, endLine: 2 });
    });

    it('narrows the start of one block and the end of another independently', () => {
        const rawMarkdown = [
            'Alpha start.',
            'Beta middle.',
            'Gamma end.',
            'Delta next.',
            'Epsilon last.',
        ].join('\n');

        expect(
            narrowCopilotLineRange(
                rawMarkdown,
                { startLine: 1, endLine: 3 },
                { startLine: 4, endLine: 5 },
                { startText: 'Beta middle', endText: 'Epsilon last' }
            )
        ).toEqual({ startLine: 2, endLine: 5 });
    });

    it('matches through inline formatting such as bold markers', () => {
        const rawMarkdown = ['plain one', 'A **bold** word here', 'plain two'].join('\n');

        expect(
            narrowCopilotLineRange(
                rawMarkdown,
                { startLine: 1, endLine: 3 },
                { startLine: 1, endLine: 3 },
                { startText: 'bold word', endText: 'bold word' }
            )
        ).toEqual({ startLine: 2, endLine: 2 });
    });

    it('matches through link syntax by comparing rendered text', () => {
        const rawMarkdown = [
            'plain one',
            '[Learn more](User-Guide) about tables',
            'plain two',
        ].join('\n');

        expect(
            narrowCopilotLineRange(
                rawMarkdown,
                { startLine: 1, endLine: 3 },
                { startLine: 1, endLine: 3 },
                { startText: 'Learn more about', endText: 'about tables' }
            )
        ).toEqual({ startLine: 2, endLine: 2 });
    });

    it('resolves anchors that span a source line break', () => {
        const rawMarkdown = ['one two three', 'four five six'].join('\n');

        expect(
            narrowCopilotLineRange(
                rawMarkdown,
                { startLine: 1, endLine: 2 },
                { startLine: 1, endLine: 2 },
                { startText: 'three four five', endText: 'four five six' }
            )
        ).toEqual({ startLine: 1, endLine: 2 });
    });

    it('disambiguates a repeated phrase with longer anchors', () => {
        const rawMarkdown = [
            'repeat phrase here and more words one two three',
            'repeat phrase here and more words four five six',
            'unique tail words seven eight nine',
        ].join('\n');

        expect(
            narrowCopilotLineRange(
                rawMarkdown,
                { startLine: 1, endLine: 3 },
                { startLine: 1, endLine: 3 },
                {
                    startText: 'repeat phrase here and more words four five six unique tail words seven',
                    endText: 'here and more words four five six unique tail words seven eight nine',
                }
            )
        ).toEqual({ startLine: 2, endLine: 3 });
    });

    it('ignores a short ambiguous single word and keeps whole-block bounds', () => {
        const rawMarkdown = ['end alpha one', 'end beta two', 'end gamma three'].join('\n');

        expect(
            narrowCopilotLineRange(
                rawMarkdown,
                { startLine: 1, endLine: 3 },
                { startLine: 1, endLine: 3 },
                { startText: 'end', endText: 'end' }
            )
        ).toEqual({ startLine: 1, endLine: 3 });
    });

    it('accepts a short single word that matches exactly one line', () => {
        const rawMarkdown = ['alpha one', 'beta two', 'zeta three'].join('\n');

        expect(
            narrowCopilotLineRange(
                rawMarkdown,
                { startLine: 1, endLine: 3 },
                { startLine: 1, endLine: 3 },
                { startText: 'zeta', endText: 'zeta' }
            )
        ).toEqual({ startLine: 3, endLine: 3 });
    });

    it('falls back to whole-block bounds when endpoints would invert', () => {
        const rawMarkdown = ['aa bb', 'mid mid', 'cc dd'].join('\n');

        expect(
            narrowCopilotLineRange(
                rawMarkdown,
                { startLine: 1, endLine: 3 },
                { startLine: 1, endLine: 3 },
                { startText: 'cc dd', endText: 'aa bb' }
            )
        ).toEqual({ startLine: 1, endLine: 3 });
    });

    it('handles CRLF source documents', () => {
        const rawMarkdown = 'first line\r\nsecond line here\r\n';

        expect(
            narrowCopilotLineRange(
                rawMarkdown,
                { startLine: 1, endLine: 2 },
                { startLine: 1, endLine: 2 },
                { startText: 'second line', endText: 'second line' }
            )
        ).toEqual({ startLine: 2, endLine: 2 });
    });

    it('narrows to a single table row', () => {
        const rawMarkdown = [
            '| Name | Value |',
            '| --- | --- |',
            '| alpha | beta |',
            '| gamma | delta |',
        ].join('\n');

        expect(
            narrowCopilotLineRange(
                rawMarkdown,
                { startLine: 1, endLine: 4 },
                { startLine: 1, endLine: 4 },
                { startText: 'gamma delta', endText: 'gamma delta' }
            )
        ).toEqual({ startLine: 4, endLine: 4 });
    });

    it('ignores anchors that match no line in the block', () => {
        const rawMarkdown = ['alpha one', 'beta two'].join('\n');

        expect(
            narrowCopilotLineRange(
                rawMarkdown,
                { startLine: 1, endLine: 2 },
                { startLine: 1, endLine: 2 },
                { startText: 'not present here', endText: 'not present here' }
            )
        ).toEqual({ startLine: 1, endLine: 2 });
    });
});

describe('extractSelectionAnchors', () => {
    it('takes the first and last words of the selection', () => {
        const text = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen';

        expect(extractSelectionAnchors(text)).toEqual({
            startText: 'one two three four five six seven eight nine ten eleven twelve',
            endText: 'four five six seven eight nine ten eleven twelve thirteen fourteen fifteen',
        });
    });

    it('returns the whole text when it is short', () => {
        expect(extractSelectionAnchors('alpha beta')).toEqual({
            startText: 'alpha beta',
            endText: 'alpha beta',
        });
    });

    it('returns empty anchors for empty text', () => {
        expect(extractSelectionAnchors('   ')).toEqual({ startText: '', endText: '' });
    });
});