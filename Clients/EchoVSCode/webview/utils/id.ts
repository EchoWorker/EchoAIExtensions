/** uniqueId — generate a short unique ID with optional prefix. */
let counter = 0
export function uniqueId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${(counter++).toString(36)}`
}
