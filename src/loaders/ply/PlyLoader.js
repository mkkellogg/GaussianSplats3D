import * as THREE from 'three';
import { PlyParser } from './PlyParser.js';
import { CompressedPlyParser } from './CompressedPlyParser.js';
import { fetchWithProgress, delayedExecute } from '../../Util.js';
import { SplatBuffer } from '../SplatBuffer.js';
import { SplatBufferGenerator } from '../SplatBufferGenerator.js';
import { LoaderStatus } from '../LoaderStatus.js';
import { Constants } from '../../Constants.js';

function storeChunksInBuffer(chunks, buffer) {
    let inBytes = 0;
    for (let chunk of chunks) inBytes += chunk.sizeBytes;

    if (!buffer || buffer.byteLength < inBytes) {
        buffer = new ArrayBuffer(inBytes);
    }

    let offset = 0;
    for (let chunk of chunks) {
        new Uint8Array(buffer, offset, chunk.sizeBytes).set(chunk.data);
        offset += chunk.sizeBytes;
    }

    return buffer;
}

export class PlyLoader {

    static loadFromURL(fileName, onProgress, streamLoadData, onStreamedSectionProgress, minimumAlpha, compressionLevel,
                       sectionSize, sceneCenter, blockSize, bucketSize) {

        const streamedSectionSizeBytes = Constants.StreamingSectionSize;
        const splatDataOffsetBytes = SplatBuffer.HeaderSizeBytes + SplatBuffer.SectionHeaderSizeBytes;
        const sectionCount = 1;

        let streamBufferIn;
        let streamBufferOut;
        let streamedSplatBuffer;
        let compressedPlyHeaderChunksBuffer;
        let lastStreamedSectionEndBytes = 0;
        let lastParsedSectionEndBytes = 0;
        let maxSplatCount = 0;
        let splatCount = 0;

        let headerLoaded = false;
        let readyToLoadSplatData = false;
        let compressed = false;

        let streamLoadCompleteResolver;
        let streamLoadPromise = new Promise((resolve) => {
            streamLoadCompleteResolver = resolve;
        });

        let bytesLoaded = 0;
        let headerText = '';
        let header = null;
        let chunks = [];

        const textDecoder = new TextDecoder();

        const localOnProgress = (percent, percentLabel, chunkData) => {
            const loadComplete = percent >= 100;
            if (streamLoadData) {

                if (chunkData) {
                    chunks.push({
                        'data': chunkData,
                        'sizeBytes': chunkData.byteLength,
                        'startBytes': bytesLoaded,
                        'endBytes': bytesLoaded + chunkData.byteLength
                    });
                    bytesLoaded += chunkData.byteLength;
                }

                if (!headerLoaded) {
                    headerText += textDecoder.decode(chunkData);
                    if (PlyParser.checkTextForEndHeader(headerText)) {
                        header = PlyParser.decodeHeaderText(headerText);
                        compressed = header.compressed;

                        if (compressed) {
                            header = CompressedPlyParser.decodeHeaderText(headerText);
                            maxSplatCount = header.vertexElement.count;
                        } else {
                            maxSplatCount = header.splatCount;
                            readyToLoadSplatData = true;
                        }

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

                        lastStreamedSectionEndBytes = header.headerSizeBytes;
                        lastParsedSectionEndBytes = header.headerSizeBytes;
                        headerLoaded = true;
                    }
                } else if (compressed && !readyToLoadSplatData) {
                    const sizeRequiredForHeaderAndChunks = header.headerSizeBytes + header.chunkElement.storageSizeBytes;
                    compressedPlyHeaderChunksBuffer = storeChunksInBuffer(chunks, compressedPlyHeaderChunksBuffer);
                    if (compressedPlyHeaderChunksBuffer.byteLength >= sizeRequiredForHeaderAndChunks) {
                        CompressedPlyParser.readElementData(header.chunkElement, compressedPlyHeaderChunksBuffer, header.headerSizeBytes);
                        lastStreamedSectionEndBytes = sizeRequiredForHeaderAndChunks;
                        lastParsedSectionEndBytes = sizeRequiredForHeaderAndChunks;
                        readyToLoadSplatData = true;
                    }
                }

                if (headerLoaded && readyToLoadSplatData) {

                    if (chunks.length > 0) {

                        streamBufferIn = storeChunksInBuffer(chunks, streamBufferIn);

                        const bytesLoadedSinceLastStreamedSection = bytesLoaded - lastStreamedSectionEndBytes;
                        if (bytesLoadedSinceLastStreamedSection > streamedSectionSizeBytes || loadComplete) {
                            const bytesToProcess = bytesLoaded - lastParsedSectionEndBytes;
                            const addedSplatCount = Math.floor(bytesToProcess / header.bytesPerSplat);
                            const bytesToParse = addedSplatCount * header.bytesPerSplat;
                            const leftOverBytes = bytesToProcess - bytesToParse;
                            const newSplatCount = splatCount + addedSplatCount;
                            const parsedDataViewOffset = lastParsedSectionEndBytes - chunks[0].startBytes;
                            const parseDataView = new DataView(streamBufferIn, parsedDataViewOffset, bytesToParse);

                            const outOffset = splatCount * SplatBuffer.CompressionLevels[0].BytesPerSplat + splatDataOffsetBytes;

                            if (compressed) {
                                CompressedPlyParser.parseToUncompressedSplatBufferSection(header.chunkElement, header.vertexElement, 0,
                                                                                          addedSplatCount - 1, splatCount,
                                                                                          parseDataView, 0, streamBufferOut, outOffset);
                            } else {
                                PlyParser.parseToUncompressedSplatBufferSection(header, 0, addedSplatCount - 1,
                                                                                parseDataView, 0, streamBufferOut, outOffset);
                            }

                            splatCount = newSplatCount;
                            if (!streamedSplatBuffer) {
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
                                streamedSplatBuffer = new SplatBuffer(streamBufferOut, false);
                            }
                            streamedSplatBuffer.updateLoadedCounts(1, splatCount);
                            onStreamedSectionProgress(streamedSplatBuffer, loadComplete);
                            lastStreamedSectionEndBytes += streamedSectionSizeBytes;
                            lastParsedSectionEndBytes += bytesToParse;

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
                        }
                    }

                    if (loadComplete) {
                        streamLoadCompleteResolver(streamedSplatBuffer);
                    }
                }

            }
            if (onProgress) onProgress(percent, percentLabel, LoaderStatus.Downloading);
        };

        return fetchWithProgress(fileName, localOnProgress, !streamLoadData).then((plyFileData) => {
            if (onProgress) onProgress(0, '0%', LoaderStatus.Processing);
            const loadPromise = streamLoadData ? streamLoadPromise : PlyLoader.loadFromFileData(plyFileData, minimumAlpha, compressionLevel,
                                                                                        sectionSize, sceneCenter, blockSize, bucketSize);
            return loadPromise.then((splatBuffer) => {
                if (onProgress) onProgress(100, '100%', LoaderStatus.Done);
                return splatBuffer;
            });
        });
    }

    static loadFromFileData(plyFileData, minimumAlpha, compressionLevel, sectionSize, sceneCenter, blockSize, bucketSize) {
        return delayedExecute(() => {
            return PlyParser.parseToUncompressedSplatArray(plyFileData);
        })
        .then((splatArray) => {
            const splatBufferGenerator = SplatBufferGenerator.getStandardGenerator(minimumAlpha, compressionLevel, sectionSize,
                                                                                   sceneCenter, blockSize, bucketSize);
            return splatBufferGenerator.generateFromUncompressedSplatArray(splatArray);
        });
    }
}
