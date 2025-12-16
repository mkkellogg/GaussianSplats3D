import { SceneFormat } from './SceneFormat.js';

export const sceneFormatFromPath = (path) => {
    try {
      const url = new URL(path);
      path = url.pathname;
    } catch (e) {
      // Ignore error, path is not a URL
    }
    if (path.endsWith('.ply')) return SceneFormat.Ply;
    else if (path.endsWith('.splat')) return SceneFormat.Splat;
    else if (path.endsWith('.ksplat')) return SceneFormat.KSplat;
    else if (path.endsWith('.spz')) return SceneFormat.Spz;
    return null;
};
