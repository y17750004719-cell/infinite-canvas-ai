export function resolveStateUpdate(value, previousValue) {
  if (typeof value === 'function') {
    return value(previousValue);
  }

  return value;
}
