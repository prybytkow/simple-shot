/**
 * Generate platform icons from assets/icon.png:
 * - assets/icon.icns (macOS)
 * - assets/iconTemplate.png (macOS menu bar template, 32×32 monochrome)
 * - build/icons/{size}x{size}.png (Linux / electron-builder)
 *
 * Run: npm run icons
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const png2icons = require('png2icons');

const root = path.join(__dirname, '..');
const srcPng = path.join(root, 'assets', 'icon.png');
const linuxSizes = [16, 32, 48, 64, 128, 256, 512];

function mkdirRecursive(dir) {
  if (fs.existsSync(dir)) return;
  mkdirRecursive(path.dirname(dir));
  fs.mkdirSync(dir);
}

async function main() {
  if (!fs.existsSync(srcPng)) {
    console.error('Missing assets/icon.png');
    process.exit(1);
  }

  const input = fs.readFileSync(srcPng);

  // macOS .icns
  const icns = png2icons.createICNS(input, png2icons.BILINEAR, 0);
  if (!icns) {
    console.error('Failed to create icon.icns');
    process.exit(1);
  }
  const icnsPath = path.join(root, 'assets', 'icon.icns');
  fs.writeFileSync(icnsPath, icns);
  console.log('Wrote', path.relative(root, icnsPath));

  // macOS tray template: black silhouette with alpha (32×32)
  const templatePath = path.join(root, 'assets', 'iconTemplate.png');
  const { data, info } = await sharp(input)
    .resize(32, 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    // Any non-transparent pixel → black with same alpha (template image)
    out[i] = 0;
    out[i + 1] = 0;
    out[i + 2] = 0;
    out[i + 3] = a;
  }
  await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toFile(templatePath);
  console.log('Wrote', path.relative(root, templatePath));

  // Linux multi-size PNGs
  const iconsDir = path.join(root, 'build', 'icons');
  mkdirRecursive(iconsDir);
  for (const size of linuxSizes) {
    const dest = path.join(iconsDir, `${size}x${size}.png`);
    await sharp(input)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(dest);
    console.log('Wrote', path.relative(root, dest));
  }

  console.log('Icon generation done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
