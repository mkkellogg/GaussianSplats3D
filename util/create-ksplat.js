import * as GaussianSplats3D from '../build/gaussian-splats-3d.module.js';
import * as fs from 'fs';

if (process.argv.length < 4) {
    console.log('Expected at least 2 arguments!');
    console.log('Usage: node create-ksplat.js [path to .PLY or .SPLAT] [output file name] [compression level = 0] [alpha removal threshold = 1] [scene center = "0,0,0"] [block size = 5.0] [bucket size = 256]');
    process.exit(1);
}

const intputFile = process.argv[2];
const outputFile = process.argv[3];
const splatAlphaRemovalThreshold = (process.argv.length >= 6) ? parseInt(process.argv[5]) : undefined;
const compressionLevel = (process.argv.length >= 5) ? parseInt(process.argv[4]) : undefined;
const sceneCenter = (process.argv.length >= 6) ? new THREE.Vector3().fromArray(process.argv[5].split(',')) : undefined;
const blockSize = (process.argv.length >= 7) ? parseFloat(process.argv[6]) : undefined;
const bucketSize = (process.argv.length >= 8) ? parseInt(process.argv[7]) : undefined;
const sectionSize = 0;

const fileData = fs.readFileSync(intputFile);
const path = intputFile.toLowerCase().trim();
const format = GaussianSplats3D.LoaderUtils.sceneFormatFromPath(path);
const splatBuffer = fileBufferToSplatBuffer(fileData.buffer, format, compressionLevel, splatAlphaRemovalThreshold);

fs.writeFileSync(outputFile, splatBuffer.bufferData);

function fileBufferToSplatBuffer(fileBufferData, format, compressionLevel, alphaRemovalThreshold) {
    let splatBuffer;
    if (format === GaussianSplats3D.SceneFormat.Ply || format === GaussianSplats3D.SceneFormat.Splat) {
        let splatArray;
        if (format === GaussianSplats3D.SceneFormat.Ply) {
            splatArray = GaussianSplats3D.PlyParser.parseToUncompressedSplatArray(fileBufferData);
        } else {
            splatArray = GaussianSplats3D.SplatParser.parseStandardSplatToUncompressedSplatArray(fileBufferData);
        }
        const splatBufferGenerator = GaussianSplats3D.SplatBufferGenerator.getStandardGenerator(alphaRemovalThreshold, compressionLevel,
                                                                                                sectionSize, sceneCenter, blockSize, bucketSize);
        splatBuffer = splatBufferGenerator.generateFromUncompressedSplatArray(splatArray);
    } else {
        splatBuffer = new GaussianSplats3D.SplatBuffer(fileBufferData);
    }

    return splatBuffer;
}
