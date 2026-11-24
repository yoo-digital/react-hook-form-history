import { useEffect, type RefObject } from 'react';

/**
 * Binds Mod+Z (undo) and Mod+Shift+Z / Ctrl+Y (redo) inside `ref`.
 * Overrides the browser's per-input undo so the whole form is undone consistently.
 */
export function useUndoRedoHotkeys(
  ref: RefObject<HTMLElement | null>,
  { undo, redo }: { undo: () => void; redo: () => void },
): void {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === 'z' && event.shiftKey) || (key === 'y' && event.ctrlKey)) {
        event.preventDefault();
        redo();
      }
    };

    element.addEventListener('keydown', onKeyDown);
    return (): void => element.removeEventListener('keydown', onKeyDown);
  }, [ref, undo, redo]);
}
