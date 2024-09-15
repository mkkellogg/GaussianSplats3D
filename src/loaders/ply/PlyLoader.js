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
import { DirectLoadError } from '../DirectLoadError.js';
import { Constants } from '../../Constants.js';
import { UncompressedSplatArray } from '../UncompressedSplatArray.js';
import { InternalLoadType } from '../InternalLoadType.js';

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

function finalize(splatData, optimizeSplatData, minimumAlpha, compressionLevel, sectionSize, sceneCenter, blockSize, bucketSize) {
    if (optimizeSplatData) {
        const splatBufferGenerator = SplatBufferGenerator.getStandardGenerator(minimumAlpha, compressionLevel,
                                                                               sectionSize, sceneCenter,
                                                                               blockSize, bucketSize);
        return splatBufferGenerator.generateFromUncompressedSplatArray(splatData);
    } else {
        return SplatBuffer.generateFromUncompressedSplatArrays([splatData], minimumAlpha, 0, new THREE.Vector3());
    }
}

export class PlyLoader {

    static loadFromURL(fileName, onProgress, loadDirectoToSplatBuffer, onProgressiveLoadSectionProgress, minimumAlpha, compressionLevel,
                       optimizeSplatData = true, outSphericalHarmonicsDegree = 0, sectionSize, sceneCenter, blockSize, bucketSize) {

        let internalLoadType = loadDirectoToSplatBuffer ? InternalLoadType.DirectToSplatBuffer : InternalLoadType.DirectToSplatArray;
        if (optimizeSplatData) internalLoadType = InternalLoadType.DirectToSplatArray;

        const directLoadSectionSizeBytes = Constants.ProgressiveLoadSectionSize;
        const splatDataOffsetBytes = SplatBuffer.HeaderSizeBytes + SplatBuffer.SectionHeaderSizeBytes;
        const sectionCount = 1;

        let directLoadBufferIn;
        let directLoadBufferOut;
        let directLoadSplatBuffer;
        let compressedPlyHeaderChunksBuffer;
        let maxSplatCount = 0;
        let splatCount = 0;

        let headerLoaded = false;
        let readyToLoadSplatData = false;
        let compressed = false;

        const loadPromise = nativePromiseWithExtractedComponents();

        let numBytesStreamed = 0;
        let numBytesParsed = 0;
        let numBytesDownloaded = 0;
        let headerText = '';
        let header = null;
        let chunks = [];

        let standardLoadUncompressedSplatArray;

        const textDecoder = new TextDecoder();
        const inriaV1PlyParser = new INRIAV1PlyParser();

        const localOnProgress = (percent, percentLabel, chunkData) => {
            const loadComplete = percent >= 100;

            if (chunkData) {
                chunks.push({
                    'data': chunkData,
                    'sizeBytes': chunkData.byteLength,
                    'startBytes': numBytesDownloaded,
                    'endBytes': numBytesDownloaded + chunkData.byteLength
                });
                numBytesDownloaded += chunkData.byteLength;
            }

            if (internalLoadType === InternalLoadType.DownloadBeforeProcessing) {
                if (loadComplete) {
                    loadPromise.resolve(chunks);
                }
            } else {
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
                            if (loadDirectoToSplatBuffer) {
                                throw new DirectLoadError('PlyLoader.loadFromURL() -> Selected Ply format cannot be directly loaded.');
                            } else {
                                internalLoadType = InternalLoadType.DownloadBeforeProcessing;
                                return;
                            }
                        }
                        outSphericalHarmonicsDegree = Math.min(outSphericalHarmonicsDegree, header.sphericalHarmonicsDegree);

                        const shDescriptor = SplatBuffer.CompressionLevels[0].SphericalHarmonicsDegrees[outSphericalHarmonicsDegree];
                        const splatBufferSizeBytes = splatDataOffsetBytes + shDescriptor.BytesPerSplat * maxSplatCount;

                        if (internalLoadType === InternalLoadType.DirectToSplatBuffer) {
                            directLoadBufferOut = new ArrayBuffer(splatBufferSizeBytes);
                            SplatBuffer.writeHeaderToBuffer({
                                versionMajor: SplatBuffer.CurrentMajorVersion,
                                versionMinor: SplatBuffer.CurrentMinorVersion,
                                maxSectionCount: sectionCount,
                                sectionCount: sectionCount,
                                maxSplatCount: maxSplatCount,
                                splatCount: splatCount,
                                compressionLevel: 0,
                                sceneCenter: new THREE.Vector3()
                            }, directLoadBufferOut);
                        } else {
                            standardLoadUncompressedSplatArray = new UncompressedSplatArray(outSphericalHarmonicsDegree);
                        }

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

                        directLoadBufferIn = storeChunksInBuffer(chunks, directLoadBufferIn);

                        const bytesLoadedSinceLastStreamedSection = numBytesDownloaded - numBytesStreamed;
                        if (bytesLoadedSinceLastStreamedSection > directLoadSectionSizeBytes || loadComplete) {
                            const numBytesToProcess = numBytesDownloaded - numBytesParsed;
                            const addedSplatCount = Math.floor(numBytesToProcess / header.bytesPerSplat);
                            const numBytesToParse = addedSplatCount * header.bytesPerSplat;
                            const numBytesLeftOver = numBytesToProcess - numBytesToParse;
                            const newSplatCount = splatCount + addedSplatCount;
                            const parsedDataViewOffset = numBytesParsed - chunks[0].startBytes;
                            const dataToParse = new DataView(directLoadBufferIn, parsedDataViewOffset, numBytesToParse);

                            const shDescriptor = SplatBuffer.CompressionLevels[0].SphericalHarmonicsDegrees[outSphericalHarmonicsDegree];
                            const outOffset = splatCount * shDescriptor.BytesPerSplat + splatDataOffsetBytes;

                            if (internalLoadType === InternalLoadType.DirectToSplatBuffer) {
                                if (compressed) {
                                    PlayCanvasCompressedPlyParser.parseToUncompressedSplatBufferSection(header.chunkElement,
                                                                                                        header.vertexElement, 0,
                                                                                                        addedSplatCount - 1, splatCount,
                                                                                                        dataToParse, 0,
                                                                                                        directLoadBufferOut, outOffset);
                                } else {
                                    inriaV1PlyParser.parseToUncompressedSplatBufferSection(header, 0, addedSplatCount - 1, dataToParse,
                                                                                        0, directLoadBufferOut, outOffset,
                                                                                        outSphericalHarmonicsDegree);
                                }
                            } else {
                                if (compressed) {
                                    PlayCanvasCompressedPlyParser.parseToUncompressedSplatArraySection(header.chunkElement,
                                                                                                    header.vertexElement, 0,
                                                                                                    addedSplatCount - 1, splatCount,
                                                                                                    dataToParse, 0,
                                                                                                    standardLoadUncompressedSplatArray);
                                } else {
                                    inriaV1PlyParser.parseToUncompressedSplatArraySection(header, 0, addedSplatCount - 1, dataToParse,
                                                                                        0, standardLoadUncompressedSplatArray,
                                                                                        outSphericalHarmonicsDegree);
                                }
                            }

                            splatCount = newSplatCount;

                            if (internalLoadType === InternalLoadType.DirectToSplatBuffer) {
                                if (!directLoadSplatBuffer) {
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
                                    }, 0, directLoadBufferOut, SplatBuffer.HeaderSizeBytes);
                                    directLoadSplatBuffer = new SplatBuffer(directLoadBufferOut, false);
                                }
                                directLoadSplatBuffer.updateLoadedCounts(1, splatCount);
                                if (onProgressiveLoadSectionProgress) {
                                    onProgressiveLoadSectionProgress(directLoadSplatBuffer, loadComplete);
                                }
                            }

                            numBytesStreamed += directLoadSectionSizeBytes;
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
                        if (internalLoadType === InternalLoadType.DirectToSplatBuffer) {
                            loadPromise.resolve(directLoadSplatBuffer);
                        } else {
                            loadPromise.resolve(standardLoadUncompressedSplatArray);
                        }
                    }
                }
            }

            if (onProgress) onProgress(percent, percentLabel, LoaderStatus.Downloading);
        };

        if (onProgress) onProgress(0, '0%', LoaderStatus.Downloading);
        return fetchWithProgress(fileName, localOnProgress, false).then(() => {
            if (onProgress) onProgress(0, '0%', LoaderStatus.Processing);
            return loadPromise.promise.then((splatData) => {
                if (onProgress) onProgress(100, '100%', LoaderStatus.Done);
                if (internalLoadType === InternalLoadType.DownloadBeforeProcessing) {
                    const chunkDatas = chunks.map((chunk) => chunk.data);
                    return new Blob(chunkDatas).arrayBuffer().then((plyFileData) => {
                        return PlyLoader.loadFromFileData(plyFileData, minimumAlpha, compressionLevel, optimizeSplatData,
                                                          outSphericalHarmonicsDegree, sectionSize, sceneCenter, blockSize, bucketSize);
                    });
                } else if (internalLoadType === InternalLoadType.DirectToSplatBuffer) {
                    return splatData;
                } else {
                    return delayedExecute(() => {
                        return finalize(splatData, optimizeSplatData, minimumAlpha, compressionLevel,
                                        sectionSize, sceneCenter, blockSize, bucketSize);
                    });
                }
            });
        });
    }

    static loadFromFileData(plyFileData, minimumAlpha, compressionLevel, optimizeSplatData, outSphericalHarmonicsDegree = 0,
                            sectionSize, sceneCenter, blockSize, bucketSize) {
        return delayedExecute(() => {
            return PlyParser.parseToUncompressedSplatArray(plyFileData, outSphericalHarmonicsDegree);
        })
        .then((splatArray) => {
            return finalize(splatArray, optimizeSplatData, minimumAlpha, compressionLevel,
                            sectionSize, sceneCenter, blockSize, bucketSize);
        });
    }
}
