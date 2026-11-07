window.__t = {};
window.simpleShot.invoke('get-translations', lang).then(t => {
    if (t) window.__t = t;
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const k = el.getAttribute('data-i18n');
        if (k && window.__t[k]) el.textContent = window.__t[k];
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const k = el.getAttribute('data-i18n-placeholder');
        if (k && window.__t[k]) el.placeholder = window.__t[k];
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const k = el.getAttribute('data-i18n-title');
        if (k && window.__t[k]) el.title = window.__t[k];
    });
}).catch(() => {});
