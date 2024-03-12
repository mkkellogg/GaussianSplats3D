import * as THREE from 'three';
import { PlyParser } from './PlyParser.js';
import { fetchWithProgress, delayedExecute } from '../../Util.js';
import { SplatBuffer } from '../SplatBuffer.js';
import { SplatBufferGenerator } from '../SplatBufferGenerator.js';
import { LoaderStatus } from '../LoaderStatus.js';
import { Constants } from '../../Constants.js';

export class PlyLoader {

    constructor() {
        this.splatBuffer = null;
    }

    loadFromURL(fileName, onProgress, stream, onStreamedSectionProgress, compressionLevel, minimumAlpha,
                sectionSize, sceneCenter, blockSize, bucketSize) {

        let streamBufferIn;
        let streamBufferOut;
        let streamSplatBuffer;
        let lastStreamSectionBytes = 0;
        let streamSectionSizeBytes = 128000; //Constants.StreamingSectionSize;
        let streamedSections = 0;
        let sectionCount = 1;
        let maxSplatCount = 0;
        let splatCount = 0;
        let headerLoaded = false;

        let streamLoadCompleteResolver;
        let streamLoadPromise = new Promise((resolve) => {
            streamLoadCompleteResolver = resolve;
        });

        let bytesLoaded = 0;
        let headerText = '';
        let header = null;
        let chunks = [];
        let lastChunkCheckedForHeader = 0;
        let lastParsedOffsetBytes = 0;

        const localOnProgress = (percent, percentLabel, chunk) => {
            const loadComplete = percent >= 100;
            if (stream) {

                const splatDataOffsetBytes = SplatBuffer.HeaderSizeBytes + SplatBuffer.SectionHeaderSizeBytes;

                if (chunk) {
                    chunks.push({
                        'data': chunk,
                        'sizeBytes': chunk.byteLength,
                        'startBytes': bytesLoaded,
                        'endBytes': bytesLoaded + chunk.byteLength
                    });
                    bytesLoaded += chunk.byteLength;
                }

                if (!headerLoaded) {

                    const decoder = new TextDecoder();
                    for (let i = lastChunkCheckedForHeader; i < chunks.length; i++) {
                        const chunk = chunks[i];
                        headerText += decoder.decode(chunk.data);
                    }
                    lastChunkCheckedForHeader = chunks.length;
    
                    if (PlyParser.checkTextForEndHeader(headerText)) {
                        header = PlyParser.decodeHeaderText(headerText);
                        maxSplatCount = header.splatCount;
                        const splatBufferSizeBytes = splatDataOffsetBytes + SplatBuffer.CompressionLevels[0].BytesPerSplat * maxSplatCount;
                        streamBufferOut = new ArrayBuffer(splatBufferSizeBytes);
                        SplatBuffer.writeHeaderToBuffer({
                            versionMajor: 0,
                            versionMinor: 1,
                            maxSectionCount: sectionCount,
                            sectionCount: sectionCount,
                            maxSplatCount: maxSplatCount,
                            splatCount: splatCount,
                            compressionLevel: 0,
                            sceneCenter: new THREE.Vector3()
                        }, streamBufferOut);

                        lastStreamSectionBytes = header.headerSizeBytes;
                        lastParsedOffsetBytes = header.headerSizeBytes;
                        headerLoaded = true;
                    }

                }

                if (headerLoaded) {

                    if (loadComplete && chunks.length > 0) {

                        let inBytes = 0;
                        for (let chunk of chunks) inBytes += chunk.sizeBytes;

                        if (!streamBufferIn || streamBufferIn.byteLength < inBytes) {
                            streamBufferIn = new ArrayBuffer(inBytes);
                        }

                        let offset = 0;
                        for (let chunk of chunks) {
                            new Uint8Array(streamBufferIn, offset, chunk.sizeBytes).set(chunk.data);
                            offset += chunk.sizeBytes;
                        }

                        const bytesLoadedSinceLastSection = bytesLoaded - lastStreamSectionBytes;
                        if (bytesLoadedSinceLastSection > streamSectionSizeBytes || loadComplete) {
                            const bytesToProcess = bytesLoaded - lastParsedOffsetBytes;
                            const addedSplatCount = Math.floor(bytesToProcess / header.rowSizeBytes);
                            const bytesToParse = addedSplatCount * header.rowSizeBytes;
                            const leftOverBytes = bytesToProcess - bytesToParse;
                            const newSplatCount = splatCount + addedSplatCount;
                            const parseDataView = new DataView(streamBufferIn, lastParsedOffsetBytes - chunks[0].startBytes, bytesToParse);

                            const outOffset = splatCount * SplatBuffer.CompressionLevels[0].BytesPerSplat + splatDataOffsetBytes;
                            PlyParser.parseToUncompressedSplatBufferSection(header, 0, addedSplatCount - 1, parseDataView, 0, streamBufferOut, outOffset);

                            splatCount = newSplatCount;
                            if (!streamSplatBuffer) {
                                SplatBuffer.writeSectionHeaderToBuffer({
                                    maxSplatCount: maxSplatCount,
                                    splatCount: splatCount,
                                    bucketSize: 0,
                                    bucketCount: 0,
                                    bucketBlockSize: 0,
                                    compressionScaleRange: 0,
                                    storageSizeBytes: 0,
                                    fullBucketCount: 0,
                                    partiallyFilledBucketCount: 0
                                }, 0, streamBufferOut, SplatBuffer.HeaderSizeBytes);
                                streamSplatBuffer = new SplatBuffer(streamBufferOut, false);
                            }
                            streamSplatBuffer.updateLoadedCounts(1, splatCount);
                            onStreamedSectionProgress(streamSplatBuffer, loadComplete);
                            lastStreamSectionBytes += streamSectionSizeBytes;
                            lastParsedOffsetBytes += bytesToParse;

                            if (leftOverBytes === 0) {
                                chunks = [];
                            } else {
                                let keepChunks = [];
                                let keepSize = 0;
                                for (let i = chunks.length - 1; i >= 0; i--) {
                                    const chunk = chunks[i];
                                    keepSize += chunk.sizeBytes;

                                    keepChunks.unshift(chunk);
                                    if (keepSize >= leftOverBytes) break;
                                }
                                chunks = keepChunks;
                            }
                            streamedSections++;
                        }
                    } 

                    if (loadComplete) {
                        streamLoadCompleteResolver();
                    }
                }

            }
            if (onProgress) onProgress(percent, percentLabel, LoaderStatus.Downloading);
        };

        return fetchWithProgress(fileName, localOnProgress, !stream).then((plyFileData) => {
            if (onProgress) onProgress(0, '0%', LoaderStatus.Processing);
            if (stream) {
                return streamLoadPromise.then(() => {
                    if (onProgress) onProgress(100, '100%', LoaderStatus.Done);
                    return streamSplatBuffer;
                });
            } else {
                return delayedExecute(() => {
                    return PlyParser.parseToUncompressedSplatArray(plyFileData);
                })
                .then((splatArray) => {
                    const splatBufferGenerator = SplatBufferGenerator.getStandardGenerator(minimumAlpha, compressionLevel, sectionSize,
                                                                                           sceneCenter, blockSize, bucketSize);
                    const splatBuffer = splatBufferGenerator.generateFromUncompressedSplatArray(splatArray);
                    if (onProgress) onProgress(100, '100%', LoaderStatus.Done);
                    return splatBuffer;
                });
            }
        });
    }

}
