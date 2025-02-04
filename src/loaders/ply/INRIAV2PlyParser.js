import * as THREE from 'three';
import { PlyParserUtils } from './PlyParserUtils.js';
import { UncompressedSplatArray } from '../UncompressedSplatArray.js';
import { clamp } from '../../Util.js';

const CodeBookEntryNamesToRead = [
    'features_dc', 'features_rest_0', 'features_rest_1', 'features_rest_2', 'features_rest_3', 'features_rest_4', 'features_rest_5',
    'features_rest_6', 'features_rest_7', 'features_rest_8', 'features_rest_9', 'features_rest_10', 'features_rest_11', 'features_rest_12',
    'features_rest_13', 'features_rest_14', 'opacity', 'scaling', 'rotation_re', 'rotation_im'
];
const CodeBookEntriesToReadIndexes = CodeBookEntryNamesToRead.map((e, i) => i);

const [
        CB_FEATURES_DC, CB_FEATURES_REST_0, CB_FEATURES_REST_3, CB_OPACITY, CB_SCALING, CB_ROTATION_RE, CB_ROTATION_IM
      ] = [0, 1, 4, 16, 17, 18, 19];

const FieldNamesToRead = ['scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3',
                          'x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'red', 'green', 'blue',
                          'f_rest_0', 'f_rest_1', 'f_rest_2', 'f_rest_3', 'f_rest_4', 'f_rest_5', 'f_rest_6', 'f_rest_7', 'f_rest_8',
                          'f_rest_9', 'f_rest_10', 'f_rest_11', 'f_rest_12', 'f_rest_13', 'f_rest_14', 'f_rest_15', 'f_rest_16',
                          'f_rest_17', 'f_rest_18', 'f_rest_19', 'f_rest_20', 'f_rest_21', 'f_rest_22', 'f_rest_23', 'f_rest_24',
                          'f_rest_25', 'f_rest_26', 'f_rest_27', 'f_rest_28', 'f_rest_29', 'f_rest_30', 'f_rest_31', 'f_rest_32',
                          'f_rest_33', 'f_rest_34', 'f_rest_35', 'f_rest_36', 'f_rest_37', 'f_rest_38', 'f_rest_39', 'f_rest_40',
                          'f_rest_41', 'f_rest_42', 'f_rest_43', 'f_rest_44', 'f_rest_45'
                         ];
const FieldsToReadIndexes = FieldNamesToRead.map((e, i) => i);

const [
        PLY_SCALE_0, PLY_SCALE_1, PLY_SCALE_2, PLY_ROT_0, PLY_ROT_1, PLY_ROT_2, PLY_ROT_3, PLY_X, PLY_Y, PLY_Z,
        PLY_F_DC_0, PLY_F_DC_1, PLY_F_DC_2, PLY_OPACITY,
      ] = FieldsToReadIndexes;

const PLY_RED = PLY_F_DC_0;
const PLY_GREEN = PLY_F_DC_1;
const PLY_BLUE = PLY_F_DC_2;

const fromHalfFloat = (hf) =>{
    const t = (31744 & hf) >> 10;
    const a = 1023 & hf;
    return (hf >> 15 ? -1 : 1)*(t ? t === 31 ? a ? NaN : 1/0 : Math.pow(2, t - 15) *( 1 + a / 1024) : a / 1024*6103515625e-14);
};

export class INRIAV2PlyParser {

    static decodeSectionHeadersFromHeaderLines(headerLines) {
        const fieldNameIdMap = FieldsToReadIndexes.reduce((acc, element) => {
            acc[FieldNamesToRead[element]] = element;
            return acc;
        }, {});

        const codeBookEntriesToReadIdMap = CodeBookEntriesToReadIndexes.reduce((acc, element) => {
            acc[CodeBookEntryNamesToRead[element]] = element;
            return acc;
        }, {});

        const sectionNames = PlyParserUtils.getHeaderSectionNames(headerLines);
        let codeBookSectionIndex;
        for (let s = 0; s < sectionNames.length; s++) {
            const sectionName = sectionNames[s];
            if (sectionName === 'codebook_centers') {
                codeBookSectionIndex = s;
            }
        }

        let currentStartLine = 0;
        let lastSectionFound = false;
        const sectionHeaders = [];
        let sectionIndex = 0;
        while (!lastSectionFound) {
            let sectionHeader;
            if (sectionIndex === codeBookSectionIndex) {
                sectionHeader = PlyParserUtils.decodeSectionHeader(headerLines, codeBookEntriesToReadIdMap, currentStartLine);
            } else {
                sectionHeader = PlyParserUtils.decodeSectionHeader(headerLines, fieldNameIdMap, currentStartLine);
            }
            lastSectionFound = sectionHeader.endOfHeader;
            currentStartLine = sectionHeader.headerEndLine + 1;
            if (!lastSectionFound) {
                sectionHeader.splatCount = sectionHeader.vertexCount;
                sectionHeader.bytesPerSplat = sectionHeader.bytesPerVertex;
            }
            sectionHeaders.push(sectionHeader);
            sectionIndex++;
        }
        return sectionHeaders;
    }

    static decodeSectionHeadersFromHeaderText(headerText) {
        const headerLines = PlyParserUtils.convertHeaderTextToLines(headerText);
        return INRIAV2PlyParser.decodeSectionHeadersFromHeaderLines(headerLines);
    }

    static getSplatCountFromSectionHeaders(sectionHeaders) {
        let splatCount = 0;
        for (let sectionHeader of sectionHeaders) {
            if (sectionHeader.sectionName !== 'codebook_centers') {
                splatCount += sectionHeader.vertexCount;
            }
        }
        return splatCount;
    }

    static decodeHeaderFromHeaderText(headerText) {
        const headerSizeBytes = headerText.indexOf(PlyParserUtils.HeaderEndToken) + PlyParserUtils.HeaderEndToken.length + 1;
        const sectionHeaders = INRIAV2PlyParser.decodeSectionHeadersFromHeaderText(headerText);
        const splatCount = INRIAV2PlyParser.getSplatCountFromSectionHeaders(sectionHeaders);
        return {
            'headerSizeBytes': headerSizeBytes,
            'sectionHeaders': sectionHeaders,
            'splatCount': splatCount
        };
    }

    static decodeHeaderFromBuffer(plyBuffer) {
        const headerText = PlyParserUtils.readHeaderFromBuffer(plyBuffer);
        return INRIAV2PlyParser.decodeHeaderFromHeaderText(headerText);
    }

    static findVertexData(plyBuffer, header, targetSection) {
        let byteOffset = header.headerSizeBytes;
        for (let s = 0; s < targetSection && s < header.sectionHeaders.length; s++) {
            const sectionHeader = header.sectionHeaders[s];
            byteOffset += sectionHeader.dataSizeBytes;
        }
        return new DataView(plyBuffer, byteOffset, header.sectionHeaders[targetSection].dataSizeBytes);
    }

    static decodeCodeBook(codeBookData, sectionHeader) {

        const rawVertex = [];
        const codeBook = [];
        for (let row = 0; row < sectionHeader.vertexCount; row++) {
            PlyParserUtils.readVertex(codeBookData, sectionHeader, row, 0, CodeBookEntriesToReadIndexes, rawVertex);
            for (let index of CodeBookEntriesToReadIndexes) {
                const codeBookElementOffset = CodeBookEntriesToReadIndexes[index];
                let codeBookPage = codeBook[codeBookElementOffset];
                if (!codeBookPage) {
                    codeBook[codeBookElementOffset] = codeBookPage = [];
                }
                codeBookPage.push(rawVertex[index]);
            }
        }
        for (let page = 0; page < codeBook.length; page++) {
            const codeBookPage = codeBook[page];
            const SH_C0 = 0.28209479177387814;
            for (let i = 0; i < codeBookPage.length; i++) {
               const baseValue = fromHalfFloat(codeBookPage[i]);
                if (page === CB_OPACITY) {
                    codeBookPage[i] = Math.round((1 / (1 + Math.exp(-baseValue))) * 255);
                } else if (page === CB_FEATURES_DC) {
                    codeBookPage[i] = Math.round((0.5 + SH_C0 * baseValue) * 255);
                } else if (page === CB_SCALING) {
                    codeBookPage[i] = Math.exp(baseValue);
                } else {
                    codeBookPage[i] = baseValue;
                }
            }
        }
        return codeBook;
    }

    static decodeSectionSplatData(sectionSplatData, splatCount, sectionHeader, codeBook, outSphericalHarmonicsDegree) {
        outSphericalHarmonicsDegree = Math.min(outSphericalHarmonicsDegree, sectionHeader.sphericalHarmonicsDegree);
        const splatArray = new UncompressedSplatArray(outSphericalHarmonicsDegree);
        for (let row = 0; row < splatCount; row++) {
            const newSplat = INRIAV2PlyParser.parseToUncompressedSplat(sectionSplatData, row, sectionHeader, codeBook,
                                                                       0, outSphericalHarmonicsDegree);
            splatArray.addSplat(newSplat);
        }
        return splatArray;
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

        return function(splatData, row, header, codeBook, splatDataOffset = 0, outSphericalHarmonicsDegree = 0) {
            outSphericalHarmonicsDegree = Math.min(outSphericalHarmonicsDegree, header.sphericalHarmonicsDegree);
            INRIAV2PlyParser.readSplat(splatData, header, row, splatDataOffset, rawSplat);
            const newSplat = UncompressedSplatArray.createSplat(outSphericalHarmonicsDegree);
            if (rawSplat[PLY_SCALE_0] !== undefined) {
                newSplat[OFFSET_SCALE0] = codeBook[CB_SCALING][rawSplat[PLY_SCALE_0]];
                newSplat[OFFSET_SCALE1] = codeBook[CB_SCALING][rawSplat[PLY_SCALE_1]];
                newSplat[OFFSET_SCALE2] = codeBook[CB_SCALING][rawSplat[PLY_SCALE_2]];
            } else {
                newSplat[OFFSET_SCALE0] = 0.01;
                newSplat[OFFSET_SCALE1] = 0.01;
                newSplat[OFFSET_SCALE2] = 0.01;
            }

            if (rawSplat[PLY_F_DC_0] !== undefined) {
                newSplat[OFFSET_FDC0] = codeBook[CB_FEATURES_DC][rawSplat[PLY_F_DC_0]];
                newSplat[OFFSET_FDC1] = codeBook[CB_FEATURES_DC][rawSplat[PLY_F_DC_1]];
                newSplat[OFFSET_FDC2] = codeBook[CB_FEATURES_DC][rawSplat[PLY_F_DC_2]];
            } else if (rawSplat[PLY_RED] !== undefined) {
                newSplat[OFFSET_FDC0] = rawSplat[PLY_RED] * 255;
                newSplat[OFFSET_FDC1] = rawSplat[PLY_GREEN] * 255;
                newSplat[OFFSET_FDC2] = rawSplat[PLY_BLUE] * 255;
            } else {
                newSplat[OFFSET_FDC0] = 0;
                newSplat[OFFSET_FDC1] = 0;
                newSplat[OFFSET_FDC2] = 0;
            }

            if (rawSplat[PLY_OPACITY] !== undefined) {
                newSplat[OFFSET_OPACITY] = codeBook[CB_OPACITY][rawSplat[PLY_OPACITY]];
            }

            newSplat[OFFSET_FDC0] = clamp(Math.floor(newSplat[OFFSET_FDC0]), 0, 255);
            newSplat[OFFSET_FDC1] = clamp(Math.floor(newSplat[OFFSET_FDC1]), 0, 255);
            newSplat[OFFSET_FDC2] = clamp(Math.floor(newSplat[OFFSET_FDC2]), 0, 255);
            newSplat[OFFSET_OPACITY] = clamp(Math.floor(newSplat[OFFSET_OPACITY]), 0, 255);

            if (outSphericalHarmonicsDegree >= 1 && header.sphericalHarmonicsDegree >= 1) {
                for (let i = 0; i < 9; i++) {
                    const codeBookPage = codeBook[CB_FEATURES_REST_0 + i % 3];
                    newSplat[OFFSET_FRC[i]] = codeBookPage[rawSplat[header.sphericalHarmonicsDegree1Fields[i]]];
                }
                if (outSphericalHarmonicsDegree >= 2 && header.sphericalHarmonicsDegree >= 2) {
                    for (let i = 0; i < 15; i++) {
                        const codeBookPage = codeBook[CB_FEATURES_REST_3 + i % 5];
                        newSplat[OFFSET_FRC[9 + i]] = codeBookPage[rawSplat[header.sphericalHarmonicsDegree2Fields[i]]];
                    }
                }
            }

            const rot0 = codeBook[CB_ROTATION_RE][rawSplat[PLY_ROT_0]];
            const rot1 = codeBook[CB_ROTATION_IM][rawSplat[PLY_ROT_1]];
            const rot2 = codeBook[CB_ROTATION_IM][rawSplat[PLY_ROT_2]];
            const rot3 = codeBook[CB_ROTATION_IM][rawSplat[PLY_ROT_3]];
            tempRotation.set(rot0, rot1, rot2, rot3);
            tempRotation.normalize();

            newSplat[OFFSET_ROTATION0] = tempRotation.x;
            newSplat[OFFSET_ROTATION1] = tempRotation.y;
            newSplat[OFFSET_ROTATION2] = tempRotation.z;
            newSplat[OFFSET_ROTATION3] = tempRotation.w;

            newSplat[OFFSET_X] = fromHalfFloat(rawSplat[PLY_X]);
            newSplat[OFFSET_Y] = fromHalfFloat(rawSplat[PLY_Y]);
            newSplat[OFFSET_Z] = fromHalfFloat(rawSplat[PLY_Z]);

            return newSplat;
        };

    }();

    static readSplat(splatData, header, row, dataOffset, rawSplat) {
        return PlyParserUtils.readVertex(splatData, header, row, dataOffset, FieldsToReadIndexes, rawSplat, false);
    }

    static parseToUncompressedSplatArray(plyBuffer, outSphericalHarmonicsDegree = 0) {
        const splatArrays = [];
        const header = INRIAV2PlyParser.decodeHeaderFromBuffer(plyBuffer, outSphericalHarmonicsDegree);
        let codeBook;

        for (let s = 0; s < header.sectionHeaders.length; s++) {
            const sectionHeader = header.sectionHeaders[s];
            if (sectionHeader.sectionName === 'codebook_centers') {
                const codeBookData = INRIAV2PlyParser.findVertexData(plyBuffer, header, s);
                codeBook = INRIAV2PlyParser.decodeCodeBook(codeBookData, sectionHeader);
            }
        }
        for (let s = 0; s < header.sectionHeaders.length; s++) {
            const sectionHeader = header.sectionHeaders[s];
            if (sectionHeader.sectionName !== 'codebook_centers') {
                const splatCount = sectionHeader.vertexCount;
                const vertexData = INRIAV2PlyParser.findVertexData(plyBuffer, header, s);
                const splatArray = INRIAV2PlyParser.decodeSectionSplatData(vertexData, splatCount, sectionHeader,
                                                               codeBook, outSphericalHarmonicsDegree);
                splatArrays.push(splatArray);
            }
        }

        const unified = new UncompressedSplatArray(outSphericalHarmonicsDegree);
        for (let splatArray of splatArrays) {
            for (let splat of splatArray.splats) {
                unified.addSplat(splat);
            }
        }

        return unified;
    }
}
