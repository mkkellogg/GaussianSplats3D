import * as THREE from 'three';
import { SogParser } from './SogParser.js';
import { SplatBuffer } from '../SplatBuffer.js';
import { SplatBufferGenerator } from '../SplatBufferGenerator.js';
// Note: progress utilities available, but not used here to keep loader minimal
import { unzipStoredEntries } from './ZipReaderBrowser.js';
import { LoaderStatus } from '../LoaderStatus.js';
import { delayedExecute } from '../../Util.js';
async function fetchJSON(url, headers) {
    const resp = await fetch(url, { headers });
    if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status} ${resp.statusText}`);
    return resp.json();
}

function finalize(splatArray, optimizeSplatData, minimumAlpha, compressionLevel, sectionSize, sceneCenter, blockSize, bucketSize) {
    if (optimizeSplatData) {
        const gen = SplatBufferGenerator.getStandardGenerator(
            minimumAlpha, compressionLevel, sectionSize, sceneCenter, blockSize, bucketSize
        );
        return gen.generateFromUncompressedSplatArray(splatArray);
    } else {
        return SplatBuffer.generateFromUncompressedSplatArrays([splatArray], minimumAlpha, 0, new THREE.Vector3());
    }
}

export class SogLoader {
    // Multi-file SOG directory: baseURL ends with '/'; expects meta.json and the image files next to it
    static async loadFromDirectoryURL(baseURL, onProgress, minimumAlpha, compressionLevel,
                                      optimizeSplatData = true, headers, sectionSize, sceneCenter, blockSize, bucketSize) {
        const isMeta = baseURL.toLowerCase().endsWith('meta.json');
        const dir = isMeta ? baseURL.slice(0, baseURL.lastIndexOf('/') + 1) : (baseURL.endsWith('/') ? baseURL : (baseURL + '/'));
        const metaURL = isMeta ? baseURL : (dir + 'meta.json');
        if (onProgress) onProgress(0, '0%', LoaderStatus.Downloading);
        const meta = await fetchJSON(metaURL, headers);
        if (onProgress) onProgress(0, '0%', LoaderStatus.Processing);
        const splatArray = await SogParser.parse(meta, (name) => dir + name);
        const buffer = finalize(
            splatArray, optimizeSplatData, minimumAlpha, compressionLevel,
            sectionSize, sceneCenter, blockSize, bucketSize
        );
        if (onProgress) onProgress(100, '100%', LoaderStatus.Done);
        return buffer;
    }

    // Bundled .sog: a ZIP whose root contains meta.json and files it references
    static async loadFromZipURL(fileURL, onProgress, minimumAlpha, compressionLevel,
                                optimizeSplatData = true, headers, sectionSize, sceneCenter, blockSize, bucketSize) {
        if (onProgress) onProgress(0, '0%', LoaderStatus.Downloading);
        const resp = await fetch(fileURL, { headers });
        if (!resp.ok) throw new Error(`Failed to fetch ${fileURL}: ${resp.status} ${resp.statusText}`);
        const arrayBuffer = await resp.arrayBuffer();
        if (onProgress) onProgress(0, '0%', LoaderStatus.Processing);
        const entries = unzipStoredEntries(arrayBuffer);
        const metaBytes = entries.get('meta.json');
        if (!metaBytes) throw new Error('SOG archive missing meta.json at root');
        const meta = JSON.parse(new TextDecoder().decode(metaBytes));

        const resolver = (name) => {
            const bytes = entries.get(name);
            if (!bytes) throw new Error(`SOG archive missing file: ${name}`);
            return new Blob([bytes], { type: 'image/webp' });
        };
        const splatArray = await SogParser.parse(meta, resolver);
        const buffer = finalize(
            splatArray, optimizeSplatData, minimumAlpha, compressionLevel,
            sectionSize, sceneCenter, blockSize, bucketSize
        );
        if (onProgress) onProgress(100, '100%', LoaderStatus.Done);
        return buffer;
    }

    static async loadFromFileHandles(metaJSON, fileResolver, onProgress, minimumAlpha, compressionLevel,
                                     optimizeSplatData = true, sectionSize, sceneCenter, blockSize, bucketSize) {
        // metaJSON is already-parsed meta; fileResolver(name) -> Blob or URL
        if (onProgress) onProgress(0, '0%', LoaderStatus.Processing);
        const splatArray = await SogParser.parse(metaJSON, fileResolver);
        const buffer = finalize(
            splatArray, optimizeSplatData, minimumAlpha, compressionLevel,
            sectionSize, sceneCenter, blockSize, bucketSize
        );
        if (onProgress) onProgress(100, '100%', LoaderStatus.Done);
        return buffer;
    }

    static  loadFromFileData(fileData, minimumAlpha, compressionLevel, optimizeSplatData,
        sectionSize, sceneCenter, blockSize, bucketSize) 
    {
        return delayedExecute( async () => {
            const arrayBuffer = fileData;
            const entries = unzipStoredEntries(arrayBuffer);
            const metaBytes = entries.get('meta.json');
            if (!metaBytes) throw new Error('SOG archive missing meta.json at root');
            const meta = JSON.parse(new TextDecoder().decode(metaBytes));

            const resolver = (name) => {
                const bytes = entries.get(name);
                if (!bytes) throw new Error(`SOG archive missing file: ${name}`);
                return new Blob([bytes], { type: 'image/webp' });
            };
            const splatArray = await SogParser.parse(meta, resolver);
            const buffer = finalize(
                splatArray, optimizeSplatData, minimumAlpha, compressionLevel,
                sectionSize, sceneCenter, blockSize, bucketSize
            );
            return buffer;
        });
    }
}
