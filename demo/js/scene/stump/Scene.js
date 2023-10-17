import * as GaussianSplat3D from '../../../lib/gaussian-splat-3d.module.js';

export class Scene {

    constructor() {
    }

    load() {
        const viewer = new GaussianSplat3D.Viewer({
            'cameraUp': [0, -1, -1.0],
            'initialCameraPosition': [-3.3816, 1.96931, -1.71890],
            'initialCameraLookAt': [0.60910, 1.42099, 2.02511],
            'splatAlphaRemovalThreshold': 30
        });
        viewer.init();
        viewer.loadFile('assets/data/stump/stump.splat')
        .then(() => {
            viewer.start();
        });
    }
}
