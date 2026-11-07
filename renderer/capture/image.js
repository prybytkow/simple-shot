function toUint8Array(payload) {
    if (!payload) return new Uint8Array(0);
    if (payload instanceof Uint8Array) return payload;
    if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
    if (ArrayBuffer.isView(payload)) {
        return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
    }
    // Electron may send Node Buffer as { type: 'Buffer', data: number[] }
    if (payload.type === 'Buffer' && Array.isArray(payload.data)) {
        return Uint8Array.from(payload.data);
    }
    return new Uint8Array(payload);
}

function getSrgbContext(canvas) {
    try {
        return canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
    } catch (_) {
        return canvas.getContext('2d');
    }
}

async function loadPngBitmap(pngBuffer) {
    const bytes = toUint8Array(pngBuffer);
    const blob = new Blob([bytes], { type: 'image/png' });
    if (typeof createImageBitmap === 'function') {
        try {
            // Keep pixel values as-is — avoid display/ICC color conversion
            return await createImageBitmap(blob, { colorSpaceConversion: 'none' });
        } catch (_) { /* fall through */ }
    }
    return await new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(blob);
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Не удалось загрузить изображение'));
        };
        img.src = url;
    });
}

async function canvasToPngBytes(canvas) {
    const blob = await new Promise((resolve, reject) => {
        const done = (b) => (b ? resolve(b) : reject(new Error('PNG export failed')));
        if (typeof canvas.convertToBlob === 'function') {
            canvas.convertToBlob({ type: 'image/png' }).then(done).catch(reject);
        } else {
            canvas.toBlob(done, 'image/png');
        }
    });
    return new Uint8Array(await blob.arrayBuffer());
}

window.simpleShot.on('apply-watermark', ({ pngBuffer, watermark }) => {
    (async () => {
        try {
            const bitmap = await loadPngBitmap(pngBuffer);
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const ctx = getSrgbContext(canvas);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(bitmap, 0, 0);
            if (typeof bitmap.close === 'function') bitmap.close();
            const padding = 20;
            ctx.font = `${watermark.fontSize || 24}px sans-serif`;
            ctx.globalAlpha = watermark.opacity != null ? watermark.opacity : 0.5;
            ctx.fillStyle = watermark.color || '#ffffff';
            ctx.textBaseline = 'middle';
            const pos = watermark.position || 'bottom-right';
            let x, y;
            const text = (watermark.text || '').trim() || 'Watermark';
            const metrics = ctx.measureText(text);
            const tw = metrics.width;
            const th = (watermark.fontSize || 24) * 1.2;
            if (pos === 'top-left') { x = padding; y = padding + th / 2; }
            else if (pos === 'top-right') { x = canvas.width - tw - padding; y = padding + th / 2; }
            else if (pos === 'bottom-left') { x = padding; y = canvas.height - padding - th / 2; }
            else if (pos === 'bottom-right') { x = canvas.width - tw - padding; y = canvas.height - padding - th / 2; }
            else { x = (canvas.width - tw) / 2; y = canvas.height / 2; }
            ctx.fillText(text, x, y);
            ctx.globalAlpha = 1;
            const out = await canvasToPngBytes(canvas);
            window.simpleShot.send('watermark-done', out);
        } catch (err) {
            console.error('Watermark apply error:', err);
            window.simpleShot.send('watermark-error', err instanceof Error ? err.message : 'Unknown error');
        }
    })();
});

window.simpleShot.on('compose-image', ({ pngBuffer, annotations, watermark }) => {
    (async () => {
        try {
            const bitmap = await loadPngBitmap(pngBuffer);
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const ctx = getSrgbContext(canvas);
            const W = canvas.width;
            const H = canvas.height;
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(bitmap, 0, 0);
            if (typeof bitmap.close === 'function') bitmap.close();
            const defStroke = '#000000';
            const defFill = '#ffff00';
            const defFontSize = 16;
            const defPad = 4;
            const defLw = 4;
            function boxBlur(ctx, x0, y0, w, h, radius) {
                radius = Math.max(1, Math.min(radius, 20));
                const x1 = Math.min(W, x0 + w);
                const y1 = Math.min(H, y0 + h);
                x0 = Math.max(0, x0);
                y0 = Math.max(0, y0);
                const id = ctx.getImageData(0, 0, W, H);
                const data = id.data;
                const out = new Uint8ClampedArray(data.length);
                out.set(data);
                for (let py = y0; py < y1; py++) {
                    for (let px = x0; px < x1; px++) {
                        let r = 0, g = 0, b = 0, a = 0, n = 0;
                        for (let ky = Math.max(0, py - radius); ky < Math.min(H, py + radius + 1); ky++) {
                            for (let kx = Math.max(0, px - radius); kx < Math.min(W, px + radius + 1); kx++) {
                                const idx = (ky * W + kx) * 4;
                                r += data[idx]; g += data[idx + 1]; b += data[idx + 2]; a += data[idx + 3];
                                n++;
                            }
                        }
                        const o = (py * W + px) * 4;
                        out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
                    }
                }
                try {
                    ctx.putImageData(new ImageData(out, W, H, { colorSpace: 'srgb' }), 0, 0);
                } catch (_) {
                    ctx.putImageData(new ImageData(out, W, H), 0, 0);
                }
            }
            (annotations || []).forEach(a => {
                const x = (a.x || 0) * W, y = (a.y || 0) * H;
                const rw = (a.w != null ? a.w : 0) * W, rh = (a.h != null ? a.h : 0) * H;
                if (a.type === 'blur' && rw >= 2 && rh >= 2) {
                    boxBlur(ctx, Math.floor(x), Math.floor(y), Math.ceil(rw), Math.ceil(rh), 10);
                }
            });
            (annotations || []).forEach(a => {
                const x = (a.x || 0) * W, y = (a.y || 0) * H;
                const rw = (a.w != null ? a.w : 0) * W, rh = (a.h != null ? a.h : 0) * H;
                const stroke = a.stroke || defStroke;
                const fill = a.fill || defFill;
                const lw = a.borderWidth != null ? a.borderWidth : defLw;
                const fs = a.fontSize != null ? a.fontSize : defFontSize;
                const pad = a.padding != null ? a.padding : defPad;
                if (a.type === 'rect') {
                    ctx.strokeStyle = stroke;
                    ctx.fillStyle = fill;
                    ctx.lineWidth = lw;
                    if (a.filled) ctx.fillRect(x, y, rw, rh);
                    ctx.strokeRect(x, y, rw, rh);
                } else if (a.type === 'circle') {
                    const cx = x + rw / 2, cy = y + rh / 2, rad = Math.min(rw, rh) / 2;
                    ctx.strokeStyle = stroke;
                    ctx.fillStyle = fill;
                    ctx.lineWidth = lw;
                    ctx.beginPath();
                    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
                    if (a.filled) ctx.fill();
                    ctx.stroke();
                } else if (a.type === 'text' || a.type === 'number') {
                    ctx.font = fs + 'px Arial';
                    const tw = ctx.measureText(a.text || '').width;
                    const boxX = x, boxY = y, boxW = tw + pad * 2, boxH = fs + pad * 2;
                    if (a.fillBg) {
                        ctx.fillStyle = fill;
                        ctx.fillRect(boxX, boxY, boxW, boxH);
                    }
                    ctx.fillStyle = stroke;
                    ctx.fillText(a.text || '', boxX + pad, boxY + pad + fs);
                } else if (a.type === 'arrow' && a.x1 != null) {
                    const x1 = a.x1 * W, y1 = a.y1 * H, x2 = a.x2 * W, y2 = a.y2 * H;
                    ctx.strokeStyle = stroke;
                    ctx.fillStyle = stroke;
                    ctx.lineWidth = lw;
                    ctx.lineCap = 'round';
                    ctx.lineJoin = 'round';
                    ctx.beginPath();
                    ctx.moveTo(x1, y1);
                    ctx.lineTo(x2, y2);
                    ctx.stroke();
                    const angle = Math.atan2(y2 - y1, x2 - x1);
                    const headLen = Math.max(10, lw * 4);
                    ctx.beginPath();
                    ctx.moveTo(x2, y2);
                    ctx.lineTo(x2 - headLen * Math.cos(angle - 0.4), y2 - headLen * Math.sin(angle - 0.4));
                    ctx.lineTo(x2 - headLen * Math.cos(angle + 0.4), y2 - headLen * Math.sin(angle + 0.4));
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                } else if (a.type === 'brush' && a.points && a.points.length >= 2) {
                    ctx.strokeStyle = stroke;
                    ctx.lineWidth = lw;
                    ctx.lineCap = 'round';
                    ctx.lineJoin = 'round';
                    ctx.beginPath();
                    ctx.moveTo(a.points[0][0] * W, a.points[0][1] * H);
                    for (let i = 1; i < a.points.length; i++)
                        ctx.lineTo(a.points[i][0] * W, a.points[i][1] * H);
                    ctx.stroke();
                }
            });
            if (watermark && (watermark.text || '').trim()) {
                const padding = 20;
                ctx.font = `${watermark.fontSize || 24}px sans-serif`;
                ctx.globalAlpha = watermark.opacity != null ? watermark.opacity : 0.5;
                ctx.fillStyle = watermark.color || '#ffffff';
                ctx.textBaseline = 'middle';
                const pos = watermark.position || 'bottom-right';
                const text = (watermark.text || '').trim();
                const metrics = ctx.measureText(text);
                const tw = metrics.width;
                const th = (watermark.fontSize || 24) * 1.2;
                let wx, wy;
                if (pos === 'top-left') { wx = padding; wy = padding + th / 2; }
                else if (pos === 'top-right') { wx = W - tw - padding; wy = padding + th / 2; }
                else if (pos === 'bottom-left') { wx = padding; wy = H - padding - th / 2; }
                else if (pos === 'bottom-right') { wx = W - tw - padding; wy = H - padding - th / 2; }
                else { wx = (W - tw) / 2; wy = H / 2; }
                ctx.fillText(text, wx, wy);
                ctx.globalAlpha = 1;
            }
            const out = await canvasToPngBytes(canvas);
            window.simpleShot.send('compose-image-done', out);
        } catch (err) {
            console.error('Compose image error:', err);
            window.simpleShot.send('compose-image-error', err instanceof Error ? err.message : 'Unknown error');
        }
    })();
});

