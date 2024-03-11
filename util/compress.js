import fs from 'fs';
import * as CompressedPlyParser from '../build/gaussian-splats-3d.compress.js';
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

const parser = new CompressedPlyParser.PlyParserCompress();
await parser.readPly(inputBuffer);
parser.convertFileToSplatData();
const compressedFile = parser.compress();


// write the compressed file
fs.writeFileSync(outputFile, compressedFile);
