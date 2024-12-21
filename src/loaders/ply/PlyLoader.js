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

    static loadFromURL(fileName, onProgress, loadDirectoToSplatBuffer, onProgressiveLoadSectionProgress,
                       minimumAlpha, compressionLevel, optimizeSplatData = true, outSphericalHarmonicsDegree = 0,
                       headers, sectionSize, sceneCenter, blockSize, bucketSize) {

        let internalLoadType = loadDirectoToSplatBuffer ? InternalLoadType.DirectToSplatBuffer : InternalLoadType.DirectToSplatArray;
        if (optimizeSplatData) internalLoadType = InternalLoadType.DirectToSplatArray;

        const directLoadSectionSizeBytes = Constants.ProgressiveLoadSectionSize;
        const splatBufferDataOffsetBytes = SplatBuffer.HeaderSizeBytes + SplatBuffer.SectionHeaderSizeBytes;
        const uncompressedSplatSizeTable = SplatBuffer.CompressionLevels[0].SphericalHarmonicsDegrees;
        const sectionCount = 1;

        let plyFormat;
        let directLoadBufferIn;
        let directLoadBufferOut;
        let directLoadSplatBuffer;
        let compressedPlyHeaderChunksBuffer;
        let maxSplatCount = 0;
        let processedBaseSplatCount = 0;
        let processedSphericalHarmonicsSplatCount = 0;

        let headerLoaded = false;
        let readyToLoadSplatData = false;
        let baseSplatDataLoaded = false;

        const loadPromise = nativePromiseWithExtractedComponents();

        let numBytesStreamed = 0;
        let numBytesParsed = 0;
        let numBytesDownloaded = 0;
        let endOfBaseSplatDataBytes = 0;
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
                        plyFormat = PlyParserUtils.determineHeaderFormatFromHeaderText(headerText);
                        if (plyFormat === PlyFormat.INRIAV1) {
                            header = inriaV1PlyParser.decodeHeaderText(headerText);
                            outSphericalHarmonicsDegree = Math.min(outSphericalHarmonicsDegree, header.sphericalHarmonicsDegree);
                            maxSplatCount = header.splatCount;
                            readyToLoadSplatData = true;
                            endOfBaseSplatDataBytes = header.headerSizeBytes + header.bytesPerSplat * maxSplatCount;
                        } else if (plyFormat === PlyFormat.PlayCanvasCompressed) {
                            header = PlayCanvasCompressedPlyParser.decodeHeaderText(headerText);
                            outSphericalHarmonicsDegree = Math.min(outSphericalHarmonicsDegree, header.sphericalHarmonicsDegree);
                            if (loadDirectoToSplatBuffer && outSphericalHarmonicsDegree > 0) {
                                throw new DirectLoadError('PlyLoader.loadFromURL() -> Selected PLY format has spherical harmonics data that cannot be progressively loaded.');
                            }
                            maxSplatCount = header.vertexElement.count;
                            endOfBaseSplatDataBytes = header.headerSizeBytes + header.bytesPerSplat * maxSplatCount +
                                                      header.chunkElement.storageSizeBytes;
                        } else {
                            if (loadDirectoToSplatBuffer) {
                                throw new DirectLoadError('PlyLoader.loadFromURL() -> Selected PLY format cannot be progressively loaded.');
                            } else {
                                internalLoadType = InternalLoadType.DownloadBeforeProcessing;
                                return;
                            }
                        }

                        const shDescriptor = uncompressedSplatSizeTable[outSphericalHarmonicsDegree];
                        const splatBufferSizeBytes = splatBufferDataOffsetBytes + shDescriptor.BytesPerSplat * maxSplatCount;

                        if (internalLoadType === InternalLoadType.DirectToSplatBuffer) {
                            directLoadBufferOut = new ArrayBuffer(splatBufferSizeBytes);
                            SplatBuffer.writeHeaderToBuffer({
                                versionMajor: SplatBuffer.CurrentMajorVersion,
                                versionMinor: SplatBuffer.CurrentMinorVersion,
                                maxSectionCount: sectionCount,
                                sectionCount: sectionCount,
                                maxSplatCount: maxSplatCount,
                                splatCount: 0,
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
                } else if (plyFormat === PlyFormat.PlayCanvasCompressed && !readyToLoadSplatData) {
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

                if (headerLoaded && readyToLoadSplatData && chunks.length > 0) {

                    let numBytesLeftOver = 0;
                    let chunksNeedShift = false;

                    directLoadBufferIn = storeChunksInBuffer(chunks, directLoadBufferIn);

                    const bytesLoadedSinceLastStreamedSection = numBytesDownloaded - numBytesStreamed;

                    if(!baseSplatDataLoaded) {

                        if (bytesLoadedSinceLastStreamedSection > directLoadSectionSizeBytes ||
                            numBytesDownloaded >= endOfBaseSplatDataBytes || loadComplete) {
                            const endOfBytesToProcess = Math.min(endOfBaseSplatDataBytes, numBytesDownloaded);
                            const numBytesToProcess = endOfBytesToProcess - numBytesParsed;
                            const addedBaseSplatCount = Math.floor(numBytesToProcess / header.bytesPerSplat);
                            const numBytesToParse = addedBaseSplatCount * header.bytesPerSplat;
                            numBytesLeftOver = numBytesDownloaded - numBytesParsed - numBytesToParse;
                            const newBaseSplatCount = processedBaseSplatCount + addedBaseSplatCount;
                            const parsedDataViewOffset = numBytesParsed - chunks[0].startBytes;
                            const dataToParse = new DataView(directLoadBufferIn, parsedDataViewOffset, numBytesToParse);

                            let uncompressedBytesPerSplat;
                            if (plyFormat === PlyFormat.PlayCanvasCompressed) {
                                uncompressedBytesPerSplat = uncompressedSplatSizeTable[0].BytesPerSplat;
                            } else {
                                uncompressedBytesPerSplat = uncompressedSplatSizeTable[outSphericalHarmonicsDegree].BytesPerSplat;
                            }
                            const outOffset = processedBaseSplatCount * uncompressedBytesPerSplat + splatBufferDataOffsetBytes;

                            if (internalLoadType === InternalLoadType.DirectToSplatBuffer) {
                                if (plyFormat === PlyFormat.PlayCanvasCompressed) {
                                    PlayCanvasCompressedPlyParser.parseToUncompressedSplatBufferSection(
                                        header.chunkElement, header.vertexElement, 0, addedBaseSplatCount - 1,
                                        processedBaseSplatCount, dataToParse, 0, directLoadBufferOut, outOffset
                                    );
                                } else {
                                    inriaV1PlyParser.parseToUncompressedSplatBufferSection(
                                        header, 0, addedBaseSplatCount - 1, dataToParse, 0,
                                        directLoadBufferOut, outOffset, outSphericalHarmonicsDegree
                                    );
                                }
                            } else {
                                if (plyFormat === PlyFormat.PlayCanvasCompressed) {
                                    PlayCanvasCompressedPlyParser.parseToUncompressedSplatArraySection(
                                        header.chunkElement, header.vertexElement, 0, addedBaseSplatCount - 1,
                                        processedBaseSplatCount, dataToParse, 0, standardLoadUncompressedSplatArray
                                    );
                                } else {
                                    inriaV1PlyParser.parseToUncompressedSplatArraySection(
                                        header, 0, addedBaseSplatCount - 1, dataToParse, 0,
                                        standardLoadUncompressedSplatArray, outSphericalHarmonicsDegree
                                    );
                                }
                            }

                            processedBaseSplatCount = newBaseSplatCount;

                            if (internalLoadType === InternalLoadType.DirectToSplatBuffer) {
                                if (!directLoadSplatBuffer) {
                                    SplatBuffer.writeSectionHeaderToBuffer({
                                        maxSplatCount: maxSplatCount,
                                        splatCount: processedBaseSplatCount,
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
                                directLoadSplatBuffer.updateLoadedCounts(1, processedBaseSplatCount);
                            }

                            numBytesStreamed += directLoadSectionSizeBytes;
                            numBytesParsed += numBytesToParse;

                            if (numBytesDownloaded >= endOfBaseSplatDataBytes) {
                                baseSplatDataLoaded = true;
                            }

                            chunksNeedShift = true;
                        }
                    } else {
                        if (plyFormat === PlyFormat.PlayCanvasCompressed) {
                            if (internalLoadType === InternalLoadType.DirectToSplatArray) {
                                const bytesPerSplatSphericalHarmonics = header.sphericalHarmonicsPerSplat;

                                if (bytesLoadedSinceLastStreamedSection > directLoadSectionSizeBytes || loadComplete) {
                                    const numBytesToProcess = numBytesDownloaded - numBytesParsed;
                                    const addedSphericalHarmonicsSplatCount = Math.floor(numBytesToProcess / bytesPerSplatSphericalHarmonics);
                                    const numBytesToParse = addedSphericalHarmonicsSplatCount * bytesPerSplatSphericalHarmonics;
                                    numBytesLeftOver = numBytesToProcess - numBytesToParse;
                                    const newSphericalHarmonicsSplatCount = processedSphericalHarmonicsSplatCount + addedSphericalHarmonicsSplatCount;
                                    const parsedDataViewOffset = numBytesParsed - chunks[0].startBytes;
                                    const dataToParse = new DataView(directLoadBufferIn, parsedDataViewOffset, numBytesToParse);

                                    PlayCanvasCompressedPlyParser.parseSphericalHarmonicsToUncompressedSplatArraySection(
                                        header.chunkElement, header.shElement, processedSphericalHarmonicsSplatCount,
                                        processedSphericalHarmonicsSplatCount + addedSphericalHarmonicsSplatCount - 1,
                                        dataToParse, 0, outSphericalHarmonicsDegree, header.sphericalHarmonicsDegree,
                                        standardLoadUncompressedSplatArray
                                    );

                                    numBytesStreamed += directLoadSectionSizeBytes;
                                    numBytesParsed += numBytesToParse;
        
                                    processedSphericalHarmonicsSplatCount = newSphericalHarmonicsSplatCount;

                                    chunksNeedShift = true;
                                }
                            }
                        }
                    }

                    if (chunksNeedShift) {
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

                if (onProgressiveLoadSectionProgress && directLoadSplatBuffer) {
                    onProgressiveLoadSectionProgress(directLoadSplatBuffer, loadComplete);
                }

                if (loadComplete) {
                    if (internalLoadType === InternalLoadType.DirectToSplatBuffer) {
                        loadPromise.resolve(directLoadSplatBuffer);
                    } else {
                        loadPromise.resolve(standardLoadUncompressedSplatArray);
                    }
                }
            }

            if (onProgress) onProgress(percent, percentLabel, LoaderStatus.Downloading);
        };

        if (onProgress) onProgress(0, '0%', LoaderStatus.Downloading);
        return fetchWithProgress(fileName, localOnProgress, false, headers).then(() => {
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
