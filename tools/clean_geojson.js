#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function usage() {
  console.log('Usage: node clean_geojson.js [input1.geojson,input2.geojson,...]');
  console.log('Defaults: ./data/districts.geojson, ./data/construction_data.geojson');
}

const argv = process.argv.slice(2);
let inputs = [];
if (argv.length === 0) {
  inputs = ['./data/districts.geojson', './data/construction_data.geojson'];
} else {
  inputs = argv[0].split(',').map(s => s.trim()).filter(Boolean);
}

function cleanText(text) {
  // Replacing everything with null 
  let out = text.replace(/\bNaN\b/g, 'null');
  out = out.replace(/\bNAN\b/g, 'null');
  out = out.replace(/\b-Infinity\b/g, 'null');
  out = out.replace(/\bInfinity\b/g, 'null');

  // Remove trailing commas before ] or }
  out = out.replace(/,\s*([\]}])/g, '$1');

  return out;
}

inputs.forEach(input => {
  try {
    if (!fs.existsSync(input)) {
      console.warn('If input is not found i have to skip for now', input);
      return;
    }
    const raw = fs.readFileSync(input, 'utf8');
    const cleaned = cleanText(raw);
    // Test parse
    try {
      JSON.parse(cleaned);
    } catch (e) {
      console.warn('Warning: cleaned JSON still fails to parse for', input);
      console.warn('Error:', e.message);
      // Still write the cleaned file — it may be good enough for the NDJSON converter
    }
    const outPath = input.replace(/\.geojson$/i, '.cleaned.geojson');
    fs.writeFileSync(outPath, cleaned, 'utf8');
    console.log('This is for a clean file, pleaseee workkkkkk:', outPath);
  } catch (err) {
    console.error('Error processing', input, err && err.message ? err.message : err);
  }
});

