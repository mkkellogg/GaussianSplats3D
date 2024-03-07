import { SceneFormat } from './SceneFormat.js';

export const sceneFormatFromPath = (path) => {
    if (path.endsWith('.ply')) return SceneFormat.Ply;
    else if (path.endsWith('.splat')) return SceneFormat.Splat;
    else if (path.endsWith('.ksplat')) return SceneFormat.KSplat;
    return null;
};
