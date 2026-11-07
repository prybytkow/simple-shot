// Показываем информацию об экране
document.getElementById('screen-number').textContent = (parseInt(screenId, 10) || 0) + 1;
document.getElementById('total-screens').textContent = totalScreens || '1';
const pickerNum = document.getElementById('display-picker-num');
if (pickerNum) pickerNum.textContent = String((parseInt(screenId, 10) || 0) + 1);

const overlay = document.getElementById('overlay');
const selectionArea = document.getElementById('selection-area');
const toolbar = document.getElementById('toolbar');
const info = document.getElementById('info');
const escHint = document.getElementById('esc-hint');
const screenInfo = document.getElementById('screen-info');
const body = document.body;
if (captureMode === 'display-picker') body.classList.add('mode-display-picker');
if (captureMode === 'fixed') body.classList.add('mode-fixed');
const resizeHandles = document.querySelectorAll('.resize-handle');

let startX, startY, currentX, currentY;
let isSelecting = false;
let isResizing = false;
let isDragging = false;
let dragStartX, dragStartY;
let activeHandle = null;
let screenActive = false;
let activeCropRatio = null;

// Настройки формата текста и выделения (для аннотаций)
let formatTextColor = '#000000';
let formatHighlightColor = '#ffff00';
const FORMAT_STORAGE_KEYS = { textColor: 'capture-format-text-color', highlightColor: 'capture-format-highlight-color', recentText: 'capture-format-recent-text', recentHighlight: 'capture-format-recent-highlight' };
const FORMAT_PRESET_COLORS = ['#000000','#ffffff','#808080','#404040','#c0c0c0','#ff0000','#00aa00','#0066ff','#ffff00','#ff8800','#aa00ff','#00cccc','#ff69b4','#8b4513'];
const MAX_RECENT_COLORS = 8;
