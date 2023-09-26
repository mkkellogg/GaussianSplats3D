import { PlyParser } from './PlyParser.js';

export class PlyLoader {

    constructor() {
    }

    fetchFile(fileName){
        return new Promise((resolve, reject) => {
            fetch(fileName)
            .then((res) => {
                res.arrayBuffer()
                .then((data) => {
                    resolve(data);
                })
                .catch((err) => {
                    reject(err);
                });
            })
            .catch((err) => {
                reject(err);
            });
        });
    }

    load(fileName){
        const loadPromise = this.fetchFile(fileName);
        loadPromise.then((fileData) => {
            const plyParser = new PlyParser(fileData);
            const parsedData = plyParser.parse();
            console.log(parsedData);
        });
        return loadPromise;
    }

}
