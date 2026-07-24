const SECRET_FIELD_TYPES = ['password', 'pin'];

export function isSecretFieldType(type) {
  return SECRET_FIELD_TYPES.includes(type);
}

/**
 * Computes the next `history` array for a field whose value is changing,
 * given the field's *previous* state (before the incoming update) and a
 * retention limit. Non-secret fields (anything but password/pin) never
 * accrue history - only the fields where a "what was this before"
 * lookup is actually sensitive/useful.
 * @param {Object} existingField the field as it was before this update
 * @param {number} limit max entries to retain (0 disables history)
 */
export function nextHistory(existingField, limit) {
  if (!isSecretFieldType(existingField.type)) {
    return existingField.history;
  }
  if (!limit || limit <= 0) {
    return [];
  }
  const entry = { value: existingField.value, changedAt: existingField.updatedAt };
  return [entry, ...(existingField.history || [])].slice(0, limit);
}
