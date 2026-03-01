import { Tray, Menu, nativeImage } from 'electron';
import * as path from 'path';
import { setupScreenCapture } from './screen-capture';

export function createTray(): Tray {
  
  const iconPath = path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  const tray = new Tray(icon);
  
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