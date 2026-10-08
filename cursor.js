const cursorDot = document.getElementById('cursorDot');

window.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch') {
        cursorDot.classList.remove('is-visible');
        return;
    }

    cursorDot.style.left = `${event.clientX}px`;
    cursorDot.style.top = `${event.clientY}px`;
    cursorDot.classList.add('is-visible');
});

window.addEventListener('pointerleave', () => {
    cursorDot.classList.remove('is-visible');
});
