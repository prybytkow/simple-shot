/**
 * Copies renderer HTML and assets into dist/ for Electron.
 * Run after `tsc`. Expects to be run from project root.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function mkdirRecursive(dir) {
  if (fs.existsSync(dir)) return;
  mkdirRecursive(path.dirname(dir));
  fs.mkdirSync(dir);
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    mkdirRecursive(dest);
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dest, name));
    }
  } else {
    mkdirRecursive(path.dirname(dest));
    fs.copyFileSync(src, dest);
  }
}

// renderer/*.html -> dist/renderer/
const rendererSrc = path.join(root, 'renderer');
const rendererDest = path.join(root, 'dist', 'renderer');
if (fs.existsSync(rendererSrc)) {
  mkdirRecursive(rendererDest);
  for (const name of fs.readdirSync(rendererSrc)) {
    const src = path.join(rendererSrc, name);
    if (fs.statSync(src).isFile()) {
      fs.copyFileSync(src, path.join(rendererDest, name));
    }
  }
  console.log('Copied renderer/* to dist/renderer/');
}

// assets/* -> dist/main/assets/
const assetsSrc = path.join(root, 'assets');
const assetsDest = path.join(root, 'dist', 'main', 'assets');
if (fs.existsSync(assetsSrc)) {
  mkdirRecursive(assetsDest);
  for (const name of fs.readdirSync(assetsSrc)) {
    const src = path.join(assetsSrc, name);
    if (fs.statSync(src).isFile() && name !== 'README.md') {
      fs.copyFileSync(src, path.join(assetsDest, name));
    }
  }
  console.log('Copied assets/* to dist/main/assets/');
}
