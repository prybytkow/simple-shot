import { CaptureMode } from './settings-store';
import {
  isCaptureOverlayOpen,
  isCaptureSessionOpen,
  closeAllCaptureWindows
} from './capture-session';
import {
  setupScreenCapture,
  openFixedAnnotation,
  openHistoryReedit,
  type SetupScreenCaptureOptions
} from './capture-windows';
import { registerCaptureIpc } from './capture-ipc';

export type { CaptureMode };
export type { SetupScreenCaptureOptions };

export {
  isCaptureOverlayOpen,
  isCaptureSessionOpen,
  openFixedAnnotation,
  openHistoryReedit,
  setupScreenCapture,
  closeAllCaptureWindows
};

registerCaptureIpc();
