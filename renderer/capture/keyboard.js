function closeAllWindows() {
    window.simpleShot.send('close-all-windows');
}

// Закрытие по ESC
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (uploadBusy) return;
        const status = document.getElementById('upload-status');
        if (status && status.classList.contains('visible')) {
            hideUploadStatus();
            closeAllWindows();
            return;
        }
        closeAllWindows();
    }
});
