function toHex6(val) {
    const m = (val || '').match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
    if (!m) return null;
    let hex = m[1];
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    return '#' + hex.toLowerCase();
}
function loadFormatColors() {
    try {
        const t = localStorage.getItem(FORMAT_STORAGE_KEYS.textColor);
        const h = localStorage.getItem(FORMAT_STORAGE_KEYS.highlightColor);
        if (t && toHex6(t)) formatTextColor = toHex6(t);
        if (h && toHex6(h)) formatHighlightColor = toHex6(h);
    } catch (_) {}
}
function saveFormatColor(role, hex) {
    const key = role === 'text' ? FORMAT_STORAGE_KEYS.textColor : FORMAT_STORAGE_KEYS.highlightColor;
    const recentKey = role === 'text' ? FORMAT_STORAGE_KEYS.recentText : FORMAT_STORAGE_KEYS.recentHighlight;
    try {
        localStorage.setItem(key, hex);
        let recent = [];
        try { recent = JSON.parse(localStorage.getItem(recentKey) || '[]'); } catch (_) {}
        const normalized = toHex6(hex);
        if (normalized && !FORMAT_PRESET_COLORS.includes(normalized)) {
            recent = [normalized].concat(recent.filter(c => toHex6(c) !== normalized)).slice(0, MAX_RECENT_COLORS);
            localStorage.setItem(recentKey, JSON.stringify(recent));
        }
    } catch (_) {}
}
function getRecentColors(role) {
    const key = role === 'text' ? FORMAT_STORAGE_KEYS.recentText : FORMAT_STORAGE_KEYS.recentHighlight;
    try {
        const arr = JSON.parse(localStorage.getItem(key) || '[]');
        return arr.filter(c => toHex6(c)).slice(0, MAX_RECENT_COLORS);
    } catch (_) { return []; }
}
function renderFormatPresets(role) {
    const container = document.getElementById(role === 'text' ? 'format-text-presets' : 'format-highlight-presets');
    const current = role === 'text' ? formatTextColor : formatHighlightColor;
    const input = document.getElementById(role === 'text' ? 'format-text-color' : 'format-highlight-color');
    const presetHex = FORMAT_PRESET_COLORS.map(toHex6).filter(Boolean);
    const recent = getRecentColors(role).map(toHex6).filter(c => c && !presetHex.includes(c));
    container.innerHTML = '';
    presetHex.forEach(hex => {
        const swatch = document.createElement('span');
        swatch.className = 'format-swatch' + (toHex6(current) === hex ? ' active' : '');
        swatch.style.backgroundColor = hex;
        swatch.title = hex;
        swatch.dataset.hex = hex;
        swatch.onclick = () => {
            if (role === 'text') formatTextColor = hex; else formatHighlightColor = hex;
            input.value = hex;
            saveFormatColor(role, hex);
            renderFormatPresets('text'); renderFormatPresets('highlight');
        };
        container.appendChild(swatch);
    });
    recent.forEach(hex => {
        const swatch = document.createElement('span');
        swatch.className = 'format-swatch' + (toHex6(current) === hex ? ' active' : '');
        swatch.style.backgroundColor = hex;
        swatch.title = hex;
        swatch.dataset.hex = hex;
        swatch.onclick = () => {
            if (role === 'text') formatTextColor = hex; else formatHighlightColor = hex;
            input.value = hex;
            saveFormatColor(role, hex);
            renderFormatPresets('text'); renderFormatPresets('highlight');
        };
        container.appendChild(swatch);
    });
}
loadFormatColors();
let formatFontSize = 16;
let formatFontBackgroundSize = 4;
let formatHighlightSize = 4;

// Рисование: список фигур в относительных координатах (0–1), режим прямоугольника
let annotationList = [];
let undoStack = [];

