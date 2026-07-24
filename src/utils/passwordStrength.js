// Pure, local heuristic - runs entirely in the renderer so the password
// being typed never needs to cross the IPC boundary just to be scored.
export function calculatePasswordStrength(password) {
  if (!password) return '';

  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (password.length >= 16) score += 1;
  if (/[a-z]/.test(password)) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^a-zA-Z0-9]/.test(password)) score += 1;

  if (score <= 2) return 'Weak';
  if (score <= 3) return 'Fair';
  if (score <= 4) return 'Good';
  if (score <= 5) return 'Strong';
  return 'Very Strong';
}
