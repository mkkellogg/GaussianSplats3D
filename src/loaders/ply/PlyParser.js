import { PlayCanvasCompressedPlyParser } from './PlayCanvasCompressedPlyParser.js';
import { INRIAV1PlyParser } from './INRIAV1PlyParser.js';
import { INRIAV2PlyParser } from './INRIAV2PlyParser.js';
import { PlyParserUtils } from './PlyParserUtils.js';
import { PlyFormat } from './PlyFormat.js';

export class PlyParser {

    static parseToUncompressedSplatArray(plyBuffer, outSphericalHarmonicsDegree = 0) {
        const plyFormat = PlyParserUtils.determineHeaderFormatFromPlyBuffer(plyBuffer);
        if (plyFormat === PlyFormat.PlayCanvasCompressed) {
            return PlayCanvasCompressedPlyParser.parseToUncompressedSplatArray(plyBuffer, outSphericalHarmonicsDegree);
        } else if (plyFormat === PlyFormat.INRIAV1) {
            return INRIAV1PlyParser.parseToUncompressedSplatArray(plyBuffer, outSphericalHarmonicsDegree);
        } else if (plyFormat === PlyFormat.INRIAV2) {
            return INRIAV2PlyParser.parseToUncompressedSplatArray(plyBuffer, outSphericalHarmonicsDegree);
        }
    }

    static parseToUncompressedSplatBuffer(plyBuffer, outSphericalHarmonicsDegree = 0) {
        const plyFormat = PlyParserUtils.determineHeaderFormatFromPlyBuffer(plyBuffer);
        if (plyFormat === PlyFormat.PlayCanvasCompressed) {
            return PlayCanvasCompressedPlyParser.parseToUncompressedSplatBuffer(plyBuffer, outSphericalHarmonicsDegree);
        } else if (plyFormat === PlyFormat.INRIAV1) {
            return INRIAV1PlyParser.parseToUncompressedSplatBuffer(plyBuffer, outSphericalHarmonicsDegree);
        } else if (plyFormat === PlyFormat.INRIAV2) {
             // TODO: Implement!
            throw new Error('parseToUncompressedSplatBuffer() is not implemented for INRIA V2 PLY files');
        }
    }

}
