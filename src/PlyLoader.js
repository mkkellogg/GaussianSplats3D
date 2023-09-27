import { PlyParser } from './PlyParser.js';

export class PlyLoader {

    constructor() {
        this.splatBuffer = null;
    }

    fetchFile(fileName){
        return new Promise((resolve, reject) => {
            fetch(fileName)
            .then((res) => {
                return res.arrayBuffer()
            })
            .then((data) => {
                resolve(data);
            })
            .catch((err) => {
                reject(err);
            });
        });
    }

    loadFromFile(fileName){
        return new Promise((resolve, reject) => {
            const loadPromise = this.fetchFile(fileName);
            loadPromise
            .then((plyFileData) => {
                const plyParser = new PlyParser(plyFileData);
                const splatBuffer = plyParser.parseToSplatBuffer();
                this.splatBuffer = splatBuffer;
                resolve(splatBuffer);                
            })
            .catch((err) => {
                reject(err);
            });
        });
    }

}
