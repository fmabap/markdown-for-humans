/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

/**
 * @file copilotSelectionRange.ts - Rich-view selection to source-line resolution
 * @description Resolves a top-level block selection from the WYSIWYG editor to
 *              the exact 1-based source line span in the original Markdown, so
 *              the extension host can attach a file + line-range context chip to
 *              GitHub Copilot Chat.
 *
 * Key responsibilities:
 * - Reuse the proven Feedback anchor mapping (block ordinals → exact raw lines)
 * - Fail closed on ambiguous Markdown shapes instead of guessing line numbers
 * - Convert resolved lines to the 1-based internal `IRange` shape that the
 *   built-in `workbench.action.chat.open` `attachFiles` option requires
 */

import {
  buildFeedbackAnchorMap,
  mapFeedbackSelection,
  type CanonicalFeedbackBlock,
  type FeedbackAnchorError,
} from './feedbackAnchors';
import {
  narrowCopilotLineRange,
  type CopilotSelectionAnchors,
} from './copilotSelectionLines';

/**
 * One non-empty top-level block from the rich editor, in document order.
 * Structurally identical to the Feedback canonical block; only the fields the
 * anchor builder reads are required.
 */
export type CanonicalCopilotBlock = Pick<CanonicalFeedbackBlock, 'ordinal' | 'kind' | 'markdown'>;

/** Exact 1-based, inclusive source lines covered by a rich-view selection. */
export interface CopilotSelectionLineRange {
  startLine: number;
  endLine: number;
}

/** Result of resolving a block selection against the raw Markdown source. */
export type CopilotSelectionLineRangeResult =
  | { ok: true; range: CopilotSelectionLineRange }
  | { ok: false; error: FeedbackAnchorError };

/**
 * 1-based line/column range in the internal `IRange` shape expected by the
 * built-in chat command's `attachFiles` entries. A `vscode.Range` (0-based
 * `start`/`end` positions) is *not* accepted there.
 */
export interface ChatAttachRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

/**
 * Resolve an inclusive top-level block selection to its exact raw source lines.
 *
 * Without anchors the mapping is block-granular: the returned range covers the
 * complete source span of every selected top-level block, which is the same
 * guarantee the Feedback anchor index makes. With anchors the range is narrowed
 * to the source lines that contain the selection's first and last words.
 * Reverse-order endpoints are normalized so pointer selections resolve
 * identically in either direction.
 *
 * @param rawMarkdown - Current Markdown source of the document
 * @param canonicalBlocks - Non-empty top-level rich blocks in document order
 * @param startOrdinal - One selected top-level block ordinal
 * @param endOrdinal - Other selected top-level block ordinal
 * @param anchors - Optional plain-text endpoint anchors; when provided, the
 *                  range is narrowed to the lines that contain the selection
 * @returns Exact first-to-last source line range, or a stable anchor error
 */
export function resolveCopilotSelectionLineRange(
  rawMarkdown: string,
  canonicalBlocks: readonly CanonicalCopilotBlock[],
  startOrdinal: number,
  endOrdinal: number,
  anchors?: CopilotSelectionAnchors
): CopilotSelectionLineRangeResult {
  const anchorMap = buildFeedbackAnchorMap(rawMarkdown, canonicalBlocks);
  if (!anchorMap.ok) {
    return { ok: false, error: anchorMap.error };
  }

  const selection = mapFeedbackSelection(anchorMap.map, startOrdinal, endOrdinal);
  if (!selection.ok) {
    return { ok: false, error: selection.error };
  }

  if (
    anchors &&
    (anchors.startText.trim().length > 0 || anchors.endText.trim().length > 0)
  ) {
    const first = anchorMap.map.blocks.find(
      block => block.ordinal === selection.range.startOrdinal
    );
    const last = anchorMap.map.blocks.find(block => block.ordinal === selection.range.endOrdinal);
    if (first && last) {
      return {
        ok: true,
        range: narrowCopilotLineRange(
          rawMarkdown,
          { startLine: first.startLine, endLine: first.endLine },
          { startLine: last.startLine, endLine: last.endLine },
          anchors
        ),
      };
    }
  }

  return {
    ok: true,
    range: {
      startLine: selection.range.startLine,
      endLine: selection.range.endLine,
    },
  };
}

/**
 * Convert a resolved source line range to the internal 1-based `IRange` used by
 * `workbench.action.chat.open`'s `attachFiles` entries.
 *
 * The range starts at column 1 of the first line and ends one past the last
 * character of the final line, so the chip covers whole lines exactly. An end
 * line beyond the document is clamped to the last line.
 *
 * @param documentText - Full Markdown source of the document
 * @param range - Exact 1-based inclusive source lines from {@link resolveCopilotSelectionLineRange}
 * @returns A 1-based `IRange` spanning the whole selected lines
 */
export function toChatAttachRange(
  documentText: string,
  range: CopilotSelectionLineRange
): ChatAttachRange {
  const lineLengths = measureLineLengths(documentText);
  const lastLine = Math.max(1, lineLengths.length);

  const startLineNumber = clamp(range.startLine, 1, lastLine);
  const endLineNumber = clamp(range.endLine, startLineNumber, lastLine);

  return {
    startLineNumber,
    startColumn: 1,
    endLineNumber,
    // One past the final character, matching VS Code's whole-line selection.
    endColumn: lineLengths[endLineNumber - 1] + 1,
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/**
 * Measure each line's character length, excluding the line terminator.
 * Handles LF, CRLF, and lone CR documents.
 */
function measureLineLengths(documentText: string): number[] {
  const lengths: number[] = [];
  let current = 0;
  for (let index = 0; index < documentText.length; index += 1) {
    const code = documentText.charCodeAt(index);
    if (code === 13 /* \r */) {
      lengths.push(current);
      current = 0;
      // Swallow the LF of a CRLF pair so it is not counted as an empty line.
      if (documentText.charCodeAt(index + 1) === 10 /* \n */) {
        index += 1;
      }
    } else if (code === 10 /* \n */) {
      lengths.push(current);
      current = 0;
    } else {
      current += 1;
    }
  }
  lengths.push(current);
  return lengths;
}