function saveState() {
    undoStack.push({
        list: JSON.parse(JSON.stringify(annotationList)),
        numberCounter: numberCounter
    });
}
function restoreState() {
    if (undoStack.length === 0) return;
    const state = undoStack.pop();
    annotationList = state.list;
    numberCounter = state.numberCounter;
    redrawAnnotations();
}

let drawMode = null;
let rectFilled = false;
let circleFilled = false;
let isDrawingRect = false;
let isDrawingCircle = false;
let rectStartX = 0, rectStartY = 0;
let textWithBg = false;
let isDrawingArrow = false;
let arrowStartX = 0, arrowStartY = 0;
let isDrawingBrush = false;
let isDrawingBlur = false;
let brushCurrentPoints = [];
let pendingTextX = 0, pendingTextY = 0, pendingTextW = 1, pendingTextH = 1;
let numberCounter = 1;
let numberWithBg = false;
const annotationCanvas = document.getElementById('annotation-canvas');
const annotationCtx = annotationCanvas.getContext('2d');

let movingAnnotationIndex = -1;
let movingStartNX = 0, movingStartNY = 0;
let movingStartState = null;

function hitTest(px, py) {
    const w = annotationCanvas.width;
    const h = annotationCanvas.height;
    if (!w || !h) return -1;
    const nx = px / w;
    const ny = py / h;
    for (let i = annotationList.length - 1; i >= 0; i--) {
        const a = annotationList[i];
        if (a.type === 'rect' || a.type === 'circle') {
            const x = a.x, y = a.y, rw = a.w || 0, rh = a.h || 0;
            if (nx >= x && nx <= x + rw && ny >= y && ny <= y + rh) return i;
        } else if (a.type === 'blur') {
            const x = a.x, y = a.y, rw = a.w || 0, rh = a.h || 0;
            if (nx >= x && nx <= x + rw && ny >= y && ny <= y + rh) return i;
        } else if (a.type === 'text' || a.type === 'number') {
            const fs = a.fontSize != null ? a.fontSize : formatFontSize;
            const pad = a.padding != null ? a.padding : formatFontBackgroundSize;
            annotationCtx.font = fs + 'px Arial';
            const tw = annotationCtx.measureText(a.text || '').width;
            const boxW = (tw + pad * 2) / w;
            const boxH = (fs + pad * 2) / h;
            if (nx >= a.x && nx <= a.x + boxW && ny >= a.y && ny <= a.y + boxH) return i;
        } else if (a.type === 'arrow') {
            const x1 = a.x1 * w, y1 = a.y1 * h, x2 = a.x2 * w, y2 = a.y2 * h;
            const dist = distToSegment(px, py, x1, y1, x2, y2);
            if (dist <= Math.max(8, formatHighlightSize * 2)) return i;
        } else if (a.type === 'brush' && a.points && a.points.length >= 2) {
            const threshold = Math.max(12, (a.borderWidth != null ? a.borderWidth : formatHighlightSize) * 3);
            for (let j = 0; j < a.points.length - 1; j++) {
                const x1 = a.points[j][0] * w, y1 = a.points[j][1] * h;
                const x2 = a.points[j + 1][0] * w, y2 = a.points[j + 1][1] * h;
                if (distToSegment(px, py, x1, y1, x2, y2) <= threshold) return i;
            }
        }
    }
    return -1;
}
function distToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-6) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
    let t = ((px - x1) * dx + (py - y1) * dy) / (len * len);
    t = Math.max(0, Math.min(1, t));
    const qx = x1 + t * dx, qy = y1 + t * dy;
    return Math.sqrt((px - qx) ** 2 + (py - qy) ** 2);
}

function resizeAnnotationCanvas() {
    const w = selectionArea.clientWidth;
    const h = selectionArea.clientHeight;
    if (w > 0 && h > 0) {
        annotationCanvas.width = w;
        annotationCanvas.height = h;
        redrawAnnotations();
    }
}

function redrawAnnotations(previewRect, previewCircle, previewArrow, previewBrush, previewBlur) {
    const w = annotationCanvas.width;
    const h = annotationCanvas.height;
    if (!w || !h) return;
    annotationCtx.clearRect(0, 0, w, h);
    annotationList.forEach(a => {
        const x = a.x * w, y = a.y * h, rw = (a.w != null) ? a.w * w : 0, rh = (a.h != null) ? a.h * h : 0;
        annotationCtx.strokeStyle = a.stroke || formatTextColor;
        annotationCtx.fillStyle = a.fill || formatHighlightColor;
        annotationCtx.lineWidth = a.borderWidth != null ? a.borderWidth : Math.max(1, formatHighlightSize);
        if (a.type === 'rect') {
            if (a.filled) annotationCtx.fillRect(x, y, rw, rh);
            annotationCtx.strokeRect(x, y, rw, rh);
        } else if (a.type === 'circle') {
            const cx = x + rw / 2, cy = y + rh / 2, rad = Math.min(rw, rh) / 2;
            annotationCtx.beginPath();
            annotationCtx.arc(cx, cy, rad, 0, Math.PI * 2);
            if (a.filled) annotationCtx.fill();
            annotationCtx.stroke();
        } else if (a.type === 'text') {
            const fs = a.fontSize != null ? a.fontSize : formatFontSize;
            const pad = a.padding != null ? a.padding : formatFontBackgroundSize;
            annotationCtx.font = fs + 'px Arial';
            const metrics = annotationCtx.measureText(a.text || '');
            const tw = metrics.width;
            const th = fs;
            const boxX = x;
            const boxY = y;
            const boxW = tw + pad * 2;
            const boxH = th + pad * 2;
            if (a.fillBg) {
                annotationCtx.fillStyle = a.fill || formatHighlightColor;
                annotationCtx.fillRect(boxX, boxY, boxW, boxH);
            }
            annotationCtx.fillStyle = a.stroke || formatTextColor;
            annotationCtx.fillText(a.text || '', boxX + pad, boxY + pad + fs);
        } else if (a.type === 'number') {
            const fs = a.fontSize != null ? a.fontSize : formatFontSize;
            const pad = a.padding != null ? a.padding : formatFontBackgroundSize;
            annotationCtx.font = fs + 'px Arial';
            const metrics = annotationCtx.measureText(a.text || '');
            const tw = metrics.width;
            const boxX = x;
            const boxY = y;
            if (a.fillBg) {
                annotationCtx.fillStyle = a.fill || formatHighlightColor;
                annotationCtx.fillRect(boxX, boxY, tw + pad * 2, fs + pad * 2);
            }
            annotationCtx.fillStyle = a.stroke || formatTextColor;
            annotationCtx.fillText(a.text || '', boxX + pad, boxY + pad + fs);
        } else if (a.type === 'arrow') {
            const x1 = a.x1 * w, y1 = a.y1 * h, x2 = a.x2 * w, y2 = a.y2 * h;
            const lw = a.borderWidth != null ? a.borderWidth : Math.max(1, formatHighlightSize);
            annotationCtx.strokeStyle = a.stroke || formatTextColor;
            annotationCtx.fillStyle = a.stroke || formatTextColor;
            annotationCtx.lineWidth = lw;
            annotationCtx.lineCap = 'round';
            annotationCtx.lineJoin = 'round';
            annotationCtx.beginPath();
            annotationCtx.moveTo(x1, y1);
            annotationCtx.lineTo(x2, y2);
            annotationCtx.stroke();
            const angle = Math.atan2(y2 - y1, x2 - x1);
            const headLen = Math.max(10, lw * 4);
            annotationCtx.beginPath();
            annotationCtx.moveTo(x2, y2);
            annotationCtx.lineTo(x2 - headLen * Math.cos(angle - 0.4), y2 - headLen * Math.sin(angle - 0.4));
            annotationCtx.lineTo(x2 - headLen * Math.cos(angle + 0.4), y2 - headLen * Math.sin(angle + 0.4));
            annotationCtx.closePath();
            annotationCtx.fill();
            annotationCtx.stroke();
        } else if (a.type === 'brush' && a.points && a.points.length >= 2) {
            const lw = a.borderWidth != null ? a.borderWidth : Math.max(1, formatHighlightSize);
            annotationCtx.strokeStyle = a.stroke || formatTextColor;
            annotationCtx.lineWidth = lw;
            annotationCtx.lineCap = 'round';
            annotationCtx.lineJoin = 'round';
            annotationCtx.beginPath();
            annotationCtx.moveTo(a.points[0][0] * w, a.points[0][1] * h);
            for (let i = 1; i < a.points.length; i++) {
                annotationCtx.lineTo(a.points[i][0] * w, a.points[i][1] * h);
            }
            annotationCtx.stroke();
        } else if (a.type === 'blur') {
            annotationCtx.fillStyle = 'rgba(128, 128, 128, 0.45)';
            annotationCtx.fillRect(x, y, rw, rh);
            annotationCtx.strokeStyle = 'rgba(80, 80, 80, 0.8)';
            annotationCtx.lineWidth = 1;
            annotationCtx.strokeRect(x, y, rw, rh);
        }
    });
    if (previewRect) {
        const { x, y, w: rw, h: rh } = previewRect;
        annotationCtx.strokeStyle = formatTextColor;
        annotationCtx.fillStyle = formatHighlightColor;
        annotationCtx.lineWidth = Math.max(1, formatHighlightSize);
        if (rectFilled) annotationCtx.fillRect(x, y, rw, rh);
        annotationCtx.strokeRect(x, y, rw, rh);
    }
    if (previewCircle) {
        const { x, y, w: rw, h: rh } = previewCircle;
        const cx = x + rw / 2, cy = y + rh / 2, rad = Math.min(rw, rh) / 2;
        annotationCtx.strokeStyle = formatTextColor;
        annotationCtx.fillStyle = formatHighlightColor;
        annotationCtx.lineWidth = Math.max(1, formatHighlightSize);
        annotationCtx.beginPath();
        annotationCtx.arc(cx, cy, rad, 0, Math.PI * 2);
        if (circleFilled) annotationCtx.fill();
        annotationCtx.stroke();
    }
    if (previewArrow) {
        const { x1, y1, x2, y2 } = previewArrow;
        const lw = Math.max(1, formatHighlightSize);
        annotationCtx.strokeStyle = formatTextColor;
        annotationCtx.fillStyle = formatTextColor;
        annotationCtx.lineWidth = lw;
        annotationCtx.lineCap = 'round';
        annotationCtx.lineJoin = 'round';
        annotationCtx.beginPath();
        annotationCtx.moveTo(x1, y1);
        annotationCtx.lineTo(x2, y2);
        annotationCtx.stroke();
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const headLen = Math.max(10, lw * 4);
        annotationCtx.beginPath();
        annotationCtx.moveTo(x2, y2);
        annotationCtx.lineTo(x2 - headLen * Math.cos(angle - 0.4), y2 - headLen * Math.sin(angle - 0.4));
        annotationCtx.lineTo(x2 - headLen * Math.cos(angle + 0.4), y2 - headLen * Math.sin(angle + 0.4));
        annotationCtx.closePath();
        annotationCtx.fill();
        annotationCtx.stroke();
    }
    if (previewBrush && previewBrush.length >= 2) {
        const lw = Math.max(1, formatHighlightSize);
        annotationCtx.strokeStyle = formatTextColor;
        annotationCtx.lineWidth = lw;
        annotationCtx.lineCap = 'round';
        annotationCtx.lineJoin = 'round';
        annotationCtx.beginPath();
        annotationCtx.moveTo(previewBrush[0][0] * w, previewBrush[0][1] * h);
        for (let i = 1; i < previewBrush.length; i++) {
            annotationCtx.lineTo(previewBrush[i][0] * w, previewBrush[i][1] * h);
        }
        annotationCtx.stroke();
    }
    if (previewBlur) {
        const { x, y, w: rw, h: rh } = previewBlur;
        annotationCtx.fillStyle = 'rgba(128, 128, 128, 0.45)';
        annotationCtx.fillRect(x, y, rw, rh);
        annotationCtx.strokeStyle = 'rgba(80, 80, 80, 0.8)';
        annotationCtx.lineWidth = 1;
        annotationCtx.strokeRect(x, y, rw, rh);
    }
}

function getCanvasCoords(e) {
    const r = annotationCanvas.getBoundingClientRect();
    const scaleX = annotationCanvas.width / r.width;
    const scaleY = annotationCanvas.height / r.height;
    return { x: (e.clientX - r.left) * scaleX, y: (e.clientY - r.top) * scaleY };
}

function setDrawMode(mode) {
    drawMode = mode;
    annotationCanvas.classList.remove('drawing');
    const rectBtn = document.getElementById('rect-btn');
    const circleBtn = document.getElementById('circle-btn');
    const textBtn = document.getElementById('text-btn');
    const numberBtn = document.getElementById('number-btn');
    const arrowBtn = document.getElementById('arrow-btn');
    if (rectBtn) rectBtn.classList.remove('draw-mode-active');
    if (circleBtn) circleBtn.classList.remove('draw-mode-active');
    if (textBtn) textBtn.classList.remove('draw-mode-active');
    if (numberBtn) numberBtn.classList.remove('draw-mode-active');
    if (arrowBtn) arrowBtn.classList.remove('draw-mode-active');
    const moveBtn = document.getElementById('move-btn');
    const brushBtn = document.getElementById('brush-btn');
    if (moveBtn) moveBtn.classList.remove('draw-mode-active');
    if (brushBtn) brushBtn.classList.remove('draw-mode-active');
    const blurBtn = document.getElementById('blur-btn');
    if (blurBtn) blurBtn.classList.remove('draw-mode-active');
    annotationCanvas.classList.remove('move-mode');
    if (mode === 'rect' || mode === 'rect-filled') {
        annotationCanvas.classList.add('drawing');
        if (rectBtn) rectBtn.classList.add('draw-mode-active');
    } else if (mode === 'circle' || mode === 'circle-filled') {
        annotationCanvas.classList.add('drawing');
        if (circleBtn) circleBtn.classList.add('draw-mode-active');
    } else if (mode === 'text' || mode === 'text-bg') {
        annotationCanvas.classList.add('drawing');
        if (textBtn) textBtn.classList.add('draw-mode-active');
    } else if (mode === 'number' || mode === 'number-bg') {
        annotationCanvas.classList.add('drawing');
        if (numberBtn) numberBtn.classList.add('draw-mode-active');
    } else if (mode === 'arrow') {
        annotationCanvas.classList.add('drawing');
        if (arrowBtn) arrowBtn.classList.add('draw-mode-active');
    } else if (mode === 'move') {
        annotationCanvas.classList.add('drawing');
        annotationCanvas.classList.add('move-mode');
        const moveBtn = document.getElementById('move-btn');
        if (moveBtn) moveBtn.classList.add('draw-mode-active');
    } else if (mode === 'brush') {
        annotationCanvas.classList.add('drawing');
        if (brushBtn) brushBtn.classList.add('draw-mode-active');
    } else if (mode === 'blur') {
        annotationCanvas.classList.add('drawing');
        if (blurBtn) blurBtn.classList.add('draw-mode-active');
    }
}

// Локальная активация экрана (скрыть подсказки; остальные окна закроются после отпускания мыши)
