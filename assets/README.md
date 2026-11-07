# App assets

Place application icons here. They are copied to `dist/main/assets/` during build.

| File | Use |
|------|-----|
| `icon.png` | Source artwork (also tray on Linux / fallback) |
| `icon.ico` | Windows app/installer icon (multi-size recommended) |
| `icon.icns` | macOS app/Dock icon — generate with `npm run icons` |
| `iconTemplate.png` | macOS menu-bar template (monochrome) — generate with `npm run icons` |

Linux launcher icons live in `build/icons/{size}x{size}.png` (also from `npm run icons`).

```bash
npm run icons
```

If you only have a PNG, regenerate `.icns`, template, and Linux sizes after changing `icon.png`.
