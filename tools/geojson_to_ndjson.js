#!/usr/bin/env node
/**
 * Data: 12/04/2025
 * 
 * Prompt: Ask ChatGPT to help me debug certain syntax or function iam writing wrong specifically 
 * into NDJSON format, splitting into multiple files.
 */

const fs = require('fs');
const path = require('path');

function usage() {
  console.log('Usage: node geojson_to_ndjson.js [input.geojson] [--chunk=N] [--out-dir=PATH]');
  console.log('Defaults: input=./data/construction_data.cleaned.geojson, chunk=10000, out-dir=./data/ndjson');
}

const argv = process.argv.slice(2);
let input = argv[0] || './data/construction_data.cleaned.geojson';
let chunk = 10000;
let outDir = './data/ndjson';

argv.slice(1).forEach(a => {
  if (a.startsWith('--chunk=')) chunk = parseInt(a.split('=')[1], 10) || chunk;
  if (a.startsWith('--out-dir=')) outDir = a.split('=')[1] || outDir;
  if (a === '--help' || a === '-h') { usage(); process.exit(0); }
});

if (!fs.existsSync(input)) {
  console.error('Input file not found:', input);
  usage();
  process.exit(2);
}

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

console.log(`Reading ${input} ...`);
const text = fs.readFileSync(input, 'utf8');

let obj;
try {
  obj = JSON.parse(text);
} catch (err) {
  console.error('Failed to parse input JSON. If the file is malformed, run the cleaner script first.');
  console.error(err && err.message ? err.message : err);
  process.exit(3);
}

if (!obj || obj.type !== 'FeatureCollection' || !Array.isArray(obj.features)) {
  console.error('Input does not look like a GeoJSON FeatureCollection');
  process.exit(4);
}

const total = obj.features.length;
console.log(`Found ${total} features. Writing NDJSON to ${outDir} (chunk=${chunk})`);

let fileIndex = 0;
let fileCount = 0;
let outStream = null;
function openNewStream() {
  if (outStream) outStream.end();
  const fname = path.join(outDir, `construction_${fileIndex}.ndjson`);
  outStream = fs.createWriteStream(fname, { flags: 'w' });
  console.log(`Writing ${fname} ...`);
  fileIndex++;
  fileCount = 0;
}

openNewStream();

function sanitizeFeature(f) {
  // Basic sanitization: removing NaN/Infinity lurking in numeric values by replacing with null
  const s = JSON.stringify(f, (k, v) => {
    if (typeof v === 'number') {
      if (!isFinite(v)) return null;
    }
    return v;
  });
  return s;
}

let written = 0;
for (let i = 0; i < obj.features.length; i++) {
  if (fileCount >= chunk) openNewStream();
  const feat = obj.features[i];
  try {
    const line = sanitizeFeature(feat);
    outStream.write(line + '\n');
    written++;
    fileCount++;
  } catch (e) {
    console.warn('Skipping feature at index', i, 'due to serialization error:', e && e.message);
  }
}

if (outStream) outStream.end();
