/**
 * Shared BrowserWindow options for tray utility windows.
 */
import { BrowserWindowConstructorOptions, WebPreferences } from 'electron';
import { appWindowIcon } from './app-icon';
import { preloadScriptPath } from './preload-path';

const defaultWebPreferences = {
  preload: preloadScriptPath(),
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: false
};

/** Defaults for settings / history / upload / unlock (and similar) windows. */
export function utilityWindowOptions(
  opts: BrowserWindowConstructorOptions = {}
): BrowserWindowConstructorOptions {
  return {
    icon: appWindowIcon(),
    skipTaskbar: true,
    ...opts,
    webPreferences: {
      ...defaultWebPreferences,
      ...opts.webPreferences,
      // Always force secure defaults even if caller passes overrides
      preload: opts.webPreferences?.preload ?? defaultWebPreferences.preload,
      nodeIntegration: false,
      contextIsolation: true
    }
  };
}

/** Secure webPreferences for capture overlays and other custom windows. */
export function secureWebPreferences(extra: WebPreferences = {}): WebPreferences {
  return {
    ...extra,
    preload: extra.preload ?? preloadScriptPath(),
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: false
  };
}
