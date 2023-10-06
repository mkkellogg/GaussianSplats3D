import * as GaussianSplat3D from '../../../lib/gaussian-splat-3d.module.js';

export class Scene {

    constructor() {
    }

    load() {
        const viewer = new GaussianSplat3D.Viewer(null, [0, -1, -1.0], [-3.3816, 1.96931, -1.71890], [0.60910, 1.42099, 2.02511], 30);
        viewer.init();
        viewer.loadFile('assets/data/stump/stump.splat')
        .then(() => {
            viewer.start();
        });
    }
}