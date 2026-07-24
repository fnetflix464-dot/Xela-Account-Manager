/**
 * Copies text to the clipboard and, after `clearSeconds` (0 or falsy
 * disables auto-clear), clears the clipboard again - but only if it
 * still contains exactly what we copied, so a manual copy the user makes
 * in the meantime is never clobbered.
 * @param {string} text
 * @param {number} clearSeconds
 */
export function copyWithAutoClear(text, clearSeconds) {
  const value = text || '';
  navigator.clipboard.writeText(value);
  if (!clearSeconds || clearSeconds <= 0) return;

  setTimeout(async () => {
    try {
      const current = await navigator.clipboard.readText();
      if (current === value) {
        await navigator.clipboard.writeText('');
      }
    } catch {
      // Reading the clipboard can fail if the window lost focus/permission
      // in the meantime - safe to ignore, nothing to clear in that case.
    }
  }, clearSeconds * 1000);
}
