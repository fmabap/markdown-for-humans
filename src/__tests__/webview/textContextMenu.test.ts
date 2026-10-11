/** @jest-environment jsdom */

/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

import {
    createTextContextMenu,
    hideTextContextMenu,
    isTextContextMenuOpen,
    showTextContextMenu,
    type TextContextMenuHandlers,
} from '../../webview/features/textContextMenu';

function createHandlers(): jest.Mocked<TextContextMenuHandlers> {
    return {
        cut: jest.fn(),
        copy: jest.fn(),
        paste: jest.fn(),
        selectAll: jest.fn(),
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

        showTextContextMenu(menu, 10, 10, true, createHandlers());
        expect(itemLabels(menu)).toContain('Add Selection to GitHub Copilot');
        hideTextContextMenu(menu);

        showTextContextMenu(menu, 10, 10, false, createHandlers());
        expect(itemLabels(menu)).not.toContain('Add Selection to GitHub Copilot');
        expect(itemLabels(menu)).toContain('Paste');
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

        showTextContextMenu(menu, 10, 10, true, handlers);
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