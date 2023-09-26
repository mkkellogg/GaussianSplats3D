import { PlyLoader } from './PlyLoader.js';
import { SplatLoader } from './SplatLoader.js';

export class Viewer {

    constructor() {
    }

    loadFile(fileName) {
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
            
        })
        .catch((err) => {
            throw new Error(`Viewer::loadFile -> Could not load file ${fileName}`);
        })
    }

    update() {

    }

}