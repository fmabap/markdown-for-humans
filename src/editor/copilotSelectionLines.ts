/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

/**
 * @file copilotSelectionLines.ts - Exact source-line narrowing for a selection
 * @description Narrows a whole-block source line span down to the lines that
 *              actually contain the selected text, so "Add Selection to GitHub
 *              Copilot" attaches only the selected lines instead of every block
 *              the selection touches.
 *
 * Key responsibilities:
 * - Locate the selection's first and last words inside the endpoint blocks
 * - Compare rendered text, ignoring source-only Markdown syntax
 * - Match across source line breaks within a block
 * - Fail safe: unlocatable anchors keep the whole-block line span
 */

/** Inclusive 1-based source line span of one top-level block. */
export interface CopilotLineSpan {
    startLine: number;
    endLine: number;
}

/** Plain-text endpoint anchors of a rich-view selection. */
export interface CopilotSelectionAnchors {
    startText: string;
    endText: string;
}

/** Source lines covering exactly the selected text. */
export interface CopilotNarrowedLineRange {
    startLine: number;
    endLine: number;
}

interface AnchorCandidate {
    text: string;
    words: number;
}

interface NormalizedSpan {
    /** Span lines normalized and joined with single spaces. */
    text: string;
    /** Start offset of each segment inside {@link text}. */
    segmentStarts: number[];
    /** Original source line number of each segment. */
    segmentLines: number[];
}

/** Word counts tried from longest to shortest when building anchors. */
const ANCHOR_WORD_COUNTS = [12, 8, 5, 3, 2, 1] as const;
/** Words kept per endpoint when the webview snapshots the selection. */
const MAX_ANCHOR_WORDS = 12;
/** A single-word anchor must be at least this long after normalization... */
const MIN_SINGLE_WORD_LENGTH = 5;
/** ...or match exactly one line of the block span. */

/**
 * Snapshot the first and last words of a plain-text selection. These are the
 * anchors used to locate the selection's source lines.
 *
 * @param plainText - Rendered plain text of the selection
 * @returns Start and end anchors (at most {@link MAX_ANCHOR_WORDS} words each)
 */
export function extractSelectionAnchors(plainText: string): CopilotSelectionAnchors {
    const words = plainText.split(/\s+/).filter(word => word.length > 0);
    if (words.length === 0) return { startText: '', endText: '' };
    return {
        startText: words.slice(0, MAX_ANCHOR_WORDS).join(' '),
        endText: words.slice(-MAX_ANCHOR_WORDS).join(' '),
    };
}

/**
 * Narrow whole-block source lines to the lines that contain the selection.
 *
 * Each endpoint is located independently inside its own block: the start line
 * by the first occurrence of the selection's opening words, the end line by the
 * last occurrence of its closing words. Anchors may span source line breaks.
 * When an endpoint cannot be located, its whole-block bound is kept; when the
 * narrowed endpoints would invert, the whole-block range is returned.
 *
 * @param rawMarkdown - Current Markdown source of the document
 * @param startBlock - Source lines of the first block the selection touches
 * @param endBlock - Source lines of the last block the selection touches
 * @param anchors - Plain-text endpoint anchors of the selection
 * @returns The narrowed source line range
 */
export function narrowCopilotLineRange(
    rawMarkdown: string,
    startBlock: CopilotLineSpan,
    endBlock: CopilotLineSpan,
    anchors: CopilotSelectionAnchors
): CopilotNarrowedLineRange {
    const fallback: CopilotNarrowedLineRange = {
        startLine: startBlock.startLine,
        endLine: endBlock.endLine,
    };
    const rawLines = splitSourceLines(rawMarkdown);

    const startLine = narrowEndpoint(rawLines, startBlock, anchors.startText, 'start');
    const endLine = narrowEndpoint(rawLines, endBlock, anchors.endText, 'end');
    if (startLine === null && endLine === null) return fallback;

    const resolvedStart = startLine ?? startBlock.startLine;
    const resolvedEnd = endLine ?? endBlock.endLine;
    if (resolvedStart > resolvedEnd) return fallback;
    return { startLine: resolvedStart, endLine: resolvedEnd };
}

/**
 * Locate one endpoint's source line inside its block span.
 *
 * @returns The narrowed line, or `null` when no anchor could be located
 */
function narrowEndpoint(
    rawLines: readonly string[],
    block: CopilotLineSpan,
    anchorText: string,
    side: 'start' | 'end'
): number | null {
    const span = buildNormalizedSpan(rawLines, block);
    if (!span) return null;

    for (const candidate of anchorCandidates(anchorText, side)) {
        const matches = findAllIndexes(span.text, candidate.text);
        if (matches.length === 0) continue;
        const distinctEnough =
            candidate.words >= 2 ||
            candidate.text.length >= MIN_SINGLE_WORD_LENGTH ||
            matches.length === 1;
        if (!distinctEnough) continue;

        const anchorOffset = side === 'start' ? matches[0] : matches[matches.length - 1];
        const lineOffset = side === 'start' ? anchorOffset : anchorOffset + candidate.text.length - 1;
        return lineAtOffset(span, lineOffset);
    }
    return null;
}

/**
 * Build progressively shorter anchor candidates from the selection's words.
 * Longest first: a long phrase is the most specific evidence for a position.
 */
function anchorCandidates(anchorText: string, side: 'start' | 'end'): AnchorCandidate[] {
    const words = anchorText.split(/\s+/).filter(word => word.length > 0);
    const candidates: AnchorCandidate[] = [];
    for (const count of ANCHOR_WORD_COUNTS) {
        if (words.length < count) continue;
        const picked = side === 'start' ? words.slice(0, count) : words.slice(-count);
        const text = normalizeForMatch(picked.join(' '));
        if (text.length === 0) continue;
        if (candidates.some(candidate => candidate.text === text)) continue;
        candidates.push({ text, words: picked.length });
    }
    return candidates;
}

/**
 * Normalize a span to whitespace-separated rendered text while remembering
 * which source line each surviving segment came from.
 */
function buildNormalizedSpan(
    rawLines: readonly string[],
    block: CopilotLineSpan
): NormalizedSpan | null {
    const segments: Array<{ line: number; text: string }> = [];
    for (let line = block.startLine; line <= block.endLine; line += 1) {
        const normalized = normalizeForMatch(rawLines[line - 1] ?? '');
        if (normalized.length > 0) segments.push({ line, text: normalized });
    }
    if (segments.length === 0) return null;

    const segmentStarts: number[] = [];
    const segmentLines: number[] = [];
    const parts: string[] = [];
    let offset = 0;
    for (const segment of segments) {
        segmentStarts.push(offset);
        segmentLines.push(segment.line);
        parts.push(segment.text);
        // One joining space between segments, mirroring the collapsed spacing of
        // normalizeForMatch so anchors can span source line breaks.
        offset += segment.text.length + 1;
    }
    return { text: parts.join(' '), segmentStarts, segmentLines };
}

/** Map a normalized-text offset back to its original source line. */
function lineAtOffset(span: NormalizedSpan, offset: number): number {
    let line = span.segmentLines[0];
    for (let index = 0; index < span.segmentStarts.length; index += 1) {
        if (span.segmentStarts[index] <= offset) line = span.segmentLines[index];
        else break;
    }
    return line;
}

/**
 * Reduce text to its rendered words: link targets and Markdown/HTML syntax are
 * removed, punctuation becomes spacing, and case is folded. Both sides of a
 * match go through the same normalization.
 */
function normalizeForMatch(value: string): string {
    return value
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, ' $1 ')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, ' $1 ')
        .replace(/<[^>]*>/g, ' ')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

function findAllIndexes(text: string, needle: string): number[] {
    const indexes: number[] = [];
    if (needle.length === 0) return indexes;
    let from = text.indexOf(needle);
    while (from !== -1) {
        indexes.push(from);
        from = text.indexOf(needle, from + needle.length);
    }
    return indexes;
}

function splitSourceLines(rawMarkdown: string): string[] {
    return rawMarkdown.split(/\r\n|\r|\n/);
}