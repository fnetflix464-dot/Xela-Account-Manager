import { getCurrentWindow } from '@tauri-apps/api/window';

const appWindow = getCurrentWindow();

// data-tauri-drag-region's own hit-testing proved unreliable in practice
// (drag only fired directly over rendered text, not elsewhere within the
// same tagged element) despite verifying its DOM attributes, algorithm,
// and permissions were all correct - calling startDragging() ourselves
// from a real React mousedown handler sidesteps whatever quirk that was.
const INTERACTIVE_SELECTOR = 'button, a, input, select, textarea, [role="button"], [role="link"]';

export function startWindowDrag(e) {
  if (e.button !== 0) return;
  if (e.target.closest(INTERACTIVE_SELECTOR)) return;
  e.preventDefault();
  if (e.detail === 2) {
    appWindow.toggleMaximize();
  } else {
    appWindow.startDragging();
  }
}
