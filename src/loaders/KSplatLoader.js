import { SplatBuffer } from './SplatBuffer.js';
import { fetchWithProgress, delayedExecute } from '../Util.js';
import { LoaderStatus } from './LoaderStatus.js';
import { Constants } from '../Constants.js';

const MINIMUM_REQUIRED_MAJOR_VERSION = 0;
const MINIMUM_REQUIRED_MINOR_VERSION = 1;

export class KSplatLoader {

    constructor(splatBuffer = null) {
        this.splatBuffer = splatBuffer;
        this.downLoadLink = null;
    }

   static checkVersion(buffer) {
        const header = SplatBuffer.parseHeader(buffer);
        if (header.versionMajor === MINIMUM_REQUIRED_MAJOR_VERSION && header.versionMinor >= MINIMUM_REQUIRED_MINOR_VERSION ||
            header.versionMajor > MINIMUM_REQUIRED_MAJOR_VERSION) {
           return true;
        } else {
            throw new Error(`KSplat version not supported: v${header.versionMajor}.${header.versionMinor}. ` +
                            `Minimum required: v${MINIMUM_REQUIRED_MAJOR_VERSION}.${MINIMUM_REQUIRED_MINOR_VERSION}`);
        }
    };

    loadFromURL(fileName, onProgress, streamBuiltSections, onSectionBuilt) {
        let bytesLoaded = 0;
        let totalStorageSizeBytes = 0;

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

        let lastStreamUpdateBytes = 0;
        let streamSectionSizeBytes = Constants.StreamingSectionSize;
        let totalBytesToDownload = 0;

        let loadComplete = false;

        let chunks = [];

        let streamLoadCompleteResolver;
        let streamLoadPromise = new Promise((resolve) => {
            streamLoadCompleteResolver = resolve;
        });

        const checkAndLoadHeader = () => {
            if (!headerLoaded && !headerLoading && bytesLoaded >= SplatBuffer.HeaderSizeBytes) {
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
                    totalStorageSizeBytes = SplatBuffer.HeaderSizeBytes + header.maxSectionCount *
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
                bytesLoaded >= SplatBuffer.HeaderSizeBytes + SplatBuffer.SectionHeaderSizeBytes * header.maxSectionCount) {
                performLoad();
            }
        };

        const checkAndLoadSections = () => {
            if (sectionHeadersLoaded) {

                if (loadComplete) return;

                loadComplete = bytesLoaded >= totalBytesToDownload;

                const bytesLoadedSinceLastSection = bytesLoaded - lastStreamUpdateBytes;
                if (bytesLoadedSinceLastSection > streamSectionSizeBytes || loadComplete) {

                    lastStreamUpdateBytes = bytesLoaded;

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
                        if (bytesLoaded >= bytesRequiredToReachSectionSplatData) {
                            reachedSections++;
                            const bytesPastSSectionSplatDataStart = bytesLoaded - bytesRequiredToReachSectionSplatData;
                            const bytesPerSplat = SplatBuffer.CompressionLevels[header.compressionLevel].BytesPerSplat;
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
                        streamLoadCompleteResolver();
                    }
                }
            }
        };

        const localOnProgress = (percent, percentStr, chunk) => {

            if (chunk) {
                chunks.push(chunk);
                if (streamBuffer) {
                    new Uint8Array(streamBuffer, bytesLoaded, chunk.byteLength).set(new Uint8Array(chunk));
                }
                bytesLoaded += chunk.byteLength;
            }
            if (streamBuiltSections) {
                checkAndLoadHeader();
                checkAndLoadSectionHeaders();
                checkAndLoadSections();
            }
            if (onProgress) onProgress(percent, percentStr, LoaderStatus.Downloading);
        };

        return fetchWithProgress(fileName, localOnProgress, !streamBuiltSections).then((fullBuffer) => {
            if (onProgress) onProgress(0, '0%', LoaderStatus.Processing);
            return delayedExecute(() => {
                function finish(buffer) {
                    if (onProgress) onProgress(100, '100%', LoaderStatus.Done);
                    if (buffer instanceof SplatBuffer) return buffer;
                    else {
                        KSplatLoader.checkVersion(buffer);
                        return new SplatBuffer(buffer);
                    }
                }
                if (streamBuiltSections) {
                    return streamLoadPromise.then(() => {
                        return finish(streamSplatBuffer);
                    });
                } else {
                    return finish(fullBuffer);
                }
            });
        });
    }

    setFromBuffer(splatBuffer) {
        this.splatBuffer = splatBuffer;
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
