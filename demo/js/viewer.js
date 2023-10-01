import * as GaussianSplat3D from '../lib/gaussian-splat-3d.module.js';


const load = async (metaUrl) => {
    metaUrl = new URL(metaUrl, location.href);
    const meta = await (await fetch(metaUrl)).json();
    const {
        data,
        cameraUp,
        cameraPos,
        cameraTarget,
    } = meta;

    const viewer = new GaussianSplat3D.Viewer(
        null,
        cameraUp,
        cameraPos,
        cameraTarget
    );

    viewer.init();

    const dataUrl = new URL(data, metaUrl);

    await viewer.loadFile(dataUrl.href);

    viewer.start();

    return viewer;
};

(async () => {
    const url = new URLSearchParams(location.search).get('asset');

    !url && alert('Require a asset url');

    await load(url);

})();
