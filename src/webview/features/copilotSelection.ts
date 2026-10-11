/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

/**
 * @file copilotSelection.ts - Rich-view selection snapshot for Copilot Chat
 * @description Builds the `addSelectionToCopilot` message from the live TipTap
 *              selection: the canonical top-level blocks it covers plus the
 *              inclusive ordinal range the host maps to exact source lines.
 *
 * Key responsibilities:
 * - Convert the absolute ProseMirror selection to top-level block ordinals
 * - Enumerate the canonical blocks exactly once per request
 * - Carry endpoint text anchors so the host can narrow to the selected lines
 * - Carry the selected Markdown so the clipboard fallback can quote it
 */

import type { Editor } from '@tiptap/core';
import type { CanonicalFeedbackBlock } from '../../shared/feedbackProtocol';
import { extractSelectionAnchors } from '../../editor/copilotSelectionLines';
import { blockRelativeRangeFromPositions } from './feedbackRenderedRange';
import { enumerateCanonicalFeedbackBlocks } from './feedbackReview';
import { getSelectionAsMarkdown } from '../utils/copyMarkdown';

/** Webview → host request to attach the current selection to GitHub Copilot. */
export interface CopilotSelectionMessage {
  type: 'addSelectionToCopilot';
  blocks: CanonicalFeedbackBlock[];
  startOrdinal: number;
  endOrdinal: number;
  selectionText: string;
  /** Plain-text words at the start of the selection (line-narrowing anchor). */
  selectionStartText: string;
  /** Plain-text words at the end of the selection (line-narrowing anchor). */
  selectionEndText: string;
}

/**
 * Snapshot the current selection for the host's Copilot Chat attachment.
 *
 * Returns `null` when there is no usable selection (empty, structurally
 * unmappable, or the Markdown serializer is unavailable), so callers can skip
 * the round-trip instead of sending a request the host must reject.
 *
 * @param editor - Live TipTap editor
 * @returns The host message, or `null` when the selection cannot be attached
 */
export function buildCopilotSelectionMessage(editor: Editor): CopilotSelectionMessage | null {
  const { from, to, empty } = editor.state.selection;
  if (empty || from >= to) return null;

  const relative = blockRelativeRangeFromPositions(editor.state.doc, from, to);
  if (!relative) return null;

  let blocks: CanonicalFeedbackBlock[];
  try {
    blocks = enumerateCanonicalFeedbackBlocks(editor);
  } catch (error) {
    console.error('[MD4H] Could not enumerate blocks for Copilot selection:', error);
    return null;
  }
  if (blocks.length === 0) return null;

  const selectionText = getSelectionAsMarkdown(editor) ?? '';
  const anchors = extractSelectionAnchors(
    editor.state.doc.textBetween(from, to, ' ', ' ')
  );

  return {
    type: 'addSelectionToCopilot',
    blocks,
    startOrdinal: relative.startOrdinal,
    endOrdinal: relative.endOrdinal,
    selectionText,
    selectionStartText: anchors.startText,
    selectionEndText: anchors.endText,
  };
}