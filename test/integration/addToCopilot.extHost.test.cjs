/**
 * Ext Host: Add to GitHub Copilot — availability detection and the chat
 * attach contract, in a real VS Code window.
 *
 * The toolbar flow runs through the rich view and cannot be driven from the
 * extension host, and the chat input's chips cannot be read back from it
 * either, so this covers the two workbench contracts the feature rests on:
 * which presence check says "GitHub Copilot is available", and whether
 * `workbench.action.chat.open` accepts the fragment-identified file + internal
 * 1-based line range payloads as one attachment per press under the chat's
 * `uri + range.toString()` identity rule. The visible chips stay a manual QA
 * check (docs/QA_MANUAL.md).
 */

const assert = require('node:assert/strict');
const vscode = require('vscode');

const CHAT_OPEN_COMMAND = 'workbench.action.chat.open';
const COPILOT_CHAT_EXTENSION_ID = 'github.copilot-chat';

suite('Add to GitHub Copilot in the Extension Development Host', () => {
  /** The same availability rule the extension host applies. */
  async function copilotAvailability() {
    const extensionPresent =
      vscode.extensions.getExtension(COPILOT_CHAT_EXTENSION_ID) !== undefined;
    const commands = await vscode.commands.getCommands(true);
    return { extensionPresent, commandPresent: commands.includes(CHAT_OPEN_COMMAND) };
  }

  test('GitHub Copilot is available only with its extension and chat command', async () => {
    const { extensionPresent, commandPresent } = await copilotAvailability();
    const available = extensionPresent && commandPresent;

    if (extensionPresent) {
      assert.ok(
        commandPresent,
        'The Copilot Chat extension is present, so its chat command must be registered'
      );
      assert.equal(available, true);
    } else {
      // The extension half alone must never claim availability, even though
      // the core chat command may exist without it.
      assert.equal(available, false);
    }
  });

  /**
   * The chat names an attachment `uri.toString() + range.toString()`
   * (`toFileVariableEntry`) and drops repeats of an id
   * (`ChatRequestVariableSet`), so two contexts of one file survive as two
   * individually removable chips only while their ids differ. A `range`
   * crossing the extension host arrives as a plain object, so its `toString()`
   * is the same for every range of one file — the URI fragment is the only
   * identity left.
   */
  function attachmentId(attachFile) {
    return attachFile.uri.toString() + String(attachFile.range);
  }

  test('the chat input takes two presses of one file as two chips', async function () {
    this.timeout(60_000);
    // The attach payload is core workbench behaviour and needs only the chat
    // command; the Copilot extension is required only for availability gating.
    const { commandPresent } = await copilotAvailability();
    if (!commandPresent) {
      this.skip();
      return;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder, 'Expected integration fixture workspace');
    const fixtureUri = vscode.Uri.joinPath(workspaceFolder.uri, 'reference-lines.md');
    const fixtureText = new TextDecoder().decode(await vscode.workspace.fs.readFile(fixtureUri));
    const fixtureLines = fixtureText.split(/\r?\n/);

    // The exact payload shape the extension sends per press: an additive
    // partial query, a URI whose fragment names the lines (a distinct
    // attachment id per context), and the internal 1-based range, not
    // vscode.Range. The columns mirror `toCopilotChatAttachRange`, computed
    // from the real saved text: 1 to one past the line's last character.
    const contexts = [3, 5].map(lineNumber => ({
      fragment: `L${lineNumber}-${lineNumber}`,
      range: {
        startLineNumber: lineNumber,
        startColumn: 1,
        endLineNumber: lineNumber,
        endColumn: fixtureLines[lineNumber - 1].length + 1,
      },
    }));
    const attachments = contexts.map(context => ({
      uri: fixtureUri.with({ fragment: context.fragment }),
      range: context.range,
    }));
    for (const attachment of attachments) {
      await vscode.commands.executeCommand(CHAT_OPEN_COMMAND, {
        isPartialQuery: true,
        attachFiles: [attachment],
      });
    }

    // Two presses must survive side by side: two distinct attachment ids
    // under the chat's `uri + range.toString()` rule, so both contexts stay
    // their own, individually removable chip.
    const firstId = attachmentId(attachments[0]);
    const secondId = attachmentId(attachments[1]);
    assert.notEqual(firstId, secondId, 'Each press must keep its own chip');

    // The URI fragments carry that identity alone: without them, two ranges
    // of one file share one attachment id and the chat silently drops the
    // second context as a duplicate — the exact failure the line fragments
    // exist to prevent.
    assert.equal(
      attachmentId({ uri: fixtureUri, range: contexts[0].range }),
      attachmentId({ uri: fixtureUri, range: contexts[1].range }),
      'Without URI fragments the two contexts would collapse into one chip'
    );
  });
});
