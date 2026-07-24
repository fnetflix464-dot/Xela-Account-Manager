const MAX_DIMENSION = 1920;
const JPEG_QUALITY = 0.8;

/**
 * Resizes/compresses an image File down to a bounded JPEG data URI
 * (longest side capped at MAX_DIMENSION, quality 0.8) so a user-chosen
 * background photo can't bloat the encrypted vault file - the settings
 * blob is stored as base64 alongside every other vault field, not as a
 * separate asset on disk.
 * @param {File} file
 * @returns {Promise<string>} a "data:image/jpeg;base64,..." URI
 */
export function resizeImageToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Selected file is not a readable image'));
      img.onload = () => {
        const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
