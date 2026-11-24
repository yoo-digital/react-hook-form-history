/** True on Apple platforms, where the shortcut modifier is ⌘ instead of Ctrl. */
export const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
export const modKey = isMac ? '⌘' : 'Ctrl';
export const shiftKey = isMac ? '⇧' : 'Shift';
