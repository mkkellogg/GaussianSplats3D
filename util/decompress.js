import fs from 'fs';
import * as CompressedPlyParser from '../build/gaussian-splats-3d.decompress.js';
// get the command line arguments

const args = process.argv.slice(2).filter(arg => arg !== '--');

if (args.length !== 2) {
  console.log('Usage: node compress.js <input file> <output file>');
  process.exit(1);
}
// argument 1 is the input file
const inputFile = args[0];
// argument 2 is the output file
const outputFile = args[1];

// read the input file
const inputBuffer = fs.readFileSync(inputFile);
// compress the input file

const parser = new CompressedPlyParser.PlyParserDecompress();
await parser.readPly(inputBuffer);
parser.decompress(0, 1, 5.0, 256);
const modelMatArray = [
  1, 0, 0, 0, // First column
  0, 1, 0, 0, // Second column
  0, 0, 1, 0, // Third column
  0, 0, 0, 1, // Fourth column
];
const vertices = {
  count: parser.splatData.numSplats,
};
const ply = parser.convertPlyWithThreeJS(parser.splatData, vertices, modelMatArray);
// write the compressed file
fs.writeFileSync(outputFile, ply);
