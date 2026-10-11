/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

/**
 * Text Context Menu Component
 *
 * Right-click menu for the rich editor body, mirroring the familiar editor
 * context menu:
 * - Cut / Copy / Paste
 * - Add Selection to GitHub Copilot
 *
 * The menu is keyboard navigable (Arrow keys, Home/End, Enter/Space, Escape)
 * and dismisses on outside click, scroll, resize, or blur.
 */

/** Actions the menu can trigger. The host wires these to editor commands. */
export type TextContextMenuAction = 'cut' | 'copy' | 'paste' | 'addToCopilot';

/** Callbacks invoked when the user picks a menu item. */
export type TextContextMenuHandlers = Record<TextContextMenuAction, () => void>;

export interface TextContextMenuItemSpec {
  action: TextContextMenuAction;
  label: string;
  /** Codicon class (e.g. `codicon-copy`) — must exist in the bundled stylesheet. */
  iconClass?: string;
  /** Inline SVG markup for icons the Codicons font does not provide. */
  svgIcon?: string;
  /** Hidden entirely (not just disabled) when false. */
  visible: boolean;
  /** Disabled but still listed when false. */
  enabled: boolean;
  /** Render a separator before this item (when the menu is not empty). */
  separatorBefore?: boolean;
}

/**
 * Scissors mark for Cut. Codicons ships no scissors glyph (verified against
 * microsoft/vscode-codicons), so the icon is drawn inline instead of leaving
 * an empty icon slot.
 */
const CUT_SVG_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" ' +
  'stroke-width="1.33" stroke-linecap="round" aria-hidden="true">' +
  '<circle cx="4" cy="4" r="2"/><circle cx="4" cy="12" r="2"/>' +
  '<path d="M13.3 2.7 5.4 10.6"/><path d="M9.7 9.7 13.3 13.3"/><path d="M5.4 5.4 8 8"/></svg>';

/** Selection bounds captured at the moment of a right-click. */
export interface TextContextMenuSelection {
  from: number;
  to: number;
  empty: boolean;
}

/**
 * Whether a right-click at the given document position must keep the current
 * selection, so Cut/Copy and the Copilot action stay available.
 *
 * Position containment is deliberate: a bounding box built from the selection
 * endpoint rects only spans the endpoints' columns and misclassifies clicks on
 * middle lines of multi-line selections as outside, which collapses the
 * selection before the menu opens.
 *
 * @param selection - Selection at the time of the right-click
 * @param clickPos - Document position under the pointer, or `null` when unknown
 */
export function clickPreservesSelection(
  selection: TextContextMenuSelection,
  clickPos: number | null
): boolean {
  return (
    !selection.empty &&
    selection.from < selection.to &&
    clickPos !== null &&
    clickPos >= selection.from &&
    clickPos <= selection.to
  );
}

/**
 * Wrap a menu action so the editor is focused while the action runs.
 *
 * The menu takes focus for keyboard navigation, and ProseMirror does not sync
 * the DOM selection into an unfocused view — actions with visible selection
 * feedback (like Paste's new caret position) must run with the editor focused,
 * otherwise their result stays invisible until the editor regains focus.
 *
 * @param editor - Live TipTap editor
 * @param action - Menu action to run after focusing
 * @returns Handler ready for {@link TextContextMenuHandlers}
 */
export function withEditorFocus(
  editor: { commands: { focus: () => unknown } },
  action: () => void
): () => void {
  return () => {
    editor.commands.focus();
    action();
  };
}

// Gap kept between the menu and the viewport edges when clamping.
const MENU_VIEWPORT_MARGIN_PX = 8;

let activeMenu: HTMLElement | null = null;
let activeCleanup: (() => void) | null = null;

/** Whether the text context menu is currently open. */
export function isTextContextMenuOpen(): boolean {
  return activeMenu !== null;
}

/**
 * Build the menu element. It is created once and reused; item visibility is
 * refreshed on every {@link showTextContextMenu}.
 */
export function createTextContextMenu(): HTMLElement {
  const menu = document.createElement('div');
  menu.className = 'text-context-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Editor actions');
  menu.style.display = 'none';
  // Mounted on the body, outside the ProseMirror DOM, so interacting with the
  // menu never moves the editor caret or disturbs the selection it acts on.
  document.body.appendChild(menu);
  return menu;
}

/**
 * Show the menu at viewport coordinates.
 *
 * @param menu - Element from {@link createTextContextMenu}
 * @param clientX - Pointer X in viewport coordinates
 * @param clientY - Pointer Y in viewport coordinates
 * @param hasSelection - Whether the editor currently has a non-empty selection
 * @param handlers - Callbacks for each menu action
 */
export function showTextContextMenu(
  menu: HTMLElement,
  clientX: number,
  clientY: number,
  hasSelection: boolean,
  handlers: TextContextMenuHandlers
): void {
  hideTextContextMenu(menu);

  const items = textContextMenuItemSpecs(hasSelection);
  renderItems(menu, items, handlers);

  menu.style.display = 'block';
  menu.style.visibility = 'hidden';
  positionMenu(menu, clientX, clientY);
  menu.style.visibility = '';

  activeMenu = menu;
  activeCleanup = installDismissHandlers(menu);

  focusFirstEnabledItem(menu);
}

/** Hide the menu and detach its dismissal handlers. */
export function hideTextContextMenu(menu: HTMLElement): void {
  menu.style.display = 'none';
  if (activeCleanup) {
    activeCleanup();
    activeCleanup = null;
  }
  if (activeMenu === menu) {
    activeMenu = null;
  }
}

/** The menu's item layout, exported so tests can verify labels and icons. */
export function textContextMenuItemSpecs(hasSelection: boolean): TextContextMenuItemSpec[] {
  return [
    {
      action: 'cut',
      label: 'Cut',
      svgIcon: CUT_SVG_ICON,
      visible: hasSelection,
      enabled: hasSelection,
    },
    {
      action: 'copy',
      label: 'Copy',
      iconClass: 'codicon-copy',
      visible: hasSelection,
      enabled: hasSelection,
    },
    {
      action: 'paste',
      label: 'Paste',
      iconClass: 'codicon-clippy',
      visible: true,
      enabled: true,
    },
    {
      action: 'addToCopilot',
      label: 'Add Selection to GitHub Copilot',
      iconClass: 'codicon-copilot',
      visible: hasSelection,
      enabled: hasSelection,
      separatorBefore: true,
    },
  ];
}

function renderItems(
  menu: HTMLElement,
  items: TextContextMenuItemSpec[],
  handlers: TextContextMenuHandlers
): void {
  menu.textContent = '';

  for (const item of items) {
    if (!item.visible) {
      continue;
    }
    if (item.separatorBefore && menu.childElementCount > 0) {
      menu.appendChild(createSeparator());
    }
    menu.appendChild(createMenuItem(item, handlers));
  }
}

function createSeparator(): HTMLElement {
  const separator = document.createElement('div');
  separator.className = 'menu-separator';
  separator.setAttribute('role', 'separator');
  return separator;
}

function createMenuItem(
  item: TextContextMenuItemSpec,
  handlers: TextContextMenuHandlers
): HTMLElement {
  const element = document.createElement('div');
  element.className = item.enabled ? 'menu-item' : 'menu-item menu-item-disabled';
  element.setAttribute('role', 'menuitem');
  element.setAttribute('tabindex', item.enabled ? '0' : '-1');
  element.setAttribute('data-action', item.action);
  if (!item.enabled) {
    element.setAttribute('aria-disabled', 'true');
  }

  const icon = document.createElement('span');
  icon.className = item.svgIcon
    ? 'menu-icon menu-icon-svg'
    : `codicon ${item.iconClass ?? ''} menu-icon`;
  icon.setAttribute('aria-hidden', 'true');
  if (item.svgIcon) {
    icon.innerHTML = item.svgIcon;
  }

  const label = document.createElement('span');
  label.className = 'menu-label';
  label.textContent = item.label;

  element.appendChild(icon);
  element.appendChild(label);

  if (item.enabled) {
    element.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const menu = element.closest('.text-context-menu') as HTMLElement | null;
      if (menu) hideTextContextMenu(menu);
      handlers[item.action]();
    });
  }

  return element;
}

function positionMenu(menu: HTMLElement, clientX: number, clientY: number): void {
  const menuWidth = menu.offsetWidth;
  const menuHeight = menu.offsetHeight;
  const margin = MENU_VIEWPORT_MARGIN_PX;

  const maxLeft = Math.max(margin, window.innerWidth - margin - menuWidth);
  const maxTop = Math.max(margin, window.innerHeight - margin - menuHeight);

  menu.style.left = `${Math.round(Math.min(Math.max(clientX, margin), maxLeft))}px`;
  menu.style.top = `${Math.round(Math.min(Math.max(clientY, margin), maxTop))}px`;
}

function enabledItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>('.menu-item:not(.menu-item-disabled)'));
}

function focusFirstEnabledItem(menu: HTMLElement): void {
  const items = enabledItems(menu);
  if (items.length > 0) {
    items[0].focus();
  } else {
    menu.focus();
  }
}

function installDismissHandlers(menu: HTMLElement): () => void {
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      hideTextContextMenu(menu);
      return;
    }

    const items = enabledItems(menu);
    if (items.length === 0) return;

    const currentIndex = items.findIndex(item => item === document.activeElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[currentIndex < items.length - 1 ? currentIndex + 1 : 0].focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[currentIndex > 0 ? currentIndex - 1 : items.length - 1].focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0].focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1].focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      const focused = document.activeElement as HTMLElement | null;
      if (focused && menu.contains(focused)) {
        event.preventDefault();
        focused.click();
      }
    }
  };

  const handlePointerDown = (event: MouseEvent) => {
    if (!menu.contains(event.target as Node)) {
      hideTextContextMenu(menu);
    }
  };

  const handleDismiss = () => hideTextContextMenu(menu);

  document.addEventListener('keydown', handleKeyDown, true);
  document.addEventListener('mousedown', handlePointerDown, true);
  document.addEventListener('contextmenu', handlePointerDown, true);
  window.addEventListener('resize', handleDismiss);
  window.addEventListener('blur', handleDismiss);
  document.addEventListener('scroll', handleDismiss, true);

  return () => {
    document.removeEventListener('keydown', handleKeyDown, true);
    document.removeEventListener('mousedown', handlePointerDown, true);
    document.removeEventListener('contextmenu', handlePointerDown, true);
    window.removeEventListener('resize', handleDismiss);
    window.removeEventListener('blur', handleDismiss);
    document.removeEventListener('scroll', handleDismiss, true);
  };
}