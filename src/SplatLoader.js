export class SplatLoader {

    constructor(splatBuffer = null) {
        this.splatBuffer = splatBuffer;
        this.downLoadLink = null;
    }

    loadFromFile(fileName) {
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

    setFromBuffer(splatBuffer) {
        this.splatBuffer = splatBuffer;
    }

    saveToFile(fileName) {
        const splatData = new Uint8Array(this.splatBuffer);
        const blob = new Blob([splatData.buffer], {
            type: "application/octet-stream",
        });
       
        if (!this.downLoadLink) {
            this.downLoadLink = document.createElement("a");
            document.body.appendChild(this.downLoadLink);
        }
        this.downLoadLink.download = fileName;
        this.downLoadLink.href = URL.createObjectURL(blob);
        this.downLoadLink.click();
    }

}