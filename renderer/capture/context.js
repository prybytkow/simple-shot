window.Capture = window.Capture || { state: {} };
const urlParams = new URLSearchParams(window.location.search);
const screenId = urlParams.get('screenId');
const totalScreens = urlParams.get('totalScreens');
const lang = urlParams.get('lang') || 'en';
const captureMode = urlParams.get('mode') || 'region';
const displayIdParam = urlParams.get('displayId');
// Размер области захвата: берём максимум из main process (actualWidth/Height) и текущего окна (innerWidth/Height),
// чтобы на любых мониторах можно было выделить весь видимый экран
let screenWidth = Math.max(1, Math.max(parseInt(urlParams.get('actualWidth'), 10) || 0, window.innerWidth || 0) || 1920);
let screenHeight = Math.max(1, Math.max(parseInt(urlParams.get('actualHeight'), 10) || 0, window.innerHeight || 0) || 1080);
if (captureMode === 'fixed') {
    const iw = parseInt(urlParams.get('imageWidth'), 10);
    const ih = parseInt(urlParams.get('imageHeight'), 10);
    if (iw > 0) screenWidth = iw;
    if (ih > 0) screenHeight = ih;
}

