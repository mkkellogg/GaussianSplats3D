import * as THREE from 'three';
import { PlyParser } from './PlyParser.js';
import { PlyParserUtils } from './PlyParserUtils.js';
import { INRIAV1PlyParser } from './INRIAV1PlyParser.js';
import { PlayCanvasCompressedPlyParser } from './PlayCanvasCompressedPlyParser.js';
import { PlyFormat } from './PlyFormat.js';
import { fetchWithProgress, delayedExecute, nativePromiseWithExtractedComponents } from '../../Util.js';
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

    static loadFromURL(fileName, onProgress, progressiveLoad, onStreamedSectionProgress, minimumAlpha, compressionLevel,
                       outSphericalHarmonicsDegree = 0, sectionSize, sceneCenter, blockSize, bucketSize) {

        const progressiveLoadSectionSizeBytes = Constants.ProgressiveLoadSectionSize;
        const splatDataOffsetBytes = SplatBuffer.HeaderSizeBytes + SplatBuffer.SectionHeaderSizeBytes;
        const sectionCount = 1;

        let progressiveLoadBufferIn;
        let progressiveLoadBufferOut;
        let progressiveLoadSplatBuffer;
        let compressedPlyHeaderChunksBuffer;
        let maxSplatCount = 0;
        let splatCount = 0;

        let headerLoaded = false;
        let readyToLoadSplatData = false;
        let compressed = false;

        const progressiveLoadPromise = nativePromiseWithExtractedComponents();

        let numBytesStreamed = 0;
        let numBytesParsed = 0;
        let numBytesDownloaded = 0;
        let headerText = '';
        let header = null;
        let chunks = [];

        const textDecoder = new TextDecoder();

        const inriaV1PlyParser = new INRIAV1PlyParser();

        const localOnProgress = (percent, percentLabel, chunkData) => {
            const loadComplete = percent >= 100;
            if (progressiveLoad) {

                if (chunkData) {
                    chunks.push({
                        'data': chunkData,
                        'sizeBytes': chunkData.byteLength,
                        'startBytes': numBytesDownloaded,
                        'endBytes': numBytesDownloaded + chunkData.byteLength
                    });
                    numBytesDownloaded += chunkData.byteLength;
                }

                if (!headerLoaded) {
                    headerText += textDecoder.decode(chunkData);
                    if (PlyParserUtils.checkTextForEndHeader(headerText)) {
                        const plyFormat = PlyParserUtils.determineHeaderFormatFromHeaderText(headerText);
                        if (plyFormat === PlyFormat.INRIAV1) {
                            header = inriaV1PlyParser.decodeHeaderText(headerText);
                            maxSplatCount = header.splatCount;
                            readyToLoadSplatData = true;
                            compressed = false;
                        } else if (plyFormat === PlyFormat.PlayCanvasCompressed) {
                            header = PlayCanvasCompressedPlyParser.decodeHeaderText(headerText);
                            maxSplatCount = header.vertexElement.count;
                            compressed = true;
                        } else {
                            throw new Error('PlyLoader.loadFromURL() -> Selected Ply format cannot be progressively loaded.');
                        }
                        outSphericalHarmonicsDegree = Math.min(outSphericalHarmonicsDegree, header.sphericalHarmonicsDegree);

                        const shDescriptor = SplatBuffer.CompressionLevels[0].SphericalHarmonicsDegrees[outSphericalHarmonicsDegree];
                        const splatBufferSizeBytes = splatDataOffsetBytes + shDescriptor.BytesPerSplat * maxSplatCount;
                        progressiveLoadBufferOut = new ArrayBuffer(splatBufferSizeBytes);
                        SplatBuffer.writeHeaderToBuffer({
                            versionMajor: SplatBuffer.CurrentMajorVersion,
                            versionMinor: SplatBuffer.CurrentMinorVersion,
                            maxSectionCount: sectionCount,
                            sectionCount: sectionCount,
                            maxSplatCount: maxSplatCount,
                            splatCount: splatCount,
                            compressionLevel: 0,
                            sceneCenter: new THREE.Vector3()
                        }, progressiveLoadBufferOut);

                        numBytesStreamed = header.headerSizeBytes;
                        numBytesParsed = header.headerSizeBytes;
                        headerLoaded = true;
                    }
                } else if (compressed && !readyToLoadSplatData) {
                    const sizeRequiredForHeaderAndChunks = header.headerSizeBytes + header.chunkElement.storageSizeBytes;
                    compressedPlyHeaderChunksBuffer = storeChunksInBuffer(chunks, compressedPlyHeaderChunksBuffer);
                    if (compressedPlyHeaderChunksBuffer.byteLength >= sizeRequiredForHeaderAndChunks) {
                        PlayCanvasCompressedPlyParser.readElementData(header.chunkElement, compressedPlyHeaderChunksBuffer,
                                                                      header.headerSizeBytes);
                        numBytesStreamed = sizeRequiredForHeaderAndChunks;
                        numBytesParsed = sizeRequiredForHeaderAndChunks;
                        readyToLoadSplatData = true;
                    }
                }

                if (headerLoaded && readyToLoadSplatData) {

                    if (chunks.length > 0) {

                        progressiveLoadBufferIn = storeChunksInBuffer(chunks, progressiveLoadBufferIn);

                        const bytesLoadedSinceLastStreamedSection = numBytesDownloaded - numBytesStreamed;
                        if (bytesLoadedSinceLastStreamedSection > progressiveLoadSectionSizeBytes || loadComplete) {
                            const numBytesToProcess = numBytesDownloaded - numBytesParsed;
                            const addedSplatCount = Math.floor(numBytesToProcess / header.bytesPerSplat);
                            const numBytesToParse = addedSplatCount * header.bytesPerSplat;
                            const numBytesLeftOver = numBytesToProcess - numBytesToParse;
                            const newSplatCount = splatCount + addedSplatCount;
                            const parsedDataViewOffset = numBytesParsed - chunks[0].startBytes;
                            const dataToParse = new DataView(progressiveLoadBufferIn, parsedDataViewOffset, numBytesToParse);

                            const shDescriptor = SplatBuffer.CompressionLevels[0].SphericalHarmonicsDegrees[outSphericalHarmonicsDegree];
                            const outOffset = splatCount * shDescriptor.BytesPerSplat + splatDataOffsetBytes;

                            if (compressed) {
                                PlayCanvasCompressedPlyParser.parseToUncompressedSplatBufferSection(header.chunkElement,
                                                                                                    header.vertexElement, 0,
                                                                                                    addedSplatCount - 1, splatCount,
                                                                                                    dataToParse, 0,
                                                                                                    progressiveLoadBufferOut, outOffset);
                            } else {
                                inriaV1PlyParser.parseToUncompressedSplatBufferSection(header, 0, addedSplatCount - 1, dataToParse,
                                                                                       0, progressiveLoadBufferOut, outOffset,
                                                                                       outSphericalHarmonicsDegree);
                            }

                            splatCount = newSplatCount;
                            if (!progressiveLoadSplatBuffer) {
                                SplatBuffer.writeSectionHeaderToBuffer({
                                    maxSplatCount: maxSplatCount,
                                    splatCount: splatCount,
                                    bucketSize: 0,
                                    bucketCount: 0,
                                    bucketBlockSize: 0,
                                    compressionScaleRange: 0,
                                    storageSizeBytes: 0,
                                    fullBucketCount: 0,
                                    partiallyFilledBucketCount: 0,
                                    sphericalHarmonicsDegree: outSphericalHarmonicsDegree
                                }, 0, progressiveLoadBufferOut, SplatBuffer.HeaderSizeBytes);
                                progressiveLoadSplatBuffer = new SplatBuffer(progressiveLoadBufferOut, false);
                            }
                            progressiveLoadSplatBuffer.updateLoadedCounts(1, splatCount);
                            onStreamedSectionProgress(progressiveLoadSplatBuffer, loadComplete);
                            numBytesStreamed += progressiveLoadSectionSizeBytes;
                            numBytesParsed += numBytesToParse;

                            if (numBytesLeftOver === 0) {
                                chunks = [];
                            } else {
                                let keepChunks = [];
                                let keepSize = 0;
                                for (let i = chunks.length - 1; i >= 0; i--) {
                                    const chunk = chunks[i];
                                    keepSize += chunk.sizeBytes;
                                    keepChunks.unshift(chunk);
                                    if (keepSize >= numBytesLeftOver) break;
                                }
                                chunks = keepChunks;
                            }
                        }
                    }

                    if (loadComplete) {
                        progressiveLoadPromise.resolve(progressiveLoadSplatBuffer);
                    }
                }

            }
            if (onProgress) onProgress(percent, percentLabel, LoaderStatus.Downloading);
        };

        return fetchWithProgress(fileName, localOnProgress, !progressiveLoad).then((plyFileData) => {
            if (onProgress) onProgress(0, '0%', LoaderStatus.Processing);
            const loadPromise = progressiveLoad ? progressiveLoadPromise.promise :
                                PlyLoader.loadFromFileData(plyFileData, minimumAlpha, compressionLevel, outSphericalHarmonicsDegree,
                                                           sectionSize, sceneCenter, blockSize, bucketSize);
            return loadPromise.then((splatBuffer) => {
                if (onProgress) onProgress(100, '100%', LoaderStatus.Done);
                return splatBuffer;
            });
        });
    }

    static loadFromFileData(plyFileData, minimumAlpha, compressionLevel, outSphericalHarmonicsDegree = 0,
                            sectionSize, sceneCenter, blockSize, bucketSize) {
        return delayedExecute(() => {
            return PlyParser.parseToUncompressedSplatArray(plyFileData, outSphericalHarmonicsDegree);
        })
        .then((splatArray) => {
            const splatBufferGenerator = SplatBufferGenerator.getStandardGenerator(minimumAlpha, compressionLevel, sectionSize,
                                                                                   sceneCenter, blockSize, bucketSize);
            return splatBufferGenerator.generateFromUncompressedSplatArray(splatArray);
        });
    }
}
