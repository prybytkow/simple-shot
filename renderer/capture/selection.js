function activateScreen() {
    if (screenActive) return;
    screenActive = true;
    body.classList.add('active-screen');
    info.style.display = 'none';
    escHint.style.display = 'none';
    screenInfo.style.display = 'none';
}

// Ограничить выделение границами экрана (не больше экрана)
function clampSelectionToScreen() {
    const maxW = screenWidth;
    const maxH = screenHeight;
    let left = parseInt(selectionArea.style.left, 10) || 0;
    let top = parseInt(selectionArea.style.top, 10) || 0;
    let width = parseInt(selectionArea.style.width, 10) || 0;
    let height = parseInt(selectionArea.style.height, 10) || 0;
    width = Math.max(0, Math.min(width, maxW - left));
    height = Math.max(0, Math.min(height, maxH - top));
    left = Math.max(0, Math.min(left, maxW - width));
    top = Math.max(0, Math.min(top, maxH - height));
    selectionArea.style.left = left + 'px';
    selectionArea.style.top = top + 'px';
    selectionArea.style.width = width + 'px';
    selectionArea.style.height = height + 'px';
}

// Начало выделения: клик = старт, тянуть без отпускания = размер
function startSelectionAt(x, y) {
    startX = x;
    startY = y;
    isSelecting = true;
    activeCropRatio = null;
    toolbar.querySelectorAll('.crop-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('#crop-panel .crop-option').forEach(btn => btn.classList.remove('active'));
    selectionArea.style.left = x + 'px';
    selectionArea.style.top = y + 'px';
    selectionArea.style.width = '0px';
    selectionArea.style.height = '0px';
    selectionArea.style.display = 'block';
    toolbar.style.display = 'none';
    document.getElementById('crop-popup').classList.remove('show');
    document.getElementById('format-popup').classList.remove('show');
    annotationList = [];
    drawMode = null;
    if (annotationCanvas) annotationCanvas.classList.remove('drawing');
    document.getElementById('text-input-popup').classList.remove('show');
    numberCounter = 1;
    undoStack = [];
    movingAnnotationIndex = -1;
}

// Клик по экрану: выбор экрана + начало выделения (или новое выделение по тёмной области)
body.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (captureMode === 'display-picker' || captureMode === 'fixed') return;
    if (!screenActive) {
        activateScreen();
        startSelectionAt(e.clientX, e.clientY);
        return;
    }
    // Начать новое выделение только при клике по тёмной области (не по selection-area, не по тулбару)
    if (!isSelecting && !isResizing && !isDragging && !selectionArea.contains(e.target) && !toolbar.contains(e.target) && !document.getElementById('crop-popup').contains(e.target) && !document.getElementById('format-popup').contains(e.target) && !document.getElementById('text-input-popup').contains(e.target)) {
        startSelectionAt(e.clientX, e.clientY);
    }
});

// Изменение размера выделения
document.addEventListener('mousemove', (e) => {
    if (!screenActive) return;
    
    currentX = e.clientX;
    currentY = e.clientY;
    
    if (isSelecting) {
        const width = currentX - startX;
        const height = currentY - startY;
        
        selectionArea.style.width = Math.abs(width) + 'px';
        selectionArea.style.height = Math.abs(height) + 'px';
        selectionArea.style.left = (width < 0 ? currentX : startX) + 'px';
        selectionArea.style.top = (height < 0 ? currentY : startY) + 'px';
        clampSelectionToScreen();
    } else if (isResizing && activeHandle) {
        handleResize(e);
    } else if (isDragging) {
        handleDrag(e);
    }
});

// Завершение выделения (отпустили кнопку мыши)
document.addEventListener('mouseup', (e) => {
    if (isDrawingRect) {
        isDrawingRect = false;
        redrawAnnotations();
    }
    if (isDrawingCircle) {
        isDrawingCircle = false;
        redrawAnnotations();
    }
    if (isDrawingArrow) {
        isDrawingArrow = false;
        redrawAnnotations();
    }
    if (isDrawingBrush) {
        isDrawingBrush = false;
        brushCurrentPoints = [];
        redrawAnnotations();
    }
    if (movingAnnotationIndex >= 0) movingAnnotationIndex = -1;
    if (isSelecting) {
        isSelecting = false;
        const width = parseInt(selectionArea.style.width);
        const height = parseInt(selectionArea.style.height);
        const cursorInThisWindow = e.clientX >= 0 && e.clientX <= window.innerWidth && e.clientY >= 0 && e.clientY <= window.innerHeight;
        
        if (width > 50 && height > 50) {
            if (cursorInThisWindow) {
                window.simpleShot.send('activate-single-window', screenId);
                showToolbar();
            } else {
                showToolbar();
            }
        } else {
            selectionArea.style.display = 'none';
        }
    }
    isResizing = false;
    isDragging = false;
    activeHandle = null;
});

// Обработчики для маркеров изменения размера
resizeHandles.forEach(handle => {
    handle.addEventListener('mousedown', (e) => {
        if (!screenActive) return;
        e.stopPropagation();
        isResizing = true;
        activeHandle = e.target;
        startX = parseInt(selectionArea.style.left);
        startY = parseInt(selectionArea.style.top);
    });
});

// Обработчик перемещения области
selectionArea.addEventListener('mousedown', (e) => {
    if (!screenActive) return;
    if (e.target === selectionArea) {
        isDragging = true;
        dragStartX = e.clientX - parseInt(selectionArea.style.left);
        dragStartY = e.clientY - parseInt(selectionArea.style.top);
    }
});

function handleResize(e) {
    if (!activeHandle) return;
    
    const rect = selectionArea.getBoundingClientRect();
    const handleClass = activeHandle.className.split(' ')[1];
    const ratio = activeCropRatio ? (activeCropRatio.w / activeCropRatio.h) : null;
    
    let newLeft = parseInt(selectionArea.style.left);
    let newTop = parseInt(selectionArea.style.top);
    let newWidth = parseInt(selectionArea.style.width);
    let newHeight = parseInt(selectionArea.style.height);
    
    switch(handleClass) {
        case 'resize-e':
            newWidth = Math.max(50, e.clientX - newLeft);
            break;
        case 'resize-s':
            newHeight = Math.max(50, e.clientY - newTop);
            break;
        case 'resize-se':
            newWidth = Math.max(50, e.clientX - newLeft);
            newHeight = Math.max(50, e.clientY - newTop);
            break;
        case 'resize-w':
            newWidth = Math.max(50, rect.right - e.clientX);
            newLeft = e.clientX;
            break;
        case 'resize-n':
            newHeight = Math.max(50, rect.bottom - e.clientY);
            newTop = e.clientY;
            break;
        case 'resize-nw':
            newWidth = Math.max(50, rect.right - e.clientX);
            newHeight = Math.max(50, rect.bottom - e.clientY);
            newLeft = e.clientX;
            newTop = e.clientY;
            break;
        case 'resize-ne':
            newWidth = Math.max(50, e.clientX - newLeft);
            newHeight = Math.max(50, rect.bottom - e.clientY);
            newTop = e.clientY;
            break;
        case 'resize-sw':
            newWidth = Math.max(50, rect.right - e.clientX);
            newHeight = Math.max(50, e.clientY - newTop);
            newLeft = e.clientX;
            break;
    }
    
    if (ratio !== null) {
        const minSize = 50;
        const maxW = screenWidth;
        const maxH = screenHeight;
        switch(handleClass) {
            case 'resize-e':
            case 'resize-se':
                newHeight = newWidth / ratio;
                newHeight = Math.max(minSize, Math.min(newHeight, maxH - newTop));
                newWidth = newHeight * ratio;
                break;
            case 'resize-s':
                newWidth = newHeight * ratio;
                newWidth = Math.max(minSize, Math.min(newWidth, maxW - newLeft));
                newHeight = newWidth / ratio;
                break;
            case 'resize-w':
                newHeight = newWidth / ratio;
                newHeight = Math.max(minSize, Math.min(newHeight, maxH - newTop));
                newWidth = newHeight * ratio;
                newLeft = rect.right - newWidth;
                break;
            case 'resize-n':
                newWidth = newHeight * ratio;
                newWidth = Math.max(minSize, Math.min(newWidth, maxW - newLeft));
                newHeight = newWidth / ratio;
                newTop = rect.bottom - newHeight;
                break;
            case 'resize-nw':
                newHeight = newWidth / ratio;
                newHeight = Math.max(minSize, Math.min(newHeight, maxH));
                newWidth = newHeight * ratio;
                newLeft = rect.right - newWidth;
                newTop = rect.bottom - newHeight;
                break;
            case 'resize-ne':
                newHeight = newWidth / ratio;
                newHeight = Math.max(minSize, Math.min(newHeight, maxH));
                newWidth = newHeight * ratio;
                newTop = rect.bottom - newHeight;
                break;
            case 'resize-sw':
                newHeight = newWidth / ratio;
                newHeight = Math.max(minSize, Math.min(newHeight, maxH - newTop));
                newWidth = newHeight * ratio;
                newLeft = rect.right - newWidth;
                break;
        }
    }
    
    selectionArea.style.left = newLeft + 'px';
    selectionArea.style.top = newTop + 'px';
    selectionArea.style.width = newWidth + 'px';
    selectionArea.style.height = newHeight + 'px';
    
    clampSelectionToScreen();
    showToolbar();
}

function handleDrag(e) {
    const newLeft = e.clientX - dragStartX;
    const newTop = e.clientY - dragStartY;
    
    // Ограничиваем перемещение в пределах экрана
    const maxLeft = screenWidth - parseInt(selectionArea.style.width);
    const maxTop = screenHeight - parseInt(selectionArea.style.height);
    
    selectionArea.style.left = Math.max(0, Math.min(maxLeft, newLeft)) + 'px';
    selectionArea.style.top = Math.max(0, Math.min(maxTop, newTop)) + 'px';
    
    showToolbar();
}

