export const fadeElement = (element, out, displayStyle, duration, onComplete) => {
    const startTime = performance.now();

    let startOpacity = element.style.display === 'none' ? 0 : parseFloat(element.style.opacity);
    if (isNaN(startOpacity)) startOpacity = 1;

    const interval = window.setInterval(() => {
        const currentTime = performance.now();
        const elapsed = currentTime - startTime;

        let t = Math.min(elapsed / duration, 1.0);
        if (t > 0.999) t = 1;

        let opacity;
        if (out) {
            opacity = (1.0 - t) * startOpacity;
            if (opacity < 0.0001) opacity = 0;
        } else {
            opacity = (1.0 - startOpacity) * t + startOpacity;
        }

        if (opacity > 0) {
            element.style.display = displayStyle;
            element.style.opacity = opacity;
        } else {
            element.style.display = 'none';
        }

        if (t >= 1) {
            if (onComplete) onComplete();
            window.clearInterval(interval);
        }
    }, 16);
    return interval;
};

export const cancelFade = (interval) => {
    window.clearInterval(interval);
};
