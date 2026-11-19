import { desktopCapturer, screen } from 'electron';
import {
  hideOverlaysForCapture,
  restoreOverlaysAfterCapture,
  sleep
} from './capture-session';

export async function captureScreenshot(areaData: any, sourceDisplayId?: number): Promise<Buffer> {
  const { x, y, width, height } = areaData;

  console.log(`📱 Capture area: ${x},${y} ${width}x${height} from display: ${sourceDisplayId}`);

  const displays = screen.getAllDisplays();
  let targetDisplay = displays[0];

  if (sourceDisplayId !== undefined) {
    const foundDisplay = displays.find((display) => display.id === sourceDisplayId);
    if (foundDisplay) {
      targetDisplay = foundDisplay;
    } else {
      console.warn(`Display with id ${sourceDisplayId} not found, using primary display`);
    }
  }

  console.log(`Target display:`, {
    id: targetDisplay.id,
    bounds: targetDisplay.bounds,
    scaleFactor: targetDisplay.scaleFactor
  });

  const dipRect = {
    x: targetDisplay.bounds.x + x,
    y: targetDisplay.bounds.y + y,
    width,
    height
  };
  const physRect = screen.dipToScreenRect(null, dipRect);

  console.log(`Physical capture rect:`, physRect);

  if (process.platform === 'win32') {
    try {
      await hideOverlaysForCapture();
      const { captureRegionGdi } = require('./gdi-capture') as typeof import('./gdi-capture');
      const png = captureRegionGdi(physRect.x, physRect.y, physRect.width, physRect.height);
      console.log(`✅ GDI capture ${physRect.width}x${physRect.height}`);
      return png;
    } catch (err) {
      console.warn('GDI capture failed, falling back to desktopCapturer:', err);
    }
  }

  if (process.platform === 'linux') {
    const linux = require('./linux-screen-capture') as typeof import('./linux-screen-capture');
    await hideOverlaysForCapture();
    try {
      if (linux.isWaylandSession()) {
        try {
          await sleep(170);
          const png = await linux.captureRegionLinux({ x, y, width, height }, targetDisplay, displays);
          console.log(`✅ Portal capture ${width}x${height}`);
          return png;
        } catch (err) {
          console.warn('Portal capture failed, falling back to desktopCapturer:', err);
        }
      }
      return await captureScreenshotDesktopCapturer(areaData, targetDisplay);
    } finally {
      await restoreOverlaysAfterCapture();
    }
  }

  // macOS (and any other desktopCapturer path): hide overlays so they are not in the frame
  // and so a subsequent clipboard write is not racing a fullscreen always-on-top window.
  await hideOverlaysForCapture();
  try {
    return await captureScreenshotDesktopCapturer(areaData, targetDisplay);
  } finally {
    await restoreOverlaysAfterCapture();
  }
}

export async function captureScreenshotDesktopCapturer(
  areaData: { x: number; y: number; width: number; height: number },
  targetDisplay: Electron.Display
): Promise<Buffer> {
  const { x, y, width, height } = areaData;

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(targetDisplay.bounds.width * targetDisplay.scaleFactor),
      height: Math.round(targetDisplay.bounds.height * targetDisplay.scaleFactor)
    }
  });

  if (sources.length === 0) {
    throw new Error('No screens found');
  }

  let screenSource = sources.find((source) => {
    const displayId = source.display_id || (source as any).id;
    return displayId === targetDisplay.id.toString();
  });

  if (!screenSource) {
    screenSource = sources[0];
    console.log('Using first available screen source');
  }

  if (!screenSource.thumbnail) {
    throw new Error('No thumbnail available');
  }

  const fullScreenshot = screenSource.thumbnail;
  const scaleFactor = targetDisplay.scaleFactor;
  const adjustedX = Math.round(x * scaleFactor);
  const adjustedY = Math.round(y * scaleFactor);
  const adjustedWidth = Math.round(width * scaleFactor);
  const adjustedHeight = Math.round(height * scaleFactor);

  const screenshotSize = fullScreenshot.getSize();
  const finalX = Math.max(0, Math.min(adjustedX, screenshotSize.width - 1));
  const finalY = Math.max(0, Math.min(adjustedY, screenshotSize.height - 1));
  const finalWidth = Math.max(1, Math.min(adjustedWidth, screenshotSize.width - finalX));
  const finalHeight = Math.max(1, Math.min(adjustedHeight, screenshotSize.height - finalY));

  const croppedImage = fullScreenshot.crop({
    x: finalX,
    y: finalY,
    width: finalWidth,
    height: finalHeight
  });

  return croppedImage.toPNG();
}

export async function captureWindowSource(sourceId: string): Promise<Buffer> {
  await hideOverlaysForCapture();
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 3840, height: 2160 },
    fetchWindowIcons: false
  });
  const source = sources.find((s) => s.id === sourceId);
  if (!source || !source.thumbnail || source.thumbnail.isEmpty()) {
    throw new Error('window_unavailable');
  }
  const size = source.thumbnail.getSize();
  if (size.width < 2 || size.height < 2) {
    throw new Error('window_unavailable');
  }
  return source.thumbnail.toPNG();
}
