import { PlyLoader } from './PlyLoader.js';
import { SplatLoader } from './SplatLoader.js';

export class Viewer {

    constructor() {
    }

    loadFile(fileName) {
        return new Promise((resolve, reject) => {
            let loadPromise;
            if (fileName.endsWith('.splat')) {
                loadPromise = new SplatLoader().loadFromFile(fileName);
            } else if (fileName.endsWith('.ply')) {
                loadPromise = new PlyLoader().loadFromFile(fileName);
            } else {
                throw new Error(`Viewer::loadFile -> File format not supported: ${fileName}`);
            }
            loadPromise
            .then((splatBuffer) => {
                resolve();
            })
            .catch(() => {
                reject(new Error(`Viewer::loadFile -> Could not load file ${fileName}`));
            })
        });
    }

    start() {

    }

    update() {

    }

}