import * as GaussianSplats3D from '../build/gaussian-splats-3d.module.js';
import * as fs from 'fs';

if (process.argv.length < 4) {
    console.log('Expected at least 2 arguments!');
    console.log('Usage: node create_splat.js [path to .PLY or .SPLAT] [output file name] [compression level = 0] [alpha removal threshold = 1] [block size = 5.0] [bucket size = 256]');
    process.exit(1);
}

const intputFile = process.argv[2];
const outputFile = process.argv[3];
const compressionLevel = (process.argv.length >= 5) ? parseInt(process.argv[4]) : 0;
const splatAlphaRemovalThreshold = (process.argv.length >= 6) ? parseInt(process.argv[5]) : 1;
const blockSize = (process.argv.length >= 7) ? parseFloat(process.argv[6]) : 5.0;
const bucketSize = (process.argv.length >= 8) ? parseInt(process.argv[7]) : 256;

const fileData = fs.readFileSync(intputFile);
const isPly = intputFile.toLowerCase().trim().endsWith('.ply');
const isStandardSplat = GaussianSplats3D.SplatLoader.isStandardSplatFormat(intputFile);
const splatBuffer = fileBufferToSplatBuffer(fileData.buffer, isPly, isStandardSplat, compressionLevel, splatAlphaRemovalThreshold);

const headerData = new Uint8Array(splatBuffer.getHeaderBufferData());
const splatData = new Uint8Array(splatBuffer.getSplatBufferData());
const combined = new Uint8Array(headerData.byteLength + splatData.byteLength);
combined.set(headerData, 0);
combined.set(splatData, headerData.byteLength);

fs.writeFileSync(outputFile, combined);


function fileBufferToSplatBuffer(fileBufferData, isPly, isStandardSplat, compressionLevel, alphaRemovalThreshold) {
    let splatBuffer;
    if (isPly) {
        const plyParser = new GaussianSplats3D.PlyParser(fileData.buffer);
        splatBuffer = plyParser.parseToSplatBuffer(compressionLevel, alphaRemovalThreshold, blockSize, bucketSize);
    } else {
        if (isStandardSplat) {
            const splatArray = GaussianSplats3D.SplatLoader.parseStandardSplatToUncompressedSplatArray(fileBufferData);
            const splatCompressor = new GaussianSplats3D.SplatCompressor(compressionLevel, alphaRemovalThreshold, blockSize, bucketSize);
            splatBuffer = splatCompressor.uncompressedSplatArrayToSplatBuffer(splatArray);
        } else {
            splatBuffer = new GaussianSplats3D.SplatBuffer(fileBufferData);
        }
    }
    return splatBuffer;
}
