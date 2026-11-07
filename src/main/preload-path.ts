/**
 * Absolute path to compiled preload script (dist/main/preload.js).
 */
import * as path from 'path';

export function preloadScriptPath(): string {
  return path.join(__dirname, 'preload.js');
}
