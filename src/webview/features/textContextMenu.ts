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
 * - Cut / Copy / Paste / Select All
 * - Add Selection to GitHub Copilot
 *
 * The menu is keyboard navigable (Arrow keys, Home/End, Enter/Space, Escape)
 * and dismisses on outside click, scroll, resize, or blur.
 */

/** Actions the menu can trigger. The host wires these to editor commands. */
export type TextContextMenuAction = 'cut' | 'copy' | 'paste' | 'selectAll' | 'addToCopilot';

/** Callbacks invoked when the user picks a menu item. */
export type TextContextMenuHandlers = Record<TextContextMenuAction, () => void>;

interface MenuItemSpec {
  action: TextContextMenuAction;
  label: string;
  icon: string;
  /** Hidden entirely (not just disabled) when false. */
  visible: boolean;
  /** Disabled but still listed when false. */
  enabled: boolean;
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

  const items = buildItems(hasSelection);
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

function buildItems(hasSelection: boolean): MenuItemSpec[] {
  return [
    {
      action: 'cut',
      label: 'Cut',
      icon: 'codicon-scissors',
      visible: hasSelection,
      enabled: hasSelection,
    },
    {
      action: 'copy',
      label: 'Copy',
      icon: 'codicon-copy',
      visible: hasSelection,
      enabled: hasSelection,
    },
    { action: 'paste', label: 'Paste', icon: 'codicon-clippy', visible: true, enabled: true },
    {
      action: 'selectAll',
      label: 'Select All',
      icon: 'codicon-selection',
      visible: true,
      enabled: true,
    },
    {
      action: 'addToCopilot',
      label: 'Add Selection to GitHub Copilot',
      icon: 'codicon-copilot',
      visible: hasSelection,
      enabled: hasSelection,
    },
  ];
}

function renderItems(
  menu: HTMLElement,
  items: MenuItemSpec[],
  handlers: TextContextMenuHandlers
): void {
  menu.textContent = '';

  let separatorPending = false;
  for (const item of items) {
    if (!item.visible) {
      // A hidden item still reserves its separator slot so the Copilot action
      // keeps its own group once a selection exists.
      separatorPending = true;
      continue;
    }
    if (separatorPending && menu.childElementCount > 0) {
      menu.appendChild(createSeparator());
    }
    separatorPending = false;
    menu.appendChild(createMenuItem(item, handlers));
  }
}

function createSeparator(): HTMLElement {
  const separator = document.createElement('div');
  separator.className = 'menu-separator';
  separator.setAttribute('role', 'separator');
  return separator;
}

function createMenuItem(item: MenuItemSpec, handlers: TextContextMenuHandlers): HTMLElement {
  const element = document.createElement('div');
  element.className = item.enabled ? 'menu-item' : 'menu-item menu-item-disabled';
  element.setAttribute('role', 'menuitem');
  element.setAttribute('tabindex', item.enabled ? '0' : '-1');
  element.setAttribute('data-action', item.action);
  if (!item.enabled) {
    element.setAttribute('aria-disabled', 'true');
  }

  const icon = document.createElement('span');
  icon.className = `codicon ${item.icon} menu-icon`;
  icon.setAttribute('aria-hidden', 'true');

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