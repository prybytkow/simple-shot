/**
 * Windows GDI screen capture (BitBlt).
 * Avoids Chromium desktopCapturer / DXGI color shifts on wide-gamut and HDR displays.
 */
import { nativeImage } from 'electron';
import koffi from 'koffi';

const SRCCOPY = 0x00cc0020;
const CAPTUREBLT = 0x40000000;
const DIB_RGB_COLORS = 0;
const BI_RGB = 0;

const user32 = koffi.load('user32.dll');
const gdi32 = koffi.load('gdi32.dll');

const GetDC = user32.func('void * __stdcall GetDC(void * hWnd)');
const ReleaseDC = user32.func('int __stdcall ReleaseDC(void * hWnd, void * hDC)');
const CreateCompatibleDC = gdi32.func('void * __stdcall CreateCompatibleDC(void * hdc)');
const CreateCompatibleBitmap = gdi32.func('void * __stdcall CreateCompatibleBitmap(void * hdc, int cx, int cy)');
const SelectObject = gdi32.func('void * __stdcall SelectObject(void * hdc, void * h)');
const BitBlt = gdi32.func(
  'int __stdcall BitBlt(void * hdc, int x, int y, int cx, int cy, void * hdcSrc, int x1, int y1, uint32 rop)'
);
const DeleteObject = gdi32.func('int __stdcall DeleteObject(void * ho)');
const DeleteDC = gdi32.func('int __stdcall DeleteDC(void * hdc)');
const GetDIBits = gdi32.func(
  'int __stdcall GetDIBits(void * hdc, void * hbm, uint32 start, uint32 lines, void * bits, void * bmi, uint32 usage)'
);

/**
 * Capture a region in physical (screen) pixels and return a PNG buffer.
 */
export function captureRegionGdi(x: number, y: number, width: number, height: number): Buffer {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const sx = Math.round(x);
  const sy = Math.round(y);

  const hdcScreen = GetDC(null);
  if (!hdcScreen) {
    throw new Error('GetDC failed');
  }

  const hdcMem = CreateCompatibleDC(hdcScreen);
  const hBitmap = CreateCompatibleBitmap(hdcScreen, w, h);
  if (!hdcMem || !hBitmap) {
    if (hBitmap) DeleteObject(hBitmap);
    if (hdcMem) DeleteDC(hdcMem);
    ReleaseDC(null, hdcScreen);
    throw new Error('CreateCompatibleDC/Bitmap failed');
  }

  const hOld = SelectObject(hdcMem, hBitmap);
  const bltOk = BitBlt(hdcMem, 0, 0, w, h, hdcScreen, sx, sy, SRCCOPY | CAPTUREBLT);

  // BITMAPINFOHEADER (40 bytes), biHeight < 0 => top-down BGRA
  const bmi = Buffer.alloc(40);
  bmi.writeUInt32LE(40, 0);
  bmi.writeInt32LE(w, 4);
  bmi.writeInt32LE(-h, 8);
  bmi.writeUInt16LE(1, 12);
  bmi.writeUInt16LE(32, 14);
  bmi.writeUInt32LE(BI_RGB, 16);

  const pixels = Buffer.alloc(w * h * 4);
  const lines = bltOk ? GetDIBits(hdcMem, hBitmap, 0, h, pixels, bmi, DIB_RGB_COLORS) : 0;

  SelectObject(hdcMem, hOld);
  DeleteObject(hBitmap);
  DeleteDC(hdcMem);
  ReleaseDC(null, hdcScreen);

  if (!bltOk || lines === 0) {
    throw new Error('BitBlt/GetDIBits failed');
  }

  // GDI often leaves alpha as 0 — make fully opaque for PNG
  for (let i = 3; i < pixels.length; i += 4) {
    pixels[i] = 255;
  }

  return nativeImage.createFromBitmap(pixels, { width: w, height: h }).toPNG();
}
