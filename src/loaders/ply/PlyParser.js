import { PlayCanvasCompressedPlyParser } from './PlayCanvasCompressedPlyParser.js';
import { INRIAV1PlyParser } from './INRIAV1PlyParser.js';
import { PlyFormat } from './PlyFormat.js';

export class PlyParser {

    static HeaderEndToken = 'end_header';

    static checkTextForEndHeader(endHeaderTestText) {
        if (endHeaderTestText.includes(PlyParser.HeaderEndToken)) {
            return true;
        }
        return false;
    }

    static checkBufferForEndHeader(buffer, searchOfset, chunkSize, decoder) {
        const endHeaderTestChunk = new Uint8Array(buffer, Math.max(0, searchOfset - chunkSize), chunkSize);
        const endHeaderTestText = decoder.decode(endHeaderTestChunk);
        return PlyParser.checkTextForEndHeader(endHeaderTestText);
    }

    static decodeHeaderFromBufferToText(plyBuffer) {
        const decoder = new TextDecoder();
        let headerOffset = 0;
        let headerText = '';
        const readChunkSize = 100;

        while (true) {
            if (headerOffset + readChunkSize >= plyBuffer.byteLength) {
                throw new Error('End of file reached while searching for end of header');
            }
            const headerChunk = new Uint8Array(plyBuffer, headerOffset, readChunkSize);
            headerText += decoder.decode(headerChunk);
            headerOffset += readChunkSize;

            if (PlyParser.checkBufferForEndHeader(plyBuffer, headerOffset, readChunkSize * 2, decoder)) {
                break;
            }
        }

        return headerText;
    }

    static convertHeaderTextToLines(headerText) {
        const headerLines = headerText.split('\n');
        const prunedLines = [];
        for (let i = 0; i < headerLines.length; i++) {
            const line = headerLines[i].trim();
            prunedLines.push(line);
            if (line === INRIAV1PlyParser.HeaderEndToken) {
                break;
            }
        }
        return prunedLines;
    }

    static determineHeaderFormatFromHeaderText(headertText) {
        const headerLines = PlyParser.convertHeaderTextToLines(headertText);
        let format = PlyFormat.INRIAV1;
        for (let i = 0; i < headerLines.length; i++) {
            const line = headerLines[i].trim();
            if (line.startsWith('element chunk') || line.match(/[A-Za-z]*packed_[A-Za-z]*/)) {
                format = PlyFormat.PlayCanvasCompressed;
            } else if (line.startsWith('element codebook_centers')) {
                format = PlyFormat.INRIAV2;
            } else if (line === PlyParser.HeaderEndToken) {
                break;
            }
        }
        return format;
    }

    static determineHeaderFormatFromPlyBuffer(plyBuffer) {
        const headertText = PlyParser.decodeHeaderFromBufferToText(plyBuffer);
        return PlyParser.determineHeaderFormatFromHeaderText(headertText);
    }

    static parseToUncompressedSplatArray(plyBuffer, outSphericalHarmonicsDegree = 0) {

        const plyFormat = PlyParser.determineHeaderFormatFromPlyBuffer(plyBuffer);

        if (plyFormat === PlyFormat.PlayCanvasCompressed) {
            return PlayCanvasCompressedPlyParser.parseToUncompressedSplatArray(plyBuffer);
        } else if (plyFormat === PlyFormat.INRIAV1) {
            return INRIAV1PlyParser.parseToUncompressedSplatArray(plyBuffer, outSphericalHarmonicsDegree);
        }
    }

}
