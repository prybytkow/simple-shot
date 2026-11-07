import { Tray, Menu } from 'electron';
import { setupScreenCapture } from './screen-capture';
import { createTrayIcon } from './app-icon';

/** Legacy helper; main.ts owns the live tray. */
export function createTray(): Tray {
  const tray = new Tray(createTrayIcon());

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Capture Area',
      click: () => {
        setupScreenCapture();
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      role: 'quit'
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip('Screen Capture Tool');

  tray.on('click', () => {
    setupScreenCapture();
  });

  return tray;
}
