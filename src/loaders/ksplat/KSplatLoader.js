import { SplatBuffer } from '../SplatBuffer.js';
import { fetchWithProgress, delayedExecute } from '../../Util.js';
import { LoaderStatus } from '../LoaderStatus.js';
import { Constants } from '../../Constants.js';

export class KSplatLoader {

   static checkVersion(buffer) {
        const minVersionMajor = SplatBuffer.CurrentMajorVersion;
        const minVersionMinor = SplatBuffer.CurrentMinorVersion;
        const header = SplatBuffer.parseHeader(buffer);
        if (header.versionMajor === minVersionMajor &&
            header.versionMinor >= minVersionMinor ||
            header.versionMajor > minVersionMajor) {
           return true;
        } else {
            throw new Error(`KSplat version not supported: v${header.versionMajor}.${header.versionMinor}. ` +
                            `Minimum required: v${minVersionMajor}.${minVersionMinor}`);
        }
    };

    static loadFromURL(fileName, onProgress, streamLoadData, onSectionBuilt) {
        let streamBuffer;
        let streamSplatBuffer;

        let headerBuffer;
        let header;
        let headerLoaded = false;
        let headerLoading = false;

        let sectionHeadersBuffer;
        let sectionHeaders = [];
        let sectionHeadersLoaded = false;
        let sectionHeadersLoading = false;

        let numBytesLoaded = 0;
        let numBytesStreamed = 0;
        let streamSectionSizeBytes = Constants.StreamingSectionSize;
        let totalBytesToDownload = 0;

        let loadComplete = false;

        let chunks = [];

        let streamLoadCompleteResolver;
        let streamLoadPromise = new Promise((resolve) => {
            streamLoadCompleteResolver = resolve;
        });

        const checkAndLoadHeader = () => {
            if (!headerLoaded && !headerLoading && numBytesLoaded >= SplatBuffer.HeaderSizeBytes) {
                headerLoading = true;
                const headerAssemblyPromise = new Blob(chunks).arrayBuffer();
                headerAssemblyPromise.then((bufferData) => {
                    headerBuffer = new ArrayBuffer(SplatBuffer.HeaderSizeBytes);
                    new Uint8Array(headerBuffer).set(new Uint8Array(bufferData, 0, SplatBuffer.HeaderSizeBytes));
                    KSplatLoader.checkVersion(headerBuffer);
                    headerLoading = false;
                    headerLoaded = true;
                    header = SplatBuffer.parseHeader(headerBuffer);
                    window.setTimeout(() => {
                        checkAndLoadSectionHeaders();
                    }, 1);
                });
            }
        };

        let queuedCheckAndLoadSectionsCount = 0;
        const queueCheckAndLoadSections = () => {
            if (queuedCheckAndLoadSectionsCount === 0) {
                queuedCheckAndLoadSectionsCount++;
                window.setTimeout(() => {
                    queuedCheckAndLoadSectionsCount--;
                    checkAndLoadSections(true);
                }, 1);
            }
        };

        const checkAndLoadSectionHeaders = () => {
            const performLoad = () => {
                sectionHeadersLoading = true;
                const sectionHeadersAssemblyPromise = new Blob(chunks).arrayBuffer();
                sectionHeadersAssemblyPromise.then((bufferData) => {
                    sectionHeadersLoading = false;
                    sectionHeadersLoaded = true;
                    sectionHeadersBuffer = new ArrayBuffer(header.maxSectionCount * SplatBuffer.SectionHeaderSizeBytes);
                    new Uint8Array(sectionHeadersBuffer).set(new Uint8Array(bufferData, SplatBuffer.HeaderSizeBytes,
                                                                            header.maxSectionCount * SplatBuffer.SectionHeaderSizeBytes));
                    sectionHeaders = SplatBuffer.parseSectionHeaders(header, sectionHeadersBuffer, 0, false);
                    let totalSectionStorageStorageByes = 0;
                    for (let i = 0; i < header.maxSectionCount; i++) {
                        totalSectionStorageStorageByes += sectionHeaders[i].storageSizeBytes;
                    }
                    const totalStorageSizeBytes = SplatBuffer.HeaderSizeBytes + header.maxSectionCount *
                                                  SplatBuffer.SectionHeaderSizeBytes + totalSectionStorageStorageByes;
                    if (!streamBuffer) {
                        streamBuffer = new ArrayBuffer(totalStorageSizeBytes);
                        let offset = 0;
                        for (let i = 0; i < chunks.length; i++) {
                            const chunk = chunks[i];
                            new Uint8Array(streamBuffer, offset, chunk.byteLength).set(new Uint8Array(chunk));
                            offset += chunk.byteLength;
                        }
                    }

                    totalBytesToDownload = SplatBuffer.HeaderSizeBytes + SplatBuffer.SectionHeaderSizeBytes * header.maxSectionCount;
                    for (let i = 0; i <= sectionHeaders.length && i < header.maxSectionCount; i++) {
                        totalBytesToDownload += sectionHeaders[i].storageSizeBytes;
                    }

                    queueCheckAndLoadSections();
                });
            };

            if (!sectionHeadersLoading && !sectionHeadersLoaded && headerLoaded &&
                numBytesLoaded >= SplatBuffer.HeaderSizeBytes + SplatBuffer.SectionHeaderSizeBytes * header.maxSectionCount) {
                performLoad();
            }
        };

        const checkAndLoadSections = () => {
            if (sectionHeadersLoaded) {

                if (loadComplete) return;

                loadComplete = numBytesLoaded >= totalBytesToDownload;

                const bytesLoadedSinceLastSection = numBytesLoaded - numBytesStreamed;
                if (bytesLoadedSinceLastSection > streamSectionSizeBytes || loadComplete) {

                    numBytesStreamed = numBytesLoaded;

                    if (!streamSplatBuffer) streamSplatBuffer = new SplatBuffer(streamBuffer, false);

                    const baseDataOffset = SplatBuffer.HeaderSizeBytes + SplatBuffer.SectionHeaderSizeBytes * header.maxSectionCount;
                    let sectionBase = 0;
                    let reachedSections = 0;
                    let loadedSplatCount = 0;
                    for (let i = 0; i < header.maxSectionCount; i++) {
                        const sectionHeader = sectionHeaders[i];
                        const bucketsDataOffset = sectionBase + sectionHeader.partiallyFilledBucketCount * 4 +
                                                  sectionHeader.bucketStorageSizeBytes * sectionHeader.bucketCount;
                        const bytesRequiredToReachSectionSplatData = baseDataOffset + bucketsDataOffset;
                        if (numBytesLoaded >= bytesRequiredToReachSectionSplatData) {
                            reachedSections++;
                            const bytesPastSSectionSplatDataStart = numBytesLoaded - bytesRequiredToReachSectionSplatData;
                            const baseDescriptor = SplatBuffer.CompressionLevels[header.compressionLevel];
                            const shDesc = baseDescriptor.SphericalHarmonicsDegrees[sectionHeader.sphericalHarmonicsDegree];
                            const bytesPerSplat = shDesc.BytesPerSplat;
                            let loadedSplatsForSection = Math.floor(bytesPastSSectionSplatDataStart / bytesPerSplat);
                            loadedSplatsForSection = Math.min(loadedSplatsForSection, sectionHeader.maxSplatCount);
                            loadedSplatCount += loadedSplatsForSection;
                            streamSplatBuffer.updateLoadedCounts(reachedSections, loadedSplatCount);
                            streamSplatBuffer.updateSectionLoadedCounts(i, loadedSplatsForSection);
                        } else {
                            break;
                        }
                        sectionBase += sectionHeader.storageSizeBytes;
                    }

                    onSectionBuilt(streamSplatBuffer, loadComplete);

                    if (loadComplete) {
                        streamLoadCompleteResolver(streamSplatBuffer);
                    }
                }
            }
        };

        const localOnProgress = (percent, percentStr, chunk) => {
            if (chunk) {
                chunks.push(chunk);
                if (streamBuffer) {
                    new Uint8Array(streamBuffer, numBytesLoaded, chunk.byteLength).set(new Uint8Array(chunk));
                }
                numBytesLoaded += chunk.byteLength;
            }
            if (streamLoadData) {
                checkAndLoadHeader();
                checkAndLoadSectionHeaders();
                checkAndLoadSections();
            }
            if (onProgress) onProgress(percent, percentStr, LoaderStatus.Downloading);
        };

        return fetchWithProgress(fileName, localOnProgress, !streamLoadData).then((fullBuffer) => {
            if (onProgress) onProgress(0, '0%', LoaderStatus.Processing);
            const loadPromise = streamLoadData ? streamLoadPromise : KSplatLoader.loadFromFileData(fullBuffer);
            return loadPromise.then((splatBuffer) => {
                if (onProgress) onProgress(100, '100%', LoaderStatus.Done);
                return splatBuffer;
            });
        });
    }

    static loadFromFileData(fileData) {
        return delayedExecute(() => {
            KSplatLoader.checkVersion(fileData);
            return new SplatBuffer(fileData);
        });
    }

    static downloadFile = function() {

        let downLoadLink;

        return function(splatBuffer, fileName) {
            const blob = new Blob([splatBuffer.bufferData], {
                type: 'application/octet-stream',
            });

            if (!downLoadLink) {
                downLoadLink = document.createElement('a');
                document.body.appendChild(downLoadLink);
            }
            downLoadLink.download = fileName;
            downLoadLink.href = URL.createObjectURL(blob);
            downLoadLink.click();
        };

    }();

}
