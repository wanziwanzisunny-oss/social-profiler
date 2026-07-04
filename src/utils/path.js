export function basenameFromAnyPath(value) {
  return String(value || '').split(/[\\/]/).filter(Boolean).pop() || '';
}
