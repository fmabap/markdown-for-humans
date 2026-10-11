/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

/**
 * @file copilotChatAttach.ts - GitHub Copilot Chat context attachment planning
 * @description Pure decision logic for "Add Selection to GitHub Copilot":
 *              given a resolved source line range and the runtime availability
 *              of the built-in chat command, decide whether to attach a
 *              file + line-range chip to GitHub Copilot Chat or fall back to a
 *              clipboard handoff.
 *
 * Key responsibilities:
 * - Keep the attach-vs-fallback decision testable without the VS Code API
 * - Reproduce the built-in "Add Selection to Chat" chip via
 *   `workbench.action.chat.open` + `attachFiles`
 * - Render a stable clipboard fallback carrying the file, line span, and
 *   quoted selection
 */

import {
  toChatAttachRange,
  type ChatAttachRange,
  type CopilotSelectionLineRange,
} from './copilotSelectionRange';

/** Inputs describing the selection handoff for one document. */
export interface CopilotChatPlanInput {
  /** Document URI string, used verbatim as the chat attachment identity. */
  documentUri: string;
  /** Full Markdown source; used to size the attach range's final column. */
  documentText: string;
  /** Selected rich-view text, quoted in the clipboard fallback. */
  selectionText: string;
  /** Resolved source lines, or `null` when the anchor mapping failed closed. */
  lineRange: CopilotSelectionLineRange | null;
  /** Whether `workbench.action.chat.open` is registered in this VS Code build. */
  chatCommandAvailable: boolean;
  /** URI scheme of the document (`file`, `untitled`, `vscode-remote`, ...). */
  documentScheme: string;
}

/**
 * Attach a file + line-range chip to GitHub Copilot Chat.
 * `range` is `undefined` when line mapping failed closed, in which case the
 * chip references the whole file so the primary value still lands.
 */
export interface CopilotChatAttachPlan {
  action: 'attach';
  uri: string;
  /**
   * URI fragment identifying the attached line range, e.g. `L3-7`.
   *
   * The chat attachment model deduplicates chips by `uri.toString() + range`,
   * but a range object sent from the extension host arrives as a plain object
   * whose `toString()` is `'[object Object]'` for every range. Without a
   * per-range fragment, the second range of a file would collide with the
   * first and be silently dropped. The fragment also makes re-attaching the
   * same lines deduplicate instead of creating identical chips.
   */
  fragment: string | undefined;
  range: ChatAttachRange | undefined;
}

/** Copy a `path:lines` reference plus the quoted selection to the clipboard. */
export interface CopilotChatClipboardPlan {
  action: 'clipboard';
}

export type CopilotChatPlan = CopilotChatAttachPlan | CopilotChatClipboardPlan;

/** URI schemes the built-in chat attachment model can resolve to a real file. */
const ATTACHABLE_SCHEMES = new Set(['file', 'vscode-remote', 'vscode-vfs']);

/**
 * Decide how to hand the selection to GitHub Copilot Chat.
 *
 * The chat chip is preferred whenever the built-in command exists and the
 * document lives at a resolvable file URI. Everything else — missing command,
 * untitled or exotic schemes — degrades to the clipboard fallback so the user
 * never loses the selection context.
 *
 * @param input - Selection handoff inputs
 * @returns The attach plan, or a clipboard fallback plan
 */
export function buildCopilotChatPlan(input: CopilotChatPlanInput): CopilotChatPlan {
  const canAttach = input.chatCommandAvailable && ATTACHABLE_SCHEMES.has(input.documentScheme);
  if (!canAttach) {
    return { action: 'clipboard' };
  }

  return {
    action: 'attach',
    uri: input.documentUri,
    fragment: input.lineRange ? lineRangeFragment(input.lineRange) : undefined,
    range: input.lineRange ? toChatAttachRange(input.documentText, input.lineRange) : undefined,
  };
}

/** Identity fragment for one attached source line range. */
function lineRangeFragment(lineRange: CopilotSelectionLineRange): string {
  return `L${lineRange.startLine}-${lineRange.endLine}`;
}

/** Inputs for {@link renderCopilotClipboardFallback}. */
export interface CopilotClipboardFallbackInput {
  /** Human-readable path shown to the user and pasted into chat. */
  displayPath: string;
  /** Resolved source lines, or `null` when mapping failed closed. */
  lineRange: CopilotSelectionLineRange | null;
  /** Selected rich-view text, quoted line by line. */
  selectionText: string;
}

/**
 * Render the clipboard fallback text: a `Context:` header naming the file and
 * line span, followed by the selection quoted as a Markdown block quote.
 *
 * @param input - Fallback inputs
 * @returns Plain text ready for `vscode.env.clipboard.writeText`
 */
export function renderCopilotClipboardFallback(input: CopilotClipboardFallbackInput): string {
  const header = `Context: ${input.displayPath}${formatLineSuffix(input.lineRange)}`;
  const quoted = quoteLines(input.selectionText);
  return quoted.length > 0 ? `${header}\n\n${quoted}` : header;
}

function formatLineSuffix(lineRange: CopilotSelectionLineRange | null): string {
  if (!lineRange) return '';
  return lineRange.startLine === lineRange.endLine
    ? ` line ${lineRange.startLine}`
    : ` lines ${lineRange.startLine}-${lineRange.endLine}`;
}

function quoteLines(selectionText: string): string {
  if (selectionText.length === 0) return '';
  return selectionText
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n');
}