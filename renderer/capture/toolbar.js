       function showToolbar() {
    const rect = selectionArea.getBoundingClientRect();
    
    // Кроп по соотношению сторон: начальная точка (left, top) не двигается
    function applyCropRatio(ratioW, ratioH) {
const left = parseInt(selectionArea.style.left, 10) || 0;
const top = parseInt(selectionArea.style.top, 10) || 0;
const ratio = ratioW / ratioH;
const maxW = Math.max(50, screenWidth - left);
const maxH = Math.max(50, screenHeight - top);
const minSize = 50;
let newHeight = Math.min(maxH, maxW / ratio);
let newWidth = newHeight * ratio;
if (newWidth > maxW) {
    newWidth = maxW;
    newHeight = newWidth / ratio;
}
newWidth = Math.max(minSize, Math.min(newWidth, maxW));
newHeight = Math.max(minSize, Math.min(newHeight, maxH));
selectionArea.style.left = left + 'px';
selectionArea.style.top = top + 'px';
selectionArea.style.width = Math.round(newWidth) + 'px';
selectionArea.style.height = Math.round(newHeight) + 'px';
showToolbar();
    }
    
    // Создаем кнопки управления если их еще нет
    if (!toolbar.innerHTML) {
    const t = window.__t || {};
    const btns = [
        '<button class="tool-btn" id="maximize-btn" title="' + (t.capture_maximize || 'Весь экран') + '">⛶</button>',
        '<button class="tool-btn crop-btn" id="crop-toggle-btn" title="' + (t.capture_crop || 'Crop') + '">' + (t.capture_crop || 'Crop') + '</button>',
        '<button class="tool-btn" id="format-toggle-btn" title="' + (t.capture_formatTitle || 'Format') + '">Аа</button>',
        '<button class="tool-btn" id="rect-btn" title="' + (t.capture_rect || 'Rectangle') + '">□</button>',
        '<button class="tool-btn" id="circle-btn" title="' + (t.capture_circle || 'Circle') + '">○</button>',
        '<button class="tool-btn" id="text-btn" title="' + (t.capture_text || 'Text') + '">T</button>',
        '<button class="tool-btn" id="number-btn" title="' + (t.capture_number || 'Number') + '">№</button>',
        '<button class="tool-btn" id="arrow-btn" title="' + (t.capture_arrow || 'Arrow') + '">→</button>',
        '<button class="tool-btn" id="brush-btn" title="' + (t.capture_brush || 'Brush') + '">🖌</button>',
        '<button class="tool-btn" id="blur-btn" title="' + (t.capture_blur || 'Blur') + '">⊞</button>',
        '<button class="tool-btn" id="move-btn" title="' + (t.capture_move || 'Move') + '">✥</button>',
        '<button class="tool-btn" id="copy-btn" title="' + (t.capture_copy || 'Copy') + '">📋</button>',
        '<button class="tool-btn" id="save-btn" title="' + (t.capture_saveFile || 'Save') + '">💾</button>',
        '<button class="tool-btn" id="save-to-server-btn" title="' + (t.capture_uploadServer || 'Upload') + '">🌐</button>',
        '<button class="tool-btn" id="undo-btn" title="' + (t.capture_undo || 'Undo') + '">↶</button>',
        '<button class="tool-btn" id="close-btn" title="' + (t.capture_closeBtn || 'Close') + '">✕</button>'
    ];
    const topHtml = btns.slice(0, 4).join('');
    const rightHtml = btns.slice(4, 8).join('');
    const bottomHtml = btns.slice(8, 12).join('');
    const leftHtml = btns.slice(12, 16).join('');
    const dragHandleHtml = '<div class="toolbar-drag-handle" title="' + (t.capture_move || 'Перетащить') + '"></div>';
    toolbar.innerHTML =
        '<div class="toolbar-panel" data-side="top">' + dragHandleHtml + '<div class="toolbar-side toolbar-top">' + topHtml + '</div></div>' +
        '<div class="toolbar-panel" data-side="right">' + dragHandleHtml + '<div class="toolbar-side toolbar-right">' + rightHtml + '</div></div>' +
        '<div class="toolbar-panel" data-side="bottom">' + dragHandleHtml + '<div class="toolbar-side toolbar-bottom">' + bottomHtml + '</div></div>' +
        '<div class="toolbar-panel" data-side="left">' + dragHandleHtml + '<div class="toolbar-side toolbar-left">' + leftHtml + '</div></div>';

document.getElementById('maximize-btn').onclick = () => {
    selectionArea.style.left = '0';
    selectionArea.style.top = '0';
    selectionArea.style.width = screenWidth + 'px';
    selectionArea.style.height = screenHeight + 'px';
    showToolbar();
};
document.getElementById('crop-toggle-btn').onclick = () => {
    document.getElementById('crop-popup').classList.toggle('show');
    updateCropOptionActive();
};
document.getElementById('crop-popup').onclick = (e) => {
    if (e.target.id === 'crop-popup') e.target.classList.remove('show');
};
function updateCropOptionActive() {
    document.querySelectorAll('#crop-panel .crop-option').forEach(btn => {
        btn.classList.remove('active');
        const parts = btn.getAttribute('data-ratio').split(',');
        const w = parseInt(parts[0], 10) || 0;
        const h = parseInt(parts[1], 10) || 0;
        if (activeCropRatio && w === activeCropRatio.w && h === activeCropRatio.h) btn.classList.add('active');
        if (!activeCropRatio && btn.classList.contains('crop-option-free')) btn.classList.add('active');
    });
    const lbl = document.getElementById('crop-toggle-btn');
    if (activeCropRatio) lbl.textContent = (window.__t && window.__t.capture_crop ? window.__t.capture_crop : 'Crop') + ' ' + activeCropRatio.w + ':' + activeCropRatio.h;
    else lbl.textContent = (window.__t && window.__t.capture_crop ? window.__t.capture_crop : 'Crop');
    lbl.classList.toggle('active', !!activeCropRatio);
}
document.querySelectorAll('#crop-panel .crop-option').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const parts = btn.getAttribute('data-ratio').split(',');
        const w = parseInt(parts[0], 10) || 0;
        const h = parseInt(parts[1], 10) || 0;
        if (w === 0 && h === 0) {
            activeCropRatio = null;
        } else {
            activeCropRatio = { w: w, h: h };
            applyCropRatio(w, h);
        }
        document.getElementById('crop-popup').classList.remove('show');
        updateCropOptionActive();
    });
});

document.getElementById('format-toggle-btn').onclick = () => {
    const popup = document.getElementById('format-popup');
    popup.classList.toggle('show');
    if (popup.classList.contains('show')) {
        document.getElementById('format-text-color').value = formatTextColor;
        document.getElementById('format-highlight-color').value = formatHighlightColor;
        document.getElementById('format-font-size').value = String(formatFontSize);
        document.getElementById('format-font-bg-size').value = String(formatFontBackgroundSize);
        document.getElementById('format-highlight-size').value = String(formatHighlightSize);
        renderFormatPresets('text');
        renderFormatPresets('highlight');
    }
};
document.getElementById('format-popup').onclick = (e) => {
    if (e.target.id === 'format-popup') e.target.classList.remove('show');
};
document.getElementById('format-close-btn').onclick = () => document.getElementById('format-popup').classList.remove('show');
document.getElementById('format-text-color').oninput = (e) => {
    formatTextColor = e.target.value;
    saveFormatColor('text', formatTextColor);
    renderFormatPresets('text');
    renderFormatPresets('highlight');
};
document.getElementById('format-highlight-color').oninput = (e) => {
    formatHighlightColor = e.target.value;
    saveFormatColor('highlight', formatHighlightColor);
    renderFormatPresets('text');
    renderFormatPresets('highlight');
};
document.getElementById('format-font-size').onchange = (e) => { formatFontSize = Math.max(8, Math.min(120, parseInt(e.target.value, 10) || 16)); };
document.getElementById('format-font-bg-size').onchange = (e) => { formatFontBackgroundSize = Math.max(0, Math.min(50, parseInt(e.target.value, 10) || 4)); };
document.getElementById('format-highlight-size').onchange = (e) => { formatHighlightSize = Math.max(1, Math.min(30, parseInt(e.target.value, 10) || 4)); };

document.getElementById('text-input-popup').onclick = (e) => {
    if (e.target.id === 'text-input-popup') document.getElementById('text-input-popup').classList.remove('show');
};
document.getElementById('text-input-cancel').onclick = () => document.getElementById('text-input-popup').classList.remove('show');
document.getElementById('text-input-ok').onclick = () => {
    const input = document.getElementById('text-input-field');
    const text = (input.value || '').trim();
    document.getElementById('text-input-popup').classList.remove('show');
    input.value = '';
    if (text !== '') {
        saveState();
        const pad = formatFontBackgroundSize;
        annotationList.push({
            type: 'text',
            x: pendingTextX,
            y: pendingTextY,
            text: text,
            fontSize: formatFontSize,
            padding: pad,
            fillBg: textWithBg,
            stroke: formatTextColor,
            fill: formatHighlightColor
        });
        redrawAnnotations();
    }
};
document.getElementById('text-input-field').onkeydown = (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('text-input-ok').click();
    }
    if (e.key === 'Escape') {
        e.preventDefault();
        document.getElementById('text-input-popup').classList.remove('show');
    }
};

document.getElementById('rect-btn').onclick = () => {
    if (drawMode === 'rect' || drawMode === 'rect-filled') {
        setDrawMode(null);
    } else {
        setDrawMode(rectFilled ? 'rect-filled' : 'rect');
    }
};
document.getElementById('rect-btn').oncontextmenu = (e) => {
    e.preventDefault();
    rectFilled = !rectFilled;
    document.getElementById('rect-btn').title = rectFilled ? 'Прямоугольник заливка (ПКМ — контур)' : 'Прямоугольник (ПКМ — заливка)';
    if (drawMode === 'rect' || drawMode === 'rect-filled') setDrawMode(rectFilled ? 'rect-filled' : 'rect');
};

document.getElementById('circle-btn').onclick = () => {
    if (drawMode === 'circle' || drawMode === 'circle-filled') {
        setDrawMode(null);
    } else {
        setDrawMode(circleFilled ? 'circle-filled' : 'circle');
    }
};
document.getElementById('circle-btn').oncontextmenu = (e) => {
    e.preventDefault();
    circleFilled = !circleFilled;
    document.getElementById('circle-btn').title = circleFilled ? 'Круг заливка (ПКМ — контур)' : 'Круг (ПКМ — заливка)';
    if (drawMode === 'circle' || drawMode === 'circle-filled') setDrawMode(circleFilled ? 'circle-filled' : 'circle');
};

document.getElementById('text-btn').onclick = () => {
    if (drawMode === 'text' || drawMode === 'text-bg') {
        setDrawMode(null);
    } else {
        setDrawMode(textWithBg ? 'text-bg' : 'text');
    }
};
document.getElementById('text-btn').oncontextmenu = (e) => {
    e.preventDefault();
    textWithBg = !textWithBg;
    document.getElementById('text-btn').title = textWithBg ? (window.__t && window.__t.capture_textWithBg ? window.__t.capture_textWithBg : 'Text with background') : (window.__t && window.__t.capture_text ? window.__t.capture_text : 'Text');
    if (drawMode === 'text' || drawMode === 'text-bg') setDrawMode(textWithBg ? 'text-bg' : 'text');
};

document.getElementById('number-btn').onclick = () => {
    if (drawMode === 'number' || drawMode === 'number-bg') {
        setDrawMode(null);
    } else {
        setDrawMode(numberWithBg ? 'number-bg' : 'number');
    }
};
document.getElementById('number-btn').oncontextmenu = (e) => {
    e.preventDefault();
    numberWithBg = !numberWithBg;
    document.getElementById('number-btn').title = numberWithBg ? (window.__t && window.__t.capture_numberWithBg ? window.__t.capture_numberWithBg : 'Number with background') : (window.__t && window.__t.capture_number ? window.__t.capture_number : 'Number');
    if (drawMode === 'number' || drawMode === 'number-bg') setDrawMode(numberWithBg ? 'number-bg' : 'number');
};

document.getElementById('arrow-btn').onclick = () => {
    if (drawMode === 'arrow') {
        setDrawMode(null);
    } else {
        setDrawMode('arrow');
    }
};

document.getElementById('brush-btn').onclick = () => {
    if (drawMode === 'brush') {
        setDrawMode(null);
    } else {
        setDrawMode('brush');
    }
};

document.getElementById('blur-btn').onclick = () => {
    if (drawMode === 'blur') {
        setDrawMode(null);
    } else {
        setDrawMode('blur');
    }
};

document.getElementById('move-btn').onclick = () => {
    if (drawMode === 'move') {
        setDrawMode(null);
        movingAnnotationIndex = -1;
    } else {
        setDrawMode('move');
    }
};

annotationCanvas.onmousedown = (e) => {
    if (e.button !== 0) return;
    if (drawMode === 'move') {
        const { x, y } = getCanvasCoords(e);
        const idx = hitTest(x, y);
        if (idx >= 0) {
            saveState();
            movingAnnotationIndex = idx;
            const a = annotationList[idx];
            const w = annotationCanvas.width;
            const h = annotationCanvas.height;
            movingStartNX = x / w;
            movingStartNY = y / h;
            if (a.type === 'arrow') {
                movingStartState = { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2 };
            } else if (a.type === 'brush' && a.points) {
                movingStartState = { points: JSON.parse(JSON.stringify(a.points)) };
            } else {
                movingStartState = { x: a.x, y: a.y };
            }
        }
        return;
    }
    if (drawMode === 'rect' || drawMode === 'rect-filled') {
        const { x, y } = getCanvasCoords(e);
        isDrawingRect = true;
        rectStartX = x;
        rectStartY = y;
        return;
    }
    if (drawMode === 'circle' || drawMode === 'circle-filled') {
        const { x, y } = getCanvasCoords(e);
        isDrawingCircle = true;
        rectStartX = x;
        rectStartY = y;
        return;
    }
    if (drawMode === 'text' || drawMode === 'text-bg') {
        const { x, y } = getCanvasCoords(e);
        const w = annotationCanvas.width;
        const h = annotationCanvas.height;
        if (w <= 0 || h <= 0) return;
        pendingTextX = x / w;
        pendingTextY = y / h;
        pendingTextW = w;
        pendingTextH = h;
        document.getElementById('text-input-field').value = '';
        document.getElementById('text-input-popup').classList.add('show');
        setTimeout(() => document.getElementById('text-input-field').focus(), 50);
        return;
    }
    if (drawMode === 'number' || drawMode === 'number-bg') {
        const { x, y } = getCanvasCoords(e);
        const w = annotationCanvas.width;
        const h = annotationCanvas.height;
        if (w <= 0 || h <= 0) return;
        saveState();
        const pad = formatFontBackgroundSize;
        annotationList.push({
            type: 'number',
            x: x / w,
            y: y / h,
            text: String(numberCounter),
            fontSize: formatFontSize,
            padding: pad,
            fillBg: numberWithBg,
            stroke: formatTextColor,
            fill: formatHighlightColor
        });
        numberCounter++;
        redrawAnnotations();
        return;
    }
    if (drawMode === 'arrow') {
        const { x, y } = getCanvasCoords(e);
        isDrawingArrow = true;
        arrowStartX = x;
        arrowStartY = y;
        return;
    }
    if (drawMode === 'brush') {
        const { x, y } = getCanvasCoords(e);
        const w = annotationCanvas.width;
        const h = annotationCanvas.height;
        if (w <= 0 || h <= 0) return;
        isDrawingBrush = true;
        brushCurrentPoints = [[x / w, y / h]];
        return;
    }
    if (drawMode === 'blur') {
        const { x, y } = getCanvasCoords(e);
        isDrawingBlur = true;
        rectStartX = x;
        rectStartY = y;
        return;
    }
};
annotationCanvas.onmousemove = (e) => {
    if (isDrawingRect) {
        const { x, y } = getCanvasCoords(e);
        const w = annotationCanvas.width;
        const h = annotationCanvas.height;
        const x0 = Math.min(rectStartX, x);
        const y0 = Math.min(rectStartY, y);
        const rw = Math.abs(x - rectStartX);
        const rh = Math.abs(y - rectStartY);
        redrawAnnotations({ x: x0, y: y0, w: rw, h: rh });
        return;
    }
    if (isDrawingCircle) {
        const { x, y } = getCanvasCoords(e);
        const x0 = Math.min(rectStartX, x);
        const y0 = Math.min(rectStartY, y);
        const rw = Math.abs(x - rectStartX);
        const rh = Math.abs(y - rectStartY);
        redrawAnnotations(null, { x: x0, y: y0, w: rw, h: rh });
        return;
    }
    if (isDrawingArrow) {
        const { x, y } = getCanvasCoords(e);
        redrawAnnotations(null, null, { x1: arrowStartX, y1: arrowStartY, x2: x, y2: y });
    }
    if (movingAnnotationIndex >= 0) {
        const { x, y } = getCanvasCoords(e);
        const w = annotationCanvas.width;
        const h = annotationCanvas.height;
        if (!w || !h) return;
        const dnx = (x / w) - movingStartNX;
        const dny = (y / h) - movingStartNY;
        const a = annotationList[movingAnnotationIndex];
        if (a.type === 'arrow') {
            a.x1 = movingStartState.x1 + dnx;
            a.y1 = movingStartState.y1 + dny;
            a.x2 = movingStartState.x2 + dnx;
            a.y2 = movingStartState.y2 + dny;
        } else if (a.type === 'brush' && movingStartState.points) {
            a.points = movingStartState.points.map(p => [p[0] + dnx, p[1] + dny]);
        } else {
            a.x = movingStartState.x + dnx;
            a.y = movingStartState.y + dny;
        }
        redrawAnnotations();
    }
    if (isDrawingBrush) {
        const { x, y } = getCanvasCoords(e);
        const w = annotationCanvas.width;
        const h = annotationCanvas.height;
        if (w > 0 && h > 0) brushCurrentPoints.push([x / w, y / h]);
        redrawAnnotations(null, null, null, brushCurrentPoints);
    }
    if (isDrawingBlur) {
        const { x, y } = getCanvasCoords(e);
        const w = annotationCanvas.width;
        const h = annotationCanvas.height;
        if (w > 0 && h > 0) {
            const x0 = Math.min(rectStartX, x);
            const y0 = Math.min(rectStartY, y);
            const rw = Math.abs(x - rectStartX);
            const rh = Math.abs(y - rectStartY);
            redrawAnnotations(null, null, null, null, { x: x0, y: y0, w: rw, h: rh });
        }
    }
};
annotationCanvas.onmouseup = (e) => {
    if (e.button !== 0) return;
    const w = annotationCanvas.width;
    const h = annotationCanvas.height;
    if (isDrawingRect) {
        const { x, y } = getCanvasCoords(e);
        if (w <= 0 || h <= 0) { isDrawingRect = false; redrawAnnotations(); return; }
        const x0 = Math.min(rectStartX, x) / w;
        const y0 = Math.min(rectStartY, y) / h;
        const rw = Math.abs(x - rectStartX) / w;
        const rh = Math.abs(y - rectStartY) / h;
        if (rw >= 0.002 && rh >= 0.002) {
            saveState();
            annotationList.push({
                type: 'rect',
                x: x0, y: y0, w: rw, h: rh,
                filled: rectFilled,
                stroke: formatTextColor,
                fill: formatHighlightColor,
                borderWidth: Math.max(1, formatHighlightSize)
            });
        }
        isDrawingRect = false;
        redrawAnnotations();
        return;
    }
    if (isDrawingCircle) {
        const { x, y } = getCanvasCoords(e);
        if (w <= 0 || h <= 0) { isDrawingCircle = false; redrawAnnotations(); return; }
        const x0 = Math.min(rectStartX, x) / w;
        const y0 = Math.min(rectStartY, y) / h;
        const rw = Math.abs(x - rectStartX) / w;
        const rh = Math.abs(y - rectStartY) / h;
        if (rw >= 0.002 && rh >= 0.002) {
            saveState();
            annotationList.push({
                type: 'circle',
                x: x0, y: y0, w: rw, h: rh,
                filled: circleFilled,
                stroke: formatTextColor,
                fill: formatHighlightColor,
                borderWidth: Math.max(1, formatHighlightSize)
            });
        }
        isDrawingCircle = false;
        redrawAnnotations();
    }
    if (isDrawingArrow) {
        const { x, y } = getCanvasCoords(e);
        if (w <= 0 || h <= 0) { isDrawingArrow = false; redrawAnnotations(); return; }
        const dx = x - arrowStartX;
        const dy = y - arrowStartY;
        if (Math.sqrt(dx * dx + dy * dy) >= 2) {
            saveState();
            annotationList.push({
                type: 'arrow',
                x1: arrowStartX / w,
                y1: arrowStartY / h,
                x2: x / w,
                y2: y / h,
                stroke: formatTextColor,
                borderWidth: Math.max(1, formatHighlightSize)
            });
        }
        isDrawingArrow = false;
        redrawAnnotations();
    }
    if (isDrawingBrush) {
        const w = annotationCanvas.width;
        const h = annotationCanvas.height;
        if (w > 0 && h > 0 && brushCurrentPoints.length >= 2) {
            saveState();
            annotationList.push({
                type: 'brush',
                points: brushCurrentPoints.map(p => [p[0], p[1]]),
                stroke: formatTextColor,
                borderWidth: Math.max(1, formatHighlightSize)
            });
        }
        isDrawingBrush = false;
        brushCurrentPoints = [];
        redrawAnnotations();
    }
    if (isDrawingBlur) {
        const { x, y } = getCanvasCoords(e);
        if (w <= 0 || h <= 0) { isDrawingBlur = false; redrawAnnotations(); return; }
        const x0 = Math.min(rectStartX, x) / w;
        const y0 = Math.min(rectStartY, y) / h;
        const rw = Math.abs(x - rectStartX) / w;
        const rh = Math.abs(y - rectStartY) / h;
        if (rw >= 0.002 && rh >= 0.002) {
            saveState();
            annotationList.push({
                type: 'blur',
                x: x0, y: y0, w: rw, h: rh
            });
        }
        isDrawingBlur = false;
        redrawAnnotations();
    }
    movingAnnotationIndex = -1;
};

document.getElementById('undo-btn').onclick = () => restoreState();

// Добавляем обработчики для кнопок
document.getElementById('save-btn').onclick = () => sendCaptureArea('file');
document.getElementById('save-to-server-btn').onclick = () => sendCaptureArea('upload');
const copyToolBtn = document.getElementById('copy-btn');
if (copyToolBtn) copyToolBtn.onclick = () => sendCaptureArea('clipboard');

document.getElementById('close-btn').onclick = () => {
    closeAllWindows();
};

(function setupToolbarDrag() {
    const handleHeight = 20;
    function setupPanelDrag(panel) {
        const handle = panel.querySelector('.toolbar-drag-handle');
        if (!handle) return;
        let dragging = false, startX, startY, startLeft, startTop;
        handle.addEventListener('mousedown', function(e) {
            if (e.button !== 0) return;
            dragging = true;
            startX = e.clientX;
            startY = e.clientY;
            startLeft = parseInt(panel.style.left, 10) || 0;
            startTop = parseInt(panel.style.top, 10) || 0;
            e.preventDefault();
        });
        document.addEventListener('mousemove', function(e) {
            if (!dragging) return;
            panel.style.left = (startLeft + e.clientX - startX) + 'px';
            panel.style.top = (startTop + e.clientY - startY) + 'px';
        });
        document.addEventListener('mouseup', function() {
            dragging = false;
        });
    }
    toolbar.querySelectorAll('.toolbar-panel').forEach(setupPanelDrag);
})();
    }
    
    // Подсветка активного кропа при перерисовке тулбара
    const cropToggleBtn = document.getElementById('crop-toggle-btn');
    if (cropToggleBtn) {
cropToggleBtn.classList.toggle('active', !!activeCropRatio);
cropToggleBtn.textContent = activeCropRatio ? ((window.__t && window.__t.capture_crop ? window.__t.capture_crop : 'Crop') + ' ' + activeCropRatio.w + ':' + activeCropRatio.h) : (window.__t && window.__t.capture_crop ? window.__t.capture_crop : 'Crop');
    }
    
    const pad = 10;
    const gap = 6;
    const sidePad = 6;
    const btnSize = 44;
    const stripSize = 50;
    const BUTTON_IDS = ['maximize-btn', 'crop-toggle-btn', 'format-toggle-btn', 'rect-btn', 'circle-btn', 'text-btn', 'number-btn', 'arrow-btn', 'brush-btn', 'blur-btn', 'move-btn', 'copy-btn', 'save-btn', 'save-to-server-btn', 'undo-btn', 'close-btn'];
    const totalButtons = BUTTON_IDS.length;
    
    const topRow = toolbar.querySelector('.toolbar-top');
    const rightCol = toolbar.querySelector('.toolbar-right');
    const bottomRow = toolbar.querySelector('.toolbar-bottom');
    const leftCol = toolbar.querySelector('.toolbar-left');
    if (!topRow || !rightCol || !bottomRow || !leftCol) return;
    
    const spaceTop = rect.top - pad;
    const spaceBottom = screenHeight - rect.bottom - pad;
    const spaceLeft = rect.left - pad;
    const spaceRight = screenWidth - rect.right - pad;
    
    function capacityColumn(h) { return Math.max(0, Math.min(totalButtons, Math.floor((h - sidePad * 2) / (btnSize + gap)))); }
    function capacityRow(w) { return Math.max(0, Math.min(totalButtons, Math.floor((w - sidePad * 2) / (btnSize + gap)))); }
    
    const order = ['right', 'left', 'bottom', 'top'];
    let capR = spaceRight >= stripSize ? capacityColumn(rect.height) : 0;
    let capL = spaceLeft >= stripSize ? capacityColumn(rect.height) : 0;
    let capB = spaceBottom >= stripSize ? capacityRow(rect.width) : 0;
    let capT = spaceTop >= stripSize ? capacityRow(rect.width) : 0;
    
    const totalCapacity = capR + capL + capB + capT;
    const isSmallSelection = (rect.width < 400 || rect.height < 300);
    let inside = false;
    let innerPad = 8, innerW = rect.width - 16, innerH = rect.height - 16, midH = innerH, topUsed = 0, bottomUsed = 0;
    if (totalCapacity >= totalButtons) {
toolbar.classList.remove('toolbar-inside');
    } else if (isSmallSelection) {
toolbar.classList.remove('toolbar-inside');
const perSide = Math.ceil(totalButtons / 4);
capR = capL = capB = capT = perSide;
    } else {
toolbar.classList.add('toolbar-inside');
inside = true;
innerPad = 8;
innerH = rect.height - innerPad * 2;
innerW = rect.width - innerPad * 2;
capT = capacityRow(innerW);
capB = capacityRow(innerW);
topUsed = (capT > 0 ? stripSize + innerPad : 0);
bottomUsed = (capB > 0 ? stripSize + innerPad : 0);
midH = Math.max(0, innerH - topUsed - bottomUsed);
capR = capacityColumn(midH);
capL = capacityColumn(midH);
    }
    
    const counts = { right: capR, left: capL, bottom: capB, top: capT };
    const sideEls = { right: rightCol, left: leftCol, bottom: bottomRow, top: topRow };
    let idx = 0;
    const bySide = { right: [], left: [], bottom: [], top: [] };
    for (const side of order) {
const n = Math.min(counts[side], totalButtons - idx);
for (let i = 0; i < n; i++) bySide[side].push(idx++);
    }
    
    const getButtonsInOrder = () => BUTTON_IDS.map(id => document.getElementById(id)).filter(Boolean);
    const allBtns = getButtonsInOrder();
    for (const side of order) {
const el = sideEls[side];
el.innerHTML = '';
bySide[side].forEach(i => { if (allBtns[i]) el.appendChild(allBtns[i]); });
el.style.display = bySide[side].length ? 'flex' : 'none';
el.classList.remove('toolbar-side-wrap');
    }
    
    const stripRects = [];
    function addStrip(side, n, screenLeft, screenTop, w, h) {
if (n <= 0) return;
stripRects.push({ left: screenLeft, top: screenTop, width: w, height: h, side: side, n: n });
    }
    
    const outsidePad = pad;
    if (inside) {
if (bySide.top.length) {
    const n = bySide.top.length;
    const w = sidePad * 2 + n * (btnSize + gap) - gap;
    addStrip('top', n, rect.left + innerPad + Math.max(0, (innerW - w) / 2), rect.top + innerPad, w, stripSize);
}
if (bySide.bottom.length) {
    const n = bySide.bottom.length;
    const w = sidePad * 2 + n * (btnSize + gap) - gap;
    addStrip('bottom', n, rect.left + innerPad + Math.max(0, (innerW - w) / 2), rect.bottom - innerPad - stripSize, w, stripSize);
}
const midTop = rect.top + innerPad + topUsed;
if (bySide.right.length) {
    const n = bySide.right.length;
    const h = sidePad * 2 + n * (btnSize + gap) - gap;
    addStrip('right', n, rect.right - innerPad - stripSize, midTop + Math.max(0, (midH - h) / 2), stripSize, h);
}
if (bySide.left.length) {
    const n = bySide.left.length;
    const h = sidePad * 2 + n * (btnSize + gap) - gap;
    addStrip('left', n, rect.left + innerPad, midTop + Math.max(0, (midH - h) / 2), stripSize, h);
}
    } else {
    if (bySide.right.length) {
const n = bySide.right.length;
const h = sidePad * 2 + n * (btnSize + gap) - gap;
addStrip('right', n, rect.right + outsidePad, rect.top + Math.max(0, (rect.height - h) / 2), stripSize, h);
    }
    if (bySide.left.length) {
const n = bySide.left.length;
const h = sidePad * 2 + n * (btnSize + gap) - gap;
addStrip('left', n, rect.left - outsidePad - stripSize, rect.top + Math.max(0, (rect.height - h) / 2), stripSize, h);
    }
    if (bySide.bottom.length) {
const n = bySide.bottom.length;
const w = sidePad * 2 + n * (btnSize + gap) - gap;
addStrip('bottom', n, rect.left + Math.max(0, (rect.width - w) / 2), rect.bottom + outsidePad, w, stripSize);
    }
    if (bySide.top.length) {
const n = bySide.top.length;
const w = sidePad * 2 + n * (btnSize + gap) - gap;
addStrip('top', n, rect.left + Math.max(0, (rect.width - w) / 2), rect.top - outsidePad - stripSize, w, stripSize);
    }
    }
    
    if (stripRects.length === 0) {
toolbar.style.display = 'block';
resizeAnnotationCanvas();
return;
    }
    
    const handleHeight = 20;
    toolbar.style.left = '';
    toolbar.style.top = '';
    toolbar.style.width = '';
    toolbar.style.height = '';
    
    for (const side of ['top', 'right', 'bottom', 'left']) {
const panel = toolbar.querySelector('.toolbar-panel[data-side="' + side + '"]');
if (!panel) continue;
const r = stripRects.find(x => x.side === side);
if (!r) {
    panel.style.display = 'none';
    continue;
}
panel.style.display = 'flex';
panel.style.flexDirection = 'column';
panel.style.left = r.left + 'px';
panel.style.top = (r.top - handleHeight) + 'px';
panel.style.width = r.width + 'px';
panel.style.height = (r.height + handleHeight) + 'px';
    }
    
    toolbar.style.display = 'block';
    resizeAnnotationCanvas();
}

let uploadBusy = false;
let uploadSuccessTimer = null;
let lastUploadUrl = '';
let uploadHandlersReady = false;

