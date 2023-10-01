import * as GaussianSplat3D from '../lib/gaussian-splat-3d.module.js';


const load = async (url) => {
    const metaUrl = new URL(url, location.href);
    const meta = await (await fetch(metaUrl)).json().catch(()=>{
        alert(`Invalid asset url: ${url}`);
        location.href = '/';
    });

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
