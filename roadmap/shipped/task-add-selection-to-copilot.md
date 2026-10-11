# Task: Add Selection to GitHub Copilot (Editor Context Menu)

## 1. Task Metadata

- **Task name:** Add Selection to GitHub Copilot
- **Slug:** add-selection-to-copilot
- **Status:** shipped
- **Created:** 2026-10-11
- **Last updated:** 2026-10-11
- **Shipped:** 2026-10-11

---

## 2. Context & Problem

**Current state:**

- The WYSIWYG editor (TipTap webview) has no general text context menu. Right-click only shows the table menu (inside table cells) and the image menu (on images); everywhere else the native browser menu appears with no editor actions.
- VS Code's built-in text editor offers **"Add Selection to Chat"**, which attaches a file + line-range chip to GitHub Copilot Chat. Our custom editor cannot use it: `AttachSelectionToChatAction` reads `activeTextEditorControl`, which is `undefined` for a webview-based `CustomTextEditorProvider`, so the built-in action silently does nothing and its menu entry never appears.
- The Feedback feature already proves the hard part: mapping rich-view block ordinals to exact source lines (`src/editor/feedbackAnchors.ts`).

**Pain points:**

- **No way to hand a selection to Copilot:** Users writing in the WYSIWYG view must switch to source view, select there, and use the built-in action — losing the WYSIWYG flow.
- **Line numbers matter:** Pasting raw text into chat loses the file/line anchor that makes Copilot answers actionable.

**Why it matters:**

- **AI-assisted writing is the top modern workflow.** Every mainstream editor surfaces "Add to Chat" on a selection; its absence is a visible gap.
- **Zero context switching:** The whole product thesis is "write markdown naturally" — asking users to leave the rich view contradicts it.

---

## 3. Desired Outcome & Scope

**Success criteria:**

- Right-clicking a selection in the WYSIWYG editor shows a context menu containing **"Add Selection to GitHub Copilot"**.
- Choosing it attaches a chip referencing the document at the **exact source lines containing the selection** (verified against source view).
- Works for paragraphs, headings, lists, tables, blockquotes, code blocks, and multi-block selections.
- When Copilot Chat is unavailable (or the document is untitled), a clipboard fallback with `path:startLine-endLine` + quoted selection is used and the user is informed.
- No regression to table/image/math-modal context menus, typing latency, or document sync.

**In scope:**

- Custom HTML context menu in the webview (Cut / Copy / Paste + separator + Copilot item)
- Selection → top-level block ordinals → exact source line range mapping
- Host action attaching file + line range to GitHub Copilot Chat
- Clipboard fallback + user messaging
- ~~Command Palette entry `markdownForHumans.addSelectionToCopilot`~~ **Removed again 2026-10-11 (user request):** the feature is available only from the editor context menu
- Docs (FAQ, User-Guide, README, CHANGELOG)

**Out of scope:**

- ~~Intra-block (character-precise) line narrowing~~ **Superseded 2026-10-11:** line-level narrowing within blocks is now in scope and shipped (see Decisions); character-precise column narrowing remains out of scope
- Default keyboard shortcut (VS Code's chat chord is taken; users may bind the command themselves)
- "Open Link" item for link right-clicks (native menu loss noted as follow-up)
- Real-time collaborative editing

---

## 4. UX & Behavior

**Entry points:**

- Right-click context menu in the WYSIWYG editor (the only entry point; the Command Palette entry was removed again on 2026-10-11 at the user's request)

**User flows:**

### Flow 1: Primary use case

1. User selects one or more paragraphs in the WYSIWYG editor.
2. User right-clicks the selection → custom context menu appears at the pointer.
3. User clicks **"Add Selection to GitHub Copilot"**.
4. Pending edits are flushed to the `TextDocument`; the selection is mapped to source lines.
5. GitHub Copilot Chat opens/focuses with a chip for `file.md` at `startLine–endLine`, input focused.

### Flow 2: Fallback

1. Same as above, but chat is unavailable or the document is untitled.
2. Clipboard receives `path:startLine-endLine` + the quoted selection; an info message explains the fallback.

**Behavior rules:**

- Menu item is **hidden when the selection is empty** (matches built-in `hasNonEmptySelection` gating).
- Right-click inside an existing selection preserves it; right-click outside moves the caret to the click point (mirrors the known first-click fix in `task-qa-0.4.1-findings.md`).
- Table / image / math-modal menus keep precedence over the new menu.
- Fail-closed anchor mapping (ambiguous markdown, e.g. three-space ordered lists) → attach a **whole-file chip without a range** + warning, keeping the primary value.
- All `async` paths are wrapped in try/catch; failures surface `showErrorMessage` and never break editing.

**Accessibility:**

- `role="menu"` / `role="menuitem"`, `tabindex`, Arrow Up/Down + Escape + Enter navigation (same contract as `imageMenu.ts`).

---

## 5. Technical Plan

**Surfaces:**

- Webview (TipTap editor): context menu DOM, selection → ordinals, message dispatch
- Extension host (VS Code API): line mapping, chat command, clipboard fallback

**Key changes:**

- `src/editor/copilotSelectionRange.ts` – **New.** Pure resolver: canonical blocks + raw markdown + ordinal range → `{startLine, endLine}`; plus `toChatAttachRange()` producing the 1-based internal `IRange` required by `attachFiles`.
- `src/editor/copilotChatAttach.ts` – **New.** Pure decision logic: mapping result + chat availability → action (`attach-with-range` / `attach-whole-file` / `clipboard`), plus clipboard text rendering.
- `src/editor/MarkdownEditorProvider.ts` – New `addSelectionToCopilot` message case + host handler; reuses `flushRendererAtDocumentBoundary` before reading `document.getText()`.
- `src/webview/features/textContextMenu.ts` – **New.** Custom context menu (Cut/Copy/Paste + Copilot item), modeled on `imageMenu.ts`.
- `src/webview/editor.ts` – Right-click interception + message bridge (`addSelectionToCopilot`, `requestClipboardText`, `clipboardText`).
- `src/webview/editor.css` – Menu styles beside `.image-context-menu`.
- `src/webview/features/feedbackDomCapture.ts`, `src/webview/extensions/imageEnterSpacing.ts` – Exclude the new menu from capture/Enter guards.
- `src/extension.ts`, `package.json` – Command Palette entry.

**Architecture notes:**

- Mapping is computed **on demand** from `document.getText()` after a flush barrier (never a frozen session map like Feedback).
- Reuses `buildFeedbackAnchorMap` + `mapFeedbackSelection` (`src/editor/feedbackAnchors.ts`) and `blockRelativeRangeFromPositions` (`src/webview/features/feedbackRenderedRange.ts`).
- Chat attach uses `workbench.action.chat.open` with `attachFiles: [{ uri, range }]` — the same internal call the built-in "Add Selection to Chat" makes. Feature-detected via `getCommands(true)`; undocumented but entrenched, so it degrades to the clipboard fallback.

**Performance considerations:**

- Menu opens <300ms; mapping runs only on the click path (no per-keystroke work).
- Anchor map build is O(document); acceptable on an explicit user action.

---

## 6. Work Breakdown

- [x] **Phase 1: Line-mapping core (TDD)** - Pure resolver + range conversion
  - [x] RED: failing tests in `src/__tests__/editor/copilotSelectionRange.test.ts`
  - [x] GREEN: `src/editor/copilotSelectionRange.ts`
- [x] **Phase 2: Host action + fallback (TDD)**
  - [x] RED: failing tests in `src/__tests__/editor/copilotChatAttach.test.ts`
  - [x] GREEN: `src/editor/copilotChatAttach.ts` + `MarkdownEditorProvider` handler
- [x] **Phase 3: Webview context menu**
  - [x] `src/webview/features/textContextMenu.ts`
  - [x] Wire `contextMenuHandler` + message bridge in `editor.ts`
  - [x] CSS + feedback/Enter-key exclusions
- [x] **Phase 4: Command Palette + docs**
  - [x] `package.json` + `src/extension.ts`
  - [x] FAQ, User-Guide, README, CHANGELOG
- [x] **Testing**
  - [x] Unit tests: resolver, range conversion, fallback decision logic
  - [x] Manual: real VS Code Extension Development Host checklist (see Verification)

---

## 7. Implementation Log

### 2026-10-11 – Plan created

- **What:** Research + plan. Confirmed `webview/context` exists as a native contribution point, but the user chose a custom HTML menu. Confirmed the Feedback anchor machinery maps block ordinals → exact source lines and can be reused. Confirmed `workbench.action.chat.open` + `attachFiles` reproduces the built-in chat chip.
- **Files:** this plan file
- **Notes:** `flushRendererAtDocumentBoundary` already provides the two-sided flush barrier needed before reading authoritative source text.

### 2026-10-11 – Implemented and verified

- **What:** Full feature implemented per plan (Phases 1–5).
- **Files:**
  - `src/editor/copilotSelectionRange.ts` (new) — resolver + `toChatAttachRange`
  - `src/editor/copilotChatAttach.ts` (new) — attach-vs-clipboard decision + fallback text
  - `src/editor/MarkdownEditorProvider.ts` — `addSelectionToCopilot` + `requestClipboardText` cases and handlers
  - `src/webview/features/textContextMenu.ts` (new) — custom context menu
  - `src/webview/features/copilotSelection.ts` (new) — selection → host message
  - `src/webview/editor.ts` — right-click wiring, message bridge, paste/cut/copy actions
  - `src/webview/editor.css` — `.text-context-menu` styles + feedback-state hiding
  - `src/webview/features/feedbackDomCapture.ts`, `src/webview/extensions/imageEnterSpacing.ts` — exclusions
  - `src/extension.ts`, `package.json` — Command Palette entry
  - Tests: `copilotSelectionRange.test.ts` (16), `copilotChatAttach.test.ts` (12), `copilotSelection.realEditor.test.ts` (3), `textContextMenu.test.ts` (8)
  - `test/integration/extensionHost.test.cjs` — 3 new native tests
  - Docs: `wiki/FAQ.md`, `wiki/User-Guide.md`, `wiki/Features.md`, `wiki/Keyboard-Shortcuts.md`, `README.md`, `CHANGELOG.md`
- **Notes:** Paste goes through a host clipboard round-trip (`requestClipboardText` → `clipboardText`) because webview clipboard reads are unreliable; it reuses `looksLikeMarkdown`/`markdownToHtml`/`parseFencedCode` so it behaves like a real paste.

### 2026-10-11 – Verification evidence

- **VS Code version:** 1.141.0 (Extension Development Host via `@vscode/test-cli`)
- **Worktree/build:** current worktree, `npm run build:release` bundle
- **Native results:** `npm run test:integration` → **11 passing, 0 failing**
  - `activates the bundled extension and registers its open command` (asserts `markdownForHumans.addSelectionToCopilot` is registered)
  - `runs the Copilot selection command without an active editor` (graceful, no throw)
  - `runs the Copilot selection command against an open custom editor` (posts the request, no throw)
  - `the built-in chat command accepts the file + line-range attachment shape` — **verifies the undocumented `workbench.action.chat.open` + `attachFiles` + 1-based `IRange` contract on this VS Code build**
  - plus the 7 pre-existing suite tests (custom editor open, split/reopen, SVG, feedback parity)
- **Unit tests:** 39 new tests pass; full suite has 6 pre-existing failures (locale number formatting in `wordCount`, filesystem fixtures in `feedbackSessionStore`/`feedbackProvider`/`feedbackReportV2`/`feedbackEvidenceV2.golden`/`imagePathResolution`) — confirmed pre-existing by stashing all changes and re-running.
- **Build:** `npm run build:release` + `npm run verify-build` → PASSED.
- **Lint:** `npm run lint` reports only pre-existing `prettier/prettier` CRLF errors across the whole repo (no `.gitattributes`, `core.autocrlf=true`); zero real lint issues in the new/changed files.
- **Remaining unverified (needs interactive UI):** the visual appearance of the menu, the actual chip rendering in the Copilot Chat input, and the clipboard fallback notification. These require a human-driven Extension Development Host session; the payload contract and command paths are covered natively above.

---

### 2026-10-11 – Exact selected lines (follow-up)

- **What:** User requested that only the selected lines be attached, not whole blocks. Added text-anchor line narrowing: `src/editor/copilotSelectionLines.ts` (pure: `extractSelectionAnchors`, `narrowCopilotLineRange`), optional `anchors` parameter on `resolveCopilotSelectionLineRange`, `selectionStartText`/`selectionEndText` in the webview message, host parses them via `parseCopilotSelectionAnchors`.
- **Files:** `src/editor/copilotSelectionLines.ts` (new), `src/editor/copilotSelectionRange.ts`, `src/editor/MarkdownEditorProvider.ts`, `src/webview/features/copilotSelection.ts`, `src/__tests__/editor/copilotSelectionLines.test.ts` (new, 16 tests), `src/__tests__/editor/copilotSelectionRange.test.ts` (+2), `src/__tests__/webview/copilotSelection.realEditor.test.ts` (anchors asserted), `wiki/User-Guide.md`, `wiki/Features.md`, `CHANGELOG.md`.
- **Notes:** Anchors match rendered text (link targets and Markdown/HTML syntax stripped on both sides), can span wrapped source lines, and degrade safely to whole-block lines when unlocatable. TDD: tests written and verified RED first.

### 2026-10-11 – Command Palette entry removed (follow-up)

- **What:** User requested the feature be reachable only via the editor context menu. Removed the `markdownForHumans.addSelectionToCopilot` contribution (`package.json`), its registration (`src/extension.ts`), the `requestAddSelectionToCopilot` webview message case (`src/webview/editor.ts`), and the two integration tests for it. The native test now asserts the command is _not_ registered; the chat `attachFiles` contract test stays (still used by the context-menu flow).
- **Files:** `package.json`, `src/extension.ts`, `src/webview/editor.ts`, `test/integration/extensionHost.test.cjs`, `wiki/FAQ.md`, `wiki/Features.md`, `wiki/Keyboard-Shortcuts.md`, `wiki/User-Guide.md`, `CHANGELOG.md`.
- **Notes:** The webview-side `requestAddSelectionToCopilot(editor)` helper is unchanged and still drives the context-menu action.

### 2026-10-11 – Multiple ranges per file (bugfix)

- **What:** Reported: a second range from a file that already had a chip attached never appeared in chat. Root cause (verified in `microsoft/vscode` `browser/attachments/chatAttachmentModel.ts`): chips are deduplicated by `id = uri.toString() + (range?.toString() ?? '')`, and a range object sent via `executeCommand` arrives as a plain object whose `toString()` is `'[object Object]'` for every range — so the second `addFile` was silently dropped (`addContext` filters existing ids). The built-in action avoids this with real `Range` instances (prototype `toString()`), which cannot cross the extension-host IPC boundary.
- **Fix:** Each chip now carries a per-range URI fragment (`L3-7`) as its identity: `src/editor/copilotChatAttach.ts` computes `fragment` per line range, the host attaches `document.uri.with({ fragment })` (keeps `value.range` intact so display and content slicing stay exact). Identical re-attachments dedupe naturally; different ranges get distinct chips.
- **Files:** `src/editor/copilotChatAttach.ts`, `src/editor/MarkdownEditorProvider.ts`, `src/__tests__/editor/copilotChatAttach.test.ts` (+2 tests), `test/integration/extensionHost.test.cjs` (fragment-URI resolution test + two-range chat attach), `wiki/User-Guide.md`, `wiki/FAQ.md`, `CHANGELOG.md`.
- **Notes:** Verified on real VS Code 1.141.0 that fragment URIs resolve to identical file content (`fs.stat`, `fs.readFile`, `openTextDocument`) and that `workbench.action.chat.open` accepts two same-file ranges with distinct fragments — this is the empirical gate for the identity trick.

### 2026-10-11 – Context menu reliability (bugfix)

- **What:** Two reported defects. (1) The menu sometimes showed only Paste/Select All despite a selection: `selectionContainsPoint` built a bounding box from the selection endpoint rects, which only spans the endpoints' columns — a right-click on a middle line of a multi-line selection fell outside it, and the handler then collapsed the selection itself. Replaced with document-position containment (`clickPos in [from, to]`, exported pure as `clickPreservesSelection`) plus a capture-phase `mousedown` snapshot so the pre-click selection survives any default handling before `contextmenu`. (2) Cut's icon never rendered: `codicon-scissors` does not exist in Codicons at all (verified against `microsoft/vscode-codicons` mapping.json and VS Code's own CSS). Cut now draws an inline SVG scissors; menu icons are spec'd as `iconClass` (must exist in the bundled `codicon.css`) or `svgIcon`.
- **Files:** `src/webview/features/textContextMenu.ts` (`clickPreservesSelection`, `textContextMenuItemSpecs`, SVG icon), `src/webview/editor.ts` (mousedown snapshot + selection restore), `src/webview/editor.css` (`.menu-icon-svg`), `src/__tests__/webview/textContextMenu.test.ts` (+7 tests incl. a regression test asserting every codicon class used by the menu is defined in the bundled stylesheet), `CHANGELOG.md`.
- **Notes:** The icon-availability test would have caught the missing scissors class; the multi-line middle-click case is pinned as a unit test on `clickPreservesSelection`.

### 2026-10-11 – Select All feedback (bugfix)

- **What:** Reported: after **Select All** the selection was invisible until the next right-click. The menu focuses its items for keyboard navigation, and ProseMirror does not sync the DOM selection into an unfocused view, so `selectAll()` changed `state.selection` without visible feedback; the next right-click refocused the editor and revealed it. Fix: `withEditorFocus` (exported from `textContextMenu.ts`) wraps every menu action so the editor is focused _before_ the action runs — visible selection feedback for Select All, and typing works immediately after Paste.
- **Files:** `src/webview/features/textContextMenu.ts` (`withEditorFocus`), `src/webview/editor.ts` (all five menu handlers wrapped), `src/__tests__/webview/textContextMenu.test.ts` (+2 tests pinning focus-before-action ordering), `CHANGELOG.md`.
- **Notes:** Focus restore happens only on menu _actions_, not on pointer-outside/blur dismissal, so clicking other VS Code UI never has focus stolen back.

### 2026-10-11 – Select All removed (follow-up)

- **What:** User requested Select All be removed from the right-click menu entirely (it duplicated the standard Ctrl+A editing behavior). Removed the `selectAll` action from `TextContextMenuAction`, the menu item, its handler in `editor.ts`, and the hidden-item separator heuristic (replaced by an explicit `separatorBefore` flag so the Copilot action still gets its own group). Also removed the now-obsolete "Select All feedback" changelog bullet and deleted the stale plan duplicate in `roadmap/pipeline/` (the commit `11ac042` had captured the pre-move copy).
- **Files:** `src/webview/features/textContextMenu.ts`, `src/webview/editor.ts`, `src/webview/editor.css`, `src/__tests__/webview/textContextMenu.test.ts`, `CHANGELOG.md`, `wiki/User-Guide.md`, deleted `roadmap/pipeline/task-add-selection-to-copilot.md`.
- **Notes:** Keyboard Ctrl+A remains standard editor behavior; only the menu entry is gone.

## 8. Decisions & Tradeoffs

- **Custom HTML menu** (user choice) over the native `webview/context` contribution point. Tradeoff: must reimplement Cut/Copy/Paste/Select All to avoid a UX regression; Paste goes through a host clipboard round-trip because webview clipboard reads are unreliable.
- **Whole top-level block granularity** (original choice, **superseded 2026-10-11**). Tradeoff: the attached range can be wider than the literal selection, but it is always _correct_ and matches the Feedback anchor guarantee. Intra-block precision is deliberately excluded.
- **Exact selected lines via text anchors** (2026-10-11, user request). The webview sends the first/last words of the selection as plain-text anchors; the host locates them inside the endpoint blocks' source spans (Markdown/HTML syntax stripped on both sides, matching across wrapped lines) and narrows the attached range to those lines. Longest-anchor-first with progressive shortening (12/8/5/3/2/1 words); a single-word anchor must be ≥5 chars or unique in the block; unlocatable anchors or inverted endpoints fall back to the whole-block span. Tradeoff: repeated phrases can misattribute a line in rare cases — the fallback keeps the range correct rather than wrong.
- **Chat chip via `workbench.action.chat.open` + `attachFiles`** (user choice). Tradeoff: internal command surface may change; mitigated by feature detection + clipboard fallback.
- **Fail-closed mapping degrades to a whole-file chip** rather than a clipboard-only fallback, so the primary "add to chat" value survives ambiguous markdown.
- **Context-menu only** (2026-10-11, user request, **supersedes the Command Palette entry**). The `markdownForHumans.addSelectionToCopilot` command was removed again, so there is no command and no keybinding; the action lives exclusively in the editor's right-click menu.
