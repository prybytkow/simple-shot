function tStr(key, fallback) {
    return (window.__t && window.__t[key]) || fallback;
}

function shortenUrl(url, maxLen) {
    const str = String(url || '');
    const limit = maxLen || 52;
    if (str.length <= limit) return str;
    const keep = Math.floor((limit - 1) / 2);
    return str.slice(0, keep) + '…' + str.slice(-keep);
}

function hideUploadStatus() {
    const el = document.getElementById('upload-status');
    if (el) el.classList.remove('visible');
    uploadBusy = false;
    if (uploadSuccessTimer) {
        clearTimeout(uploadSuccessTimer);
        uploadSuccessTimer = null;
    }
}

function showUploadStatus(state, opts) {
    opts = opts || {};
    const root = document.getElementById('upload-status');
    const spinner = document.getElementById('upload-spinner');
    const icon = document.getElementById('upload-icon');
    const title = document.getElementById('upload-status-title');
    const urlEl = document.getElementById('upload-status-url');
    const hint = document.getElementById('upload-status-hint');
    const errEl = document.getElementById('upload-status-error');
    const actions = document.getElementById('upload-status-actions');
    if (!root) return;

    root.classList.add('visible');
    spinner.style.display = state === 'uploading' ? 'block' : 'none';
    icon.style.display = state === 'success' || state === 'error' ? 'block' : 'none';
    icon.className = 'upload-icon' + (state === 'success' ? ' success' : state === 'error' ? ' error' : '');
    icon.textContent = state === 'success' ? '✓' : state === 'error' ? '!' : '';

    if (state === 'uploading') {
        uploadBusy = true;
        title.textContent = tStr('capture_uploading', 'Uploading…');
        urlEl.style.display = 'none';
        hint.style.display = 'none';
        errEl.style.display = 'none';
        actions.classList.remove('visible');
    } else if (state === 'success') {
        uploadBusy = false;
        lastUploadUrl = opts.url || '';
        title.textContent = tStr('capture_linkCopied', 'Link copied');
        if (lastUploadUrl) {
            urlEl.style.display = 'block';
            urlEl.textContent = shortenUrl(lastUploadUrl);
            urlEl.title = lastUploadUrl;
            hint.style.display = 'block';
            hint.textContent = tStr('capture_clickToCopy', 'Click to copy again');
        } else {
            urlEl.style.display = 'none';
            hint.style.display = 'none';
        }
        errEl.style.display = 'none';
        if (opts.keepOpen) actions.classList.add('visible');
        else actions.classList.remove('visible');
    } else {
        uploadBusy = false;
        title.textContent = tStr('capture_uploadFailed', 'Upload failed');
        urlEl.style.display = 'none';
        hint.style.display = 'none';
        errEl.style.display = 'block';
        errEl.textContent = opts.error || '';
        actions.classList.add('visible');
        const copyBtn = document.getElementById('upload-copy-btn');
        if (copyBtn) copyBtn.style.display = 'none';
    }
    if (state !== 'error') {
        const copyBtn = document.getElementById('upload-copy-btn');
        if (copyBtn) copyBtn.style.display = '';
    }
}

function copyUploadUrlAgain() {
    if (!lastUploadUrl) return;
    const api = window.simpleShot;
    const done = () => {
        const hint = document.getElementById('upload-status-hint');
        if (hint) {
            hint.style.display = 'block';
            hint.textContent = tStr('capture_copiedAgain', 'Copied');
        }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(lastUploadUrl).then(done).catch(() => {
            api.send('copy-text', lastUploadUrl);
            done();
        });
    } else {
        api.send('copy-text', lastUploadUrl);
        done();
    }
}

function sendCaptureArea(destination) {
    const api = window.simpleShot;
    const dest = destination === 'file' || destination === 'clipboard' || destination === 'upload'
        ? destination
        : (destination ? 'file' : 'upload');
    const x = parseInt(selectionArea.style.left, 10) || 0;
    const y = parseInt(selectionArea.style.top, 10) || 0;
    const width = parseInt(selectionArea.style.width, 10) || 0;
    const height = parseInt(selectionArea.style.height, 10) || 0;
    if (width < 10 || height < 10) return;
    document.body.classList.add('capture-hide-ui');
    const tb = document.getElementById('toolbar');
    if (tb) tb.style.visibility = 'hidden';
    // Upload progress/result uses a separate main-process feedback window
    hideUploadStatus();
    const payload = {
        x: x, y: y, width: width, height: height,
        screenId: screenId,
        destination: dest,
        saveLocally: dest === 'file',
        annotations: JSON.parse(JSON.stringify(annotationList || []))
    };
    if (captureMode === 'fixed') {
        api.send('fixed-capture-area', payload);
    } else {
        api.send('capture-area', payload);
    }
}

function initDisplayPickerMode() {
    if (captureMode !== 'display-picker') return;
    const pick = () => {
        const id = displayIdParam != null ? Number(displayIdParam) : NaN;
        if (!Number.isFinite(id)) return;
        window.simpleShot.send('pick-display', id);
    };
    body.addEventListener('click', pick);
    body.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            pick();
        }
    });
}

function enterFixedAnnotation(pngBuffer) {
    const bytes = toUint8Array(pngBuffer);
    const blob = new Blob([bytes], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
        // Fit display size to window; annotations stay 0–1 relative to selection,
        // compose maps them onto the full-resolution PNG buffer.
        const natW = Math.max(1, img.naturalWidth || img.width);
        const natH = Math.max(1, img.naturalHeight || img.height);
        const maxW = Math.max(200, window.innerWidth || natW);
        const maxH = Math.max(200, (window.innerHeight || natH) - 8);
        const scale = Math.min(1, maxW / natW, maxH / natH);
        screenWidth = Math.max(1, Math.round(natW * scale));
        screenHeight = Math.max(1, Math.round(natH * scale));
        document.body.style.width = screenWidth + 'px';
        document.body.style.height = screenHeight + 'px';
        if (overlay) {
            overlay.style.width = screenWidth + 'px';
            overlay.style.height = screenHeight + 'px';
        }
        selectionArea.style.display = 'block';
        selectionArea.style.left = '0px';
        selectionArea.style.top = '0px';
        selectionArea.style.width = screenWidth + 'px';
        selectionArea.style.height = screenHeight + 'px';
        selectionArea.style.backgroundImage = 'url(' + url + ')';
        selectionArea.style.backgroundSize = '100% 100%';
        screenActive = true;
        if (info) info.style.display = 'none';
        if (screenInfo) screenInfo.style.display = 'none';
        showToolbar();
    };
    img.src = url;
}

function initFixedMode() {
    if (captureMode !== 'fixed') return;
    window.simpleShot.on('load-fixed-image', (pngBuffer) => {
        enterFixedAnnotation(pngBuffer);
    });
}

initDisplayPickerMode();
initFixedMode();

function setupUploadStatusHandlers() {
    if (uploadHandlersReady) return;
    uploadHandlersReady = true;
    const copyBtn = document.getElementById('upload-copy-btn');
    const closeBtn = document.getElementById('upload-close-btn');
    const urlEl = document.getElementById('upload-status-url');
    if (copyBtn) copyBtn.onclick = () => copyUploadUrlAgain();
    if (closeBtn) closeBtn.onclick = () => {
        const icon = document.getElementById('upload-icon');
        const isError = icon && icon.classList.contains('error');
        hideUploadStatus();
        if (isError) {
            document.body.classList.remove('capture-hide-ui');
            const tb = document.getElementById('toolbar');
            if (tb) {
                tb.style.visibility = '';
                tb.style.display = 'block';
            }
            return;
        }
        closeAllWindows();
    };
    if (urlEl) urlEl.onclick = () => copyUploadUrlAgain();

    window.simpleShot.on('upload-complete', (payload) => {
        const success = !!(payload && payload.success);
        const saveLocally = !!(payload && payload.saveLocally);
        const copiedImage = !!(payload && payload.copiedImage);
        const feedback = (payload && payload.feedback) || 'overlay';

        document.body.classList.remove('capture-hide-ui');
        const tb = document.getElementById('toolbar');

        if (copiedImage) {
            hideUploadStatus();
            if (!success) {
                if (tb) {
                    tb.style.visibility = '';
                    tb.style.display = 'block';
                }
                return;
            }
            if (feedback === 'notification') {
                closeAllWindows();
                return;
            }
            if (feedback === 'overlay' || feedback === 'window') {
                showUploadStatus('success', {
                    url: t.notify_copiedBody || 'Screenshot copied to clipboard',
                    keepOpen: feedback === 'window'
                });
                if (feedback !== 'window') {
                    setTimeout(() => closeAllWindows(), 1200);
                }
                return;
            }
            closeAllWindows();
            return;
        }

        if (saveLocally) {
            hideUploadStatus();
            if (tb && !success) {
                tb.style.visibility = '';
                tb.style.display = 'block';
            }
            if (success) closeAllWindows();
            return;
        }

        // Network upload UX is handled by upload-feedback.html in main
        hideUploadStatus();
        closeAllWindows();
    });
}
setupUploadStatusHandlers();

// Функция закрытия всех окон
