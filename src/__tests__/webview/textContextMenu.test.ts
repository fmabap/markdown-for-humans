/** @jest-environment jsdom */

/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
    clickPreservesSelection,
    createTextContextMenu,
    hideTextContextMenu,
    isTextContextMenuOpen,
    showTextContextMenu,
    textContextMenuItemSpecs,
    withEditorFocus,
    type TextContextMenuHandlers,
} from '../../webview/features/textContextMenu';

function createHandlers(): jest.Mocked<TextContextMenuHandlers> {
    return {
        cut: jest.fn(),
        copy: jest.fn(),
        paste: jest.fn(),
        addToCopilot: jest.fn(),
    };
}

function itemLabels(menu: HTMLElement): string[] {
    return Array.from(menu.querySelectorAll('.menu-label')).map(node => node.textContent ?? '');
}

describe('textContextMenu', () => {
    afterEach(() => document.body.replaceChildren());

    it('mounts itself on the document body', () => {
        const menu = createTextContextMenu();
        expect(document.body.contains(menu)).toBe(true);
    });

    it('shows the Copilot action only when there is a selection', () => {
        const menu = createTextContextMenu();

        showTextContextMenu(menu, 10, 10, true, createHandlers(), { copilotAvailable: true });
        expect(itemLabels(menu)).toContain('Add Selection to GitHub Copilot');
        hideTextContextMenu(menu);

        showTextContextMenu(menu, 10, 10, false, createHandlers(), { copilotAvailable: true });
        expect(itemLabels(menu)).not.toContain('Add Selection to GitHub Copilot');
        expect(itemLabels(menu)).toContain('Paste');
    });

    it('hides the Copilot action when GitHub Copilot is unavailable', () => {
        const menu = createTextContextMenu();

        showTextContextMenu(menu, 10, 10, true, createHandlers(), { copilotAvailable: false });

        // Tools without GitHub Copilot (e.g. some VS Code forks) must not show
        // the action at all — and must not surface any error either.
        expect(itemLabels(menu)).not.toContain('Add Selection to GitHub Copilot');
        expect(itemLabels(menu)).toContain('Cut');
        expect(itemLabels(menu)).toContain('Paste');
        hideTextContextMenu(menu);

        const copilotSpec = textContextMenuItemSpecs(true, false).find(
            item => item.action === 'addToCopilot'
        );
        expect(copilotSpec?.visible).toBe(false);
    });

    it('hides Cut and Copy when there is no selection', () => {
        const menu = createTextContextMenu();

        showTextContextMenu(menu, 10, 10, false, createHandlers());
        expect(itemLabels(menu)).not.toContain('Cut');
        expect(itemLabels(menu)).not.toContain('Copy');
    });

    it('invokes the matching handler and closes on item click', () => {
        const menu = createTextContextMenu();
        const handlers = createHandlers();

        showTextContextMenu(menu, 10, 10, true, handlers, { copilotAvailable: true });
        const copilotItem = menu.querySelector('[data-action="addToCopilot"]') as HTMLElement;
        copilotItem.click();

        expect(handlers.addToCopilot).toHaveBeenCalledTimes(1);
        expect(isTextContextMenuOpen()).toBe(false);
    });

    it('closes on Escape', () => {
        const menu = createTextContextMenu();
        showTextContextMenu(menu, 10, 10, true, createHandlers());

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        expect(isTextContextMenuOpen()).toBe(false);
    });

    it('closes on an outside pointer press', () => {
        const menu = createTextContextMenu();
        showTextContextMenu(menu, 10, 10, true, createHandlers());

        document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

        expect(isTextContextMenuOpen()).toBe(false);
    });

    it('keeps the menu open when pressing inside it', () => {
        const menu = createTextContextMenu();
        showTextContextMenu(menu, 10, 10, true, createHandlers());

        menu.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

        expect(isTextContextMenuOpen()).toBe(true);
        hideTextContextMenu(menu);
    });

    it('clamps the menu inside the viewport', () => {
        const menu = createTextContextMenu();
        showTextContextMenu(menu, 10000, 10000, true, createHandlers());

        const left = parseInt(menu.style.left, 10);
        const top = parseInt(menu.style.top, 10);
        expect(left).toBeLessThanOrEqual(window.innerWidth);
        expect(top).toBeLessThanOrEqual(window.innerHeight);
    });
});

describe('clickPreservesSelection', () => {
    it('keeps the selection when the click is inside it', () => {
        expect(clickPreservesSelection({ from: 10, to: 50, empty: false }, 30)).toBe(true);
    });

    it('keeps the selection at its inclusive boundaries', () => {
        expect(clickPreservesSelection({ from: 10, to: 50, empty: false }, 10)).toBe(true);
        expect(clickPreservesSelection({ from: 10, to: 50, empty: false }, 50)).toBe(true);
    });

    it('keeps multi-line selections on middle lines beyond the endpoint columns', () => {
        // Regression: an endpoint bounding box only covers the x-range of the
        // first and last selection rects. A click on a middle line of a
        // multi-line selection can sit outside that box while being well
        // inside the selection, which used to collapse the selection and strip
        // Cut/Copy from the menu.
        expect(clickPreservesSelection({ from: 10, to: 500, empty: false }, 420)).toBe(true);
        expect(clickPreservesSelection({ from: 10, to: 500, empty: false }, 80)).toBe(true);
    });

    it('moves the caret when the click is outside the selection', () => {
        expect(clickPreservesSelection({ from: 10, to: 50, empty: false }, 60)).toBe(false);
        expect(clickPreservesSelection({ from: 10, to: 50, empty: false }, 5)).toBe(false);
    });

    it('never preserves an empty selection or an unknown click position', () => {
        expect(clickPreservesSelection({ from: 10, to: 10, empty: true }, 10)).toBe(false);
        expect(clickPreservesSelection({ from: 10, to: 50, empty: false }, null)).toBe(false);
    });
});

describe('menu icons', () => {
    it('uses only icon classes defined in the bundled codicon stylesheet', () => {
        const css = readFileSync(join(__dirname, '../../webview/codicon.css'), 'utf8');
        const defined = new Set(
            Array.from(css.matchAll(/\.(codicon-[a-z0-9-]+):before/g), match => match[1])
        );
        const referenced = textContextMenuItemSpecs(true, true)
            .map(item => item.iconClass)
            .filter((iconClass): iconClass is string => typeof iconClass === 'string');

        expect(referenced.length).toBeGreaterThan(0);
        for (const iconClass of referenced) {
            expect(defined).toContain(iconClass);
        }
    });

    it('renders an inline SVG icon for Cut because Codicons has no scissors glyph', () => {
        const menu = createTextContextMenu();
        showTextContextMenu(menu, 10, 10, true, createHandlers());

        expect(menu.querySelector('[data-action="cut"] svg')).not.toBeNull();
        expect(menu.querySelector('[data-action="cut"] .codicon')).toBeNull();
        hideTextContextMenu(menu);
    });
});

describe('withEditorFocus', () => {
    it('focuses the editor before running the menu action', () => {
        const order: string[] = [];
        const editor = {
            commands: {
                focus: () => {
                    order.push('focus');
                },
            },
        };

        withEditorFocus(editor, () => {
            order.push('action');
        })();

        // ProseMirror does not sync the DOM selection into an unfocused view,
        // so menu actions with visible feedback must run with the editor
        // focused or their result stays invisible until the editor refocuses.
        expect(order).toEqual(['focus', 'action']);
    });

    it('runs exactly one focus per invocation', () => {
        const focus = jest.fn();
        const action = jest.fn();
        const handler = withEditorFocus({ commands: { focus } }, action);

        handler();
        handler();

        expect(focus).toHaveBeenCalledTimes(2);
        expect(action).toHaveBeenCalledTimes(2);
    });
});