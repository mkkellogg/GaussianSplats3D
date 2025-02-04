import * as THREE from 'three';
import { clamp } from '../../Util.js';
import { UncompressedSplatArray } from '../UncompressedSplatArray.js';
import { SplatBuffer } from '../SplatBuffer.js';
import { PlyParserUtils } from './PlyParserUtils.js';

const BaseFieldNamesToRead = ['scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3', 'x', 'y', 'z',
                              'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'red', 'green', 'blue', 'f_rest_0'];

const BaseFieldsToReadIndexes = BaseFieldNamesToRead.map((e, i) => i);

const [
        SCALE_0, SCALE_1, SCALE_2, ROT_0, ROT_1, ROT_2, ROT_3, X, Y, Z, F_DC_0, F_DC_1, F_DC_2, OPACITY, RED, GREEN, BLUE, F_REST_0
      ] = BaseFieldsToReadIndexes;

export class INRIAV1PlyParser {

    static decodeHeaderLines(headerLines) {

        let shLineCount = 0;
        headerLines.forEach((line) => {
            if (line.includes('f_rest_')) shLineCount++;
        });

        let shFieldsToReadCount = 0;
        if (shLineCount >= 45) {
            shFieldsToReadCount = 45;
        } else if (shLineCount >= 24) {
            shFieldsToReadCount = 24;
        } else if (shLineCount >= 9) {
            shFieldsToReadCount = 9;
        }

        const shFieldIndexesToMap = Array.from(Array(Math.max(shFieldsToReadCount - 1, 0)));
        let shRemainingFieldNamesToRead = shFieldIndexesToMap.map((element, index) => `f_rest_${index + 1}`);

        const fieldNamesToRead = [...BaseFieldNamesToRead, ...shRemainingFieldNamesToRead];
        const fieldsToReadIndexes = fieldNamesToRead.map((e, i) => i);

        const fieldNameIdMap = fieldsToReadIndexes.reduce((acc, element) => {
            acc[fieldNamesToRead[element]] = element;
            return acc;
        }, {});
        const header = PlyParserUtils.decodeSectionHeader(headerLines, fieldNameIdMap, 0);
        header.splatCount = header.vertexCount;
        header.bytesPerSplat = header.bytesPerVertex;
        header.fieldsToReadIndexes = fieldsToReadIndexes;
        return header;
    }

    static decodeHeaderText(headerText) {
        const headerLines = PlyParserUtils.convertHeaderTextToLines(headerText);
        const header = INRIAV1PlyParser.decodeHeaderLines(headerLines);
        header.headerText = headerText;
        header.headerSizeBytes = headerText.indexOf(PlyParserUtils.HeaderEndToken) + PlyParserUtils.HeaderEndToken.length + 1;
        return header;
    }

    static decodeHeaderFromBuffer(plyBuffer) {
        const headerText = PlyParserUtils.readHeaderFromBuffer(plyBuffer);
        return INRIAV1PlyParser.decodeHeaderText(headerText);
    }

    static findSplatData(plyBuffer, header) {
        return new DataView(plyBuffer, header.headerSizeBytes);
    }

    static parseToUncompressedSplatBufferSection(header, fromSplat, toSplat, splatData, splatDataOffset,
                                                 toBuffer, toOffset, outSphericalHarmonicsDegree = 0) {
        outSphericalHarmonicsDegree = Math.min(outSphericalHarmonicsDegree, header.sphericalHarmonicsDegree);
        const outBytesPerSplat = SplatBuffer.CompressionLevels[0].SphericalHarmonicsDegrees[outSphericalHarmonicsDegree].BytesPerSplat;

        for (let i = fromSplat; i <= toSplat; i++) {
            const parsedSplat = INRIAV1PlyParser.parseToUncompressedSplat(splatData, i, header,
                                                                          splatDataOffset, outSphericalHarmonicsDegree);
            const outBase = i * outBytesPerSplat + toOffset;
            SplatBuffer.writeSplatDataToSectionBuffer(parsedSplat, toBuffer, outBase, 0, outSphericalHarmonicsDegree);
        }
    }

    static parseToUncompressedSplatArraySection(header, fromSplat, toSplat, splatData, splatDataOffset,
                                         splatArray, outSphericalHarmonicsDegree = 0) {
        outSphericalHarmonicsDegree = Math.min(outSphericalHarmonicsDegree, header.sphericalHarmonicsDegree);
        for (let i = fromSplat; i <= toSplat; i++) {
            const parsedSplat = INRIAV1PlyParser.parseToUncompressedSplat(splatData, i, header,
                                                                          splatDataOffset, outSphericalHarmonicsDegree);
            splatArray.addSplat(parsedSplat);
        }
    }

    static decodeSectionSplatData(sectionSplatData, splatCount, sectionHeader, outSphericalHarmonicsDegree, toSplatArray = true) {
        outSphericalHarmonicsDegree = Math.min(outSphericalHarmonicsDegree, sectionHeader.sphericalHarmonicsDegree);
        if (toSplatArray) {
            const splatArray = new UncompressedSplatArray(outSphericalHarmonicsDegree);
            for (let row = 0; row < splatCount; row++) {
                const newSplat = INRIAV1PlyParser.parseToUncompressedSplat(sectionSplatData, row, sectionHeader,
                                                                           0, outSphericalHarmonicsDegree);
                splatArray.addSplat(newSplat);
            }
            return splatArray;
        } else {
            const {
                splatBuffer,
                splatBufferDataOffsetBytes
              } = SplatBuffer.preallocateUncompressed(splatCount, outSphericalHarmonicsDegree);
            INRIAV1PlyParser.parseToUncompressedSplatBufferSection(
                sectionHeader, 0, splatCount - 1, sectionSplatData, 0,
                splatBuffer.bufferData, splatBufferDataOffsetBytes, outSphericalHarmonicsDegree
            );
            return splatBuffer;
        }
    }

    static parseToUncompressedSplat = function() {

        let rawSplat = [];
        const tempRotation = new THREE.Quaternion();

        const OFFSET_X = UncompressedSplatArray.OFFSET.X;
        const OFFSET_Y = UncompressedSplatArray.OFFSET.Y;
        const OFFSET_Z = UncompressedSplatArray.OFFSET.Z;

        const OFFSET_SCALE0 = UncompressedSplatArray.OFFSET.SCALE0;
        const OFFSET_SCALE1 = UncompressedSplatArray.OFFSET.SCALE1;
        const OFFSET_SCALE2 = UncompressedSplatArray.OFFSET.SCALE2;

        const OFFSET_ROTATION0 = UncompressedSplatArray.OFFSET.ROTATION0;
        const OFFSET_ROTATION1 = UncompressedSplatArray.OFFSET.ROTATION1;
        const OFFSET_ROTATION2 = UncompressedSplatArray.OFFSET.ROTATION2;
        const OFFSET_ROTATION3 = UncompressedSplatArray.OFFSET.ROTATION3;

        const OFFSET_FDC0 = UncompressedSplatArray.OFFSET.FDC0;
        const OFFSET_FDC1 = UncompressedSplatArray.OFFSET.FDC1;
        const OFFSET_FDC2 = UncompressedSplatArray.OFFSET.FDC2;
        const OFFSET_OPACITY = UncompressedSplatArray.OFFSET.OPACITY;

        const OFFSET_FRC = [];

        for (let i = 0; i < 45; i++) {
            OFFSET_FRC[i] = UncompressedSplatArray.OFFSET.FRC0 + i;
        }

        return function(splatData, row, header, splatDataOffset = 0, outSphericalHarmonicsDegree = 0) {
            outSphericalHarmonicsDegree = Math.min(outSphericalHarmonicsDegree, header.sphericalHarmonicsDegree);
            INRIAV1PlyParser.readSplat(splatData, header, row, splatDataOffset, rawSplat);
            const newSplat = UncompressedSplatArray.createSplat(outSphericalHarmonicsDegree);
            if (rawSplat[SCALE_0] !== undefined) {
                newSplat[OFFSET_SCALE0] = Math.exp(rawSplat[SCALE_0]);
                newSplat[OFFSET_SCALE1] = Math.exp(rawSplat[SCALE_1]);
                newSplat[OFFSET_SCALE2] = Math.exp(rawSplat[SCALE_2]);
            } else {
                newSplat[OFFSET_SCALE0] = 0.01;
                newSplat[OFFSET_SCALE1] = 0.01;
                newSplat[OFFSET_SCALE2] = 0.01;
            }

            if (rawSplat[F_DC_0] !== undefined) {
                const SH_C0 = 0.28209479177387814;
                newSplat[OFFSET_FDC0] = (0.5 + SH_C0 * rawSplat[F_DC_0]) * 255;
                newSplat[OFFSET_FDC1] = (0.5 + SH_C0 * rawSplat[F_DC_1]) * 255;
                newSplat[OFFSET_FDC2] = (0.5 + SH_C0 * rawSplat[F_DC_2]) * 255;
            } else if (rawSplat[RED] !== undefined) {
                newSplat[OFFSET_FDC0] = rawSplat[RED] * 255;
                newSplat[OFFSET_FDC1] = rawSplat[GREEN] * 255;
                newSplat[OFFSET_FDC2] = rawSplat[BLUE] * 255;
            } else {
                newSplat[OFFSET_FDC0] = 0;
                newSplat[OFFSET_FDC1] = 0;
                newSplat[OFFSET_FDC2] = 0;
            }

            if (rawSplat[OPACITY] !== undefined) {
                newSplat[OFFSET_OPACITY] = (1 / (1 + Math.exp(-rawSplat[OPACITY]))) * 255;
            }

            newSplat[OFFSET_FDC0] = clamp(Math.floor(newSplat[OFFSET_FDC0]), 0, 255);
            newSplat[OFFSET_FDC1] = clamp(Math.floor(newSplat[OFFSET_FDC1]), 0, 255);
            newSplat[OFFSET_FDC2] = clamp(Math.floor(newSplat[OFFSET_FDC2]), 0, 255);
            newSplat[OFFSET_OPACITY] = clamp(Math.floor(newSplat[OFFSET_OPACITY]), 0, 255);

            if (outSphericalHarmonicsDegree >= 1) {
                if (rawSplat[F_REST_0] !== undefined) {
                    for (let i = 0; i < 9; i++) {
                        newSplat[OFFSET_FRC[i]] = rawSplat[header.sphericalHarmonicsDegree1Fields[i]];
                    }
                    if (outSphericalHarmonicsDegree >= 2) {
                        for (let i = 0; i < 15; i++) {
                            newSplat[OFFSET_FRC[9 + i]] = rawSplat[header.sphericalHarmonicsDegree2Fields[i]];
                        }
                    }
                }
            }

            tempRotation.set(rawSplat[ROT_0], rawSplat[ROT_1], rawSplat[ROT_2], rawSplat[ROT_3]);
            tempRotation.normalize();

            newSplat[OFFSET_ROTATION0] = tempRotation.x;
            newSplat[OFFSET_ROTATION1] = tempRotation.y;
            newSplat[OFFSET_ROTATION2] = tempRotation.z;
            newSplat[OFFSET_ROTATION3] = tempRotation.w;

            newSplat[OFFSET_X] = rawSplat[X];
            newSplat[OFFSET_Y] = rawSplat[Y];
            newSplat[OFFSET_Z] = rawSplat[Z];

            return newSplat;
        };

    }();

    static readSplat(splatData, header, row, dataOffset, rawSplat) {
        return PlyParserUtils.readVertex(splatData, header, row, dataOffset, header.fieldsToReadIndexes, rawSplat, true);
    }

    static parseToUncompressedSplatArray(plyBuffer, outSphericalHarmonicsDegree = 0) {
        const { header, splatCount, splatData } = separatePlyHeaderAndData(plyBuffer);
        return INRIAV1PlyParser.decodeSectionSplatData(splatData, splatCount, header, outSphericalHarmonicsDegree, true);
    }

    static parseToUncompressedSplatBuffer(plyBuffer, outSphericalHarmonicsDegree = 0) {
        const { header, splatCount, splatData } = separatePlyHeaderAndData(plyBuffer);
        return INRIAV1PlyParser.decodeSectionSplatData(splatData, splatCount, header, outSphericalHarmonicsDegree, false);
    }
}

function separatePlyHeaderAndData(plyBuffer) {
    const header = INRIAV1PlyParser.decodeHeaderFromBuffer(plyBuffer);
    const splatCount = header.splatCount;
    const splatData = INRIAV1PlyParser.findSplatData(plyBuffer, header);
    return {
        header,
        splatCount,
        splatData
    };
}
