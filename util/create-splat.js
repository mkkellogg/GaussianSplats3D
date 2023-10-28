import * as GaussianSplats3D from '../build/gaussian-splat-3d.module.js';
import * as fs from 'fs';

if (process.argv.length < 4) {
    console.log('Expected at least 2 arguments!');
    console.log('Usage: node create_splat.js [path to .PLY] [output file name] [compression level = 0] [alpha removal threshold = 1]');
    process.exit(1);
}

const intputFile = process.argv[2];
const outputFile = process.argv[3];
const compressionLevel = (process.argv.length >= 5) ? parseInt(process.argv[4]) : 0;
const splatAlphaRemovalThreshold = (process.argv.length >= 6) ? parseInt(process.argv[5]) : 1;

const fileData = fs.readFileSync(intputFile);
const plyParser = new GaussianSplats3D.PlyParser(fileData.buffer);
const splatBuffer = plyParser.parseToSplatBuffer(compressionLevel, splatAlphaRemovalThreshold);

const headerData = new Uint8Array(splatBuffer.getHeaderBufferData());
const splatData = new Uint8Array(splatBuffer.getSplatBufferData());
const combined = new Uint8Array(headerData.buffer.byteLength + splatData.buffer.byteLength);
combined.set(headerData.buffer, 0);
combined.set(splatData.buffer, headerData.buffer.byteLength);

fs.writeFileSync(outputFile, combined);
