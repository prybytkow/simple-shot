window.Capture = window.Capture || { state: {} };
(function() {
const urlParams = new URLSearchParams(window.location.search);
const screenId = urlParams.get('screenId');
const scaleFactor = parseFloat(urlParams.get('scaleFactor')) || 1;
const actualWidth = parseInt(urlParams.get('actualWidth'), 10);
const actualHeight = parseInt(urlParams.get('actualHeight'), 10);
const screenW = Math.max(1, Math.max(actualWidth || 0, window.innerWidth || 0) || 1920);
const screenH = Math.max(1, Math.max(actualHeight || 0, window.innerHeight || 0) || 1080);

console.log(`Screen ${screenId} info:`, {
scaleFactor, actualWidth, actualHeight,
screenSize: { width: screenW, height: screenH },
windowInner: { width: window.innerWidth, height: window.innerHeight }
});

// Динамически устанавливаем размеры overlay по размерам экрана из main process
function setOverlaySize() {
const overlay = document.getElementById('overlay');
if (overlay) {
    overlay.style.width = screenW + 'px';
    overlay.style.height = screenH + 'px';
}
document.body.style.width = screenW + 'px';
document.body.style.height = screenH + 'px';
}

document.addEventListener('DOMContentLoaded', setOverlaySize);

// Также обрабатываем ресайз окна
window.addEventListener('resize', () => {
setOverlaySize();
});
})();

