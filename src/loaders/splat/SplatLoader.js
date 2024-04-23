import * as THREE from 'three';
import { SplatBuffer } from '../SplatBuffer.js';
import { SplatBufferGenerator } from '../SplatBufferGenerator.js';
import { SplatParser } from './SplatParser.js';
import { fetchWithProgress, delayedExecute } from '../../Util.js';
import { LoaderStatus } from '../LoaderStatus.js';
import { Constants } from '../../Constants.js';

export class SplatLoader {

    static loadFromURL(fileName, onProgress, streamLoadData, onStreamedSectionProgress, minimumAlpha, compressionLevel,
                       optimizeSplatData, sectionSize, sceneCenter, blockSize, bucketSize) {

        const splatDataOffsetBytes = SplatBuffer.HeaderSizeBytes + SplatBuffer.SectionHeaderSizeBytes;
        const streamSectionSizeBytes = Constants.StreamingSectionSize;
        const sectionCount = 1;

        let streamBufferIn;
        let streamBufferOut;
        let streamSplatBuffer;
        let maxSplatCount = 0;
        let splatCount = 0;

        let streamLoadCompleteResolver;
        let streamLoadPromise = new Promise((resolve) => {
            streamLoadCompleteResolver = resolve;
        });

        let numBytesStreamed = 0;
        let numBytesLoaded = 0;
        let chunks = [];

        const localOnProgress = (percent, percentStr, chunk, fileSize) => {
            const loadComplete = percent >= 100;
            if (!fileSize) streamLoadData = false;
            if (streamLoadData) {
                if (!streamBufferIn) {
                    maxSplatCount = fileSize / SplatParser.RowSizeBytes;
                    streamBufferIn = new ArrayBuffer(fileSize);
                    const bytesPerSplat = SplatBuffer.CompressionLevels[0].SphericalHarmonicsDegrees[0].BytesPerSplat;
                    const splatBufferSizeBytes = splatDataOffsetBytes + bytesPerSplat * maxSplatCount;
                    streamBufferOut = new ArrayBuffer(splatBufferSizeBytes);
                    SplatBuffer.writeHeaderToBuffer({
                        versionMajor: SplatBuffer.CurrentMajorVersion,
                        versionMinor: SplatBuffer.CurrentMinorVersion,
                        maxSectionCount: sectionCount,
                        sectionCount: sectionCount,
                        maxSplatCount: maxSplatCount,
                        splatCount: splatCount,
                        compressionLevel: 0,
                        sceneCenter: new THREE.Vector3()
                    }, streamBufferOut);
                }

                if (chunk) {
                    chunks.push(chunk);
                    new Uint8Array(streamBufferIn, numBytesLoaded, chunk.byteLength).set(new Uint8Array(chunk));
                    numBytesLoaded += chunk.byteLength;

                    const bytesLoadedSinceLastSection = numBytesLoaded - numBytesStreamed;
                    if (bytesLoadedSinceLastSection > streamSectionSizeBytes || loadComplete) {
                        const bytesToUpdate = loadComplete ? bytesLoadedSinceLastSection : streamSectionSizeBytes;
                        const addedSplatCount = bytesToUpdate / SplatParser.RowSizeBytes;
                        const newSplatCount = splatCount + addedSplatCount;
                        SplatParser.parseToUncompressedSplatBufferSection(splatCount, newSplatCount - 1, streamBufferIn, 0,
                                                                          streamBufferOut, splatDataOffsetBytes);
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
                        numBytesStreamed += streamSectionSizeBytes;
                    }
                }
                if (loadComplete) {
                    streamLoadCompleteResolver(streamSplatBuffer);
                }
            }
            if (onProgress) onProgress(percent, percentStr, LoaderStatus.Downloading);
            return streamLoadData;
        };

        return fetchWithProgress(fileName, localOnProgress, true).then((fullBuffer) => {
            if (onProgress) onProgress(0, '0%', LoaderStatus.Processing);
            const loadPromise = streamLoadData ? streamLoadPromise :
                SplatLoader.loadFromFileData(fullBuffer, minimumAlpha, compressionLevel, optimizeSplatData,
                                             sectionSize, sceneCenter, blockSize, bucketSize);
            return loadPromise.then((splatBuffer) => {
                if (onProgress) onProgress(100, '100%', LoaderStatus.Done);
                return splatBuffer;
            });
        });
    }

    static loadFromFileData(splatFileData, minimumAlpha, compressionLevel, optimizeSplatData,
                            sectionSize, sceneCenter, blockSize, bucketSize) {
        return delayedExecute(() => {
            const splatArray = SplatParser.parseStandardSplatToUncompressedSplatArray(splatFileData);
            if (optimizeSplatData) {
                const splatBufferGenerator = SplatBufferGenerator.getStandardGenerator(minimumAlpha, compressionLevel,
                                                                                       sectionSize, sceneCenter, blockSize,
                                                                                       bucketSize);
                return splatBufferGenerator.generateFromUncompressedSplatArray(splatArray);
            } else {
                return SplatBuffer.generateFromUncompressedSplatArrays([splatArray], minimumAlpha, 0, new THREE.Vector3());
            }
        });
    }

}
