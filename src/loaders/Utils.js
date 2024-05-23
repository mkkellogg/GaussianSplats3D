import { SceneFormat } from './SceneFormat.js';

export const sceneFormatFromPath = (path) => {
    path = getPathFromURL(path);
    if (path.endsWith('.ply')) return SceneFormat.Ply;
    else if (path.endsWith('.splat')) return SceneFormat.Splat;
    else if (path.endsWith('.ksplat')) return SceneFormat.KSplat;
    return null;
};


function getPathFromURL(url) {
    const regex = /^[^?#]*(?=\?|\#|$)/;
    const match = regex.exec(url);
    return match ? match[0] : '';
}
