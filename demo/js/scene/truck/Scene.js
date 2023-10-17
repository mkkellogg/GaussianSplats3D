import * as GaussianSplat3D from '../../../lib/gaussian-splat-3d.module.js';

export class Scene {

    constructor() {
    }

    load() {
        const viewer = new GaussianSplat3D.Viewer({
            'cameraUp': [0, -1, -.17],
            'initialCameraPosition': [-5, -1, -1],
            'initialCameraLookAt': [1, 1, 0],
            'splatAlphaRemovalThreshold': 10
        });
        viewer.init();
        viewer.loadFile('assets/data/truck/truck.splat')
        .then(() => {
            viewer.start();
        });
    }
}
