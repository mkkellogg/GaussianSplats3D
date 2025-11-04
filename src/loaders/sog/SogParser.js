import * as THREE from 'three';
import { UncompressedSplatArray } from '../UncompressedSplatArray.js';

async function loadImagePixels(src, typeHint) {
    let blob;
    if (src instanceof Blob) {
        blob = src;
    } else if (typeof src === 'string') {
        const resp = await fetch(src);
        blob = await resp.blob();
    } else {
        throw new Error('Unsupported image source');
    }

    try {
        if (typeof ImageDecoder !== 'undefined') {
            const decoder = new ImageDecoder({ data: blob, type: blob.type || typeHint || 'image/webp' });
            const { image } = await decoder.decode();
            const width = image.displayWidth || image.codedWidth;
            const height = image.displayHeight || image.codedHeight;
            const data = new Uint8ClampedArray(width * height * 4);
            await image.copyTo(data, { format: 'RGBA' });
            image.close();
            return { data, width, height };
        }
    } catch (e) {}

    const bitmap = await createImageBitmap(blob);
    const width = bitmap.width;
    const height = bitmap.height;
    let ctx;
    let canvas;
    if (typeof OffscreenCanvas !== 'undefined') {
        canvas = new OffscreenCanvas(width, height);
        ctx = canvas.getContext('2d');
    } else {
        canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        ctx = canvas.getContext('2d');
    }
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, width, height);
    return { data: imageData.data, width, height };
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}
function unlog(n) {
    return Math.sign(n) * (Math.exp(Math.abs(n)) - 1);
}

function reconstructQuaternion(r, g, b, a) {
    const comp = (c) => (c / 255 - 0.5) * 2.0 / Math.SQRT2;
    const A = comp(r);
    const B = comp(g);
    const C = comp(b);
    const mode = a - 252;
    const t = A*A + B*B + C*C;
    const D = Math.sqrt(Math.max(0, 1 - t));
    let qx;
    let qy;
    let qz;
    let qw;
    switch (mode) {
        case 0:
            qx = D; qy = A; qz = B; qw = C; break;
        case 1:
            qx = A; qy = D; qz = B; qw = C; break;
        case 2:
            qx = A; qy = B; qz = D; qw = C; break;
        case 3:
            qx = A; qy = B; qz = C; qw = D; break;
        default: throw new Error('Invalid quaternion mode');
    }
    const q = new THREE.Quaternion(qx, qy, qz, qw);
    if (q.w < 0) {
        q.x = -q.x;
        q.y = -q.y;
        q.z = -q.z;
        q.w = -q.w;
    }
    return q.normalize();
}

export class SogParser {
    static async parse(meta, baseURLOrResolver) {
        const resolve = async (name) => {
            const url = typeof baseURLOrResolver === 'function' ? await baseURLOrResolver(name) : `${baseURLOrResolver}${name}`;
            return loadImagePixels(url);
        };

        const [meansL, meansU, quats, scalesImg, sh0Img] = await Promise.all([
            resolve(meta.means.files[0]),
            resolve(meta.means.files[1]),
            resolve(meta.quats.files[0]),
            resolve(meta.scales.files[0]),
            resolve(meta.sh0.files[0])
        ]);

        const width = meansL.width;
        const height = meansL.height;
        const capacity = width * height;
        const count = Math.min(meta.count, capacity);

        let degree = 0;
        let shNCoeffsTotal = 0;
        let shNCoeffsWanted = 0;
        if (meta.shN && meta.shN.bands) {
            const bands = meta.shN.bands;
            degree = Math.min(bands, 2);
            shNCoeffsTotal = [0, 3, 8, 15][bands];
            shNCoeffsWanted = [0, 3, 8][degree];
        }
        const splats = new UncompressedSplatArray(degree);

        const mins = meta.means.mins;
        const maxs = meta.means.maxs;
        const sh0Codebook = meta.sh0.codebook;
        const scaleCodebook = meta.scales.codebook;

        let labelsImg = null;
        let centroidsImg = null;
        let shNCodebook = null;
        if (degree > 0) {
            const f0 = meta.shN.files[0];
            const f1 = meta.shN.files[1];
            const firstIsLabels = /label/i.test(f0);
            const [imgA, imgB] = await Promise.all([
                resolve(f0),
                resolve(f1)
            ]);
            labelsImg = firstIsLabels ? imgA : imgB;
            centroidsImg = firstIsLabels ? imgB : imgA;
            shNCodebook = meta.shN.codebook;
        }

        for (let i = 0; i < count; i++) {
            const x = i % width;
            const y = (i / width) | 0;
            const idx = (x + y * width) * 4;

            const qx = (meansU.data[idx + 0] << 8) | meansL.data[idx + 0];
            const qy = (meansU.data[idx + 1] << 8) | meansL.data[idx + 1];
            const qz = (meansU.data[idx + 2] << 8) | meansL.data[idx + 2];
            const nx = lerp(mins[0], maxs[0], qx / 65535);
            const ny = lerp(mins[1], maxs[1], qy / 65535);
            const nz = lerp(mins[2], maxs[2], qz / 65535);
            const px = unlog(nx);
            const py = unlog(ny);
            const pz = unlog(nz);

            const sx = Math.exp(scaleCodebook[scalesImg.data[idx + 0]]);
            const sy = Math.exp(scaleCodebook[scalesImg.data[idx + 1]]);
            const sz = Math.exp(scaleCodebook[scalesImg.data[idx + 2]]);

            const q = reconstructQuaternion(quats.data[idx + 0], quats.data[idx + 1], quats.data[idx + 2], quats.data[idx + 3]);

            const SH_C0 = 0.28209479177387814;
            const r = 0.5 + sh0Codebook[sh0Img.data[idx + 0]] * SH_C0;
            const g = 0.5 + sh0Codebook[sh0Img.data[idx + 1]] * SH_C0;
            const b = 0.5 + sh0Codebook[sh0Img.data[idx + 2]] * SH_C0;
            const aByte = sh0Img.data[idx + 3];

            if (degree === 0) {
                splats.addSplatFromComponents(px, py, pz, sx, sy, sz, q.x, q.y, q.z, q.w, r * 255, g * 255, b * 255, aByte);
            } else {
                const restCount = splats.sphericalHarmonicsCount;
                const rest = new Array(restCount).fill(0);
                const label = labelsImg.data[idx + 0] | (labelsImg.data[idx + 1] << 8);
                if (label < (meta.shN.count || 0) && shNCodebook) {
                    // SH coefficients are stored in interleaved format: [R0, R1, R2, G0, G1, G2, B0, B1, B2, ...]
                    // For degree 1: 3 coeffs per channel → indices [0,1,2, 3,4,5, 6,7,8]
                    // For degree 2: 8 coeffs per channel → indices [0,1,2, 3,4,5, 6,7,8, 9,10,11, 12,13,14, 15,16,17, 18,19,20, 21,22,23]
                    const shIndexMap = [
                        0, 1, 2, 9, 10, 11, 12, 13, 24, 25, 26, 27, 28, 29, 30,  // R channel indices
                        3, 4, 5, 14, 15, 16, 17, 18, 31, 32, 33, 34, 35, 36, 37,  // G channel indices
                        6, 7, 8, 19, 20, 21, 22, 23, 38, 39, 40, 41, 42, 43, 44   // B channel indices
                    ];
                    for (let j = 0; j < 3; j++) {
                        for (let k = 0; k < shNCoeffsWanted; k++) {
                            const u = (label % 64) * shNCoeffsTotal + k;
                            const v = Math.floor(label / 64);
                            if (u < centroidsImg.width && v < centroidsImg.height) {
                                const cidx = (v * centroidsImg.width + u) * 4;
                                const codebookIdx = centroidsImg.data[cidx + j];
                                const outIndex = shIndexMap[j * 15 + k];
                                if (outIndex < restCount) {
                                    rest[outIndex] = shNCodebook[codebookIdx] ?? 0;
                                }
                            }
                        }
                    }
                }
                splats.addSplatFromComponents(px, py, pz, sx, sy, sz, q.x, q.y, q.z, q.w, r * 255, g * 255, b * 255, aByte, ...rest);
            }
        }

        return splats;
    }
}
