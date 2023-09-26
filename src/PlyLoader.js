import { PlyParser } from './PlyParser.js';

export class PlyLoader {

    constructor() {
    }

    load(fileName){
        return new Promise((resolve, reject) => {
            fetch(fileName)
            .then((data) => {
                resolve(data);
            })
            .catch((err) => {
                reject(err);
            });
        });
    }

}