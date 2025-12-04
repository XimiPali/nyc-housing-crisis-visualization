import { parsePermitFeature } from './utils/parsePermit.js';
import { filterByBorough } from './utils/filterByBorough.js';
import { computePermitStats } from './utils/computeStats.js';
import { getPermitColor } from './utils/getPermitColor.js';

/* =============================
      BASIC MAP SETUP
============================= */
const map = L.map('map').setView([40.7128, -74.0060], 11);

L.tileLayer('https://tile.openstreetmap.de/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);


/* =============================
      DISTRICTS (simple load)
============================= */
function districtStyle() {
  return { color: '#444', weight: 1, fillColor: '#87CEFA', fillOpacity: 0.12 };
}

// Districts layer with interactivity (hover, click -> district stats)
let districtsLayer = null;
let selectedDistrictLayer = null;
let districtHeatLayer = null;

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi + 0.0) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function isPointInPolygon(lon, lat, geom) {
  if (!geom) return false;
  const type = geom.type;
  const coords = geom.coordinates;
  if (type === 'Polygon') {
    // check exterior ring and ignore holes
    return pointInRing(lon, lat, coords[0]);
  } else if (type === 'MultiPolygon') {
    for (const poly of coords) {
      if (pointInRing(lon, lat, poly[0])) return true;
    }
    return false;
  }
  return false;
}

function getDistrictName(feature) {
  const p = feature.properties || {};
  // Prefer human-readable name fields; fall back to community district from BoroCD
  if (p.NTA_NAME) return p.NTA_NAME;
  if (p.name) return p.name;
  if (p.DISTRICT) return p.DISTRICT;
  if (p.BoroName) return p.BoroName;
  if (p.NTA) return p.NTA;
  if (p.BoroCD) {
    const cd = Number(p.BoroCD);
    if (!isNaN(cd)) {
      const cdNum = cd % 100;
      return `Community District ${cdNum}`;
    }
  }
  return 'District';
}

function getDistrictBorough(feature) {
  const p = feature.properties || {};
  // Try common fields
  if (p.BoroName) return p.BoroName;
  if (p.boro_name) return p.boro_name;
  if (p.BOROUGH) return p.BOROUGH;
  if (p.Boro) return p.Boro;
  if (p.BORO) return p.BORO;
  if (p.boro) return p.boro;
  // Derive from BoroCD if present: first digit is borough code
  if (p.BoroCD) {
    const cd = Number(p.BoroCD);
    if (!isNaN(cd)) {
      const code = Math.floor(cd / 100);
      const mapping = {1:'MANHATTAN',2:'BRONX',3:'BROOKLYN',4:'QUEENS',5:'STATEN ISLAND'};
      return mapping[code] || '';
    }
  }
  return '';
}

function getDistrictDisplay(feature) {
  const name = getDistrictName(feature);
  const boro = (getDistrictBorough(feature) || '').toString();
  if (boro) return `${name} — ${boro}`;
  return name;
}

function updateDistrictPanelFromStats(stats, filtered) {
  document.querySelector('#districtTotal').innerText = stats.total || 0;
  const nbCount = stats.byPermitType['NB'] || 0;
  const a1Count = (stats.byPermitType['A1'] || 0) + (stats.byJobType['A1'] || 0);
  document.querySelector('#districtNB').innerText = nbCount;
  document.querySelector('#districtA1').innerText = a1Count;
  const devScore = (nbCount * 2) + a1Count + (stats.total * 0.1);
  document.querySelector('#districtScore').innerText = devScore.toFixed(1);

  const permitTypeList = document.querySelector('#districtPermitTypeList');
  permitTypeList.innerHTML = '';
  Object.entries(stats.byPermitType).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => {
    const li = document.createElement('li'); li.textContent = `${k}: ${v}`; permitTypeList.appendChild(li);
  });

  const jobTypeList = document.querySelector('#districtJobTypeList');
  jobTypeList.innerHTML = '';
  Object.entries(stats.byJobType).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => {
    const li = document.createElement('li'); li.textContent = `${k}: ${v}`; jobTypeList.appendChild(li);
  });

  // show panel
  const panel = document.querySelector('#districtPanel');
  panel.style.display = 'block';
}

function clearDistrictSelection() {
  if (selectedDistrictLayer && districtsLayer) {
    districtsLayer.resetStyle(selectedDistrictLayer);
    selectedDistrictLayer = null;
  }
  if (districtHeatLayer) { map.removeLayer(districtHeatLayer); districtHeatLayer = null; }
  const panel = document.querySelector('#districtPanel');
  if (panel) panel.style.display = 'none';
}

function filterFeaturesInGeometry(geom) {
  return allFeatures.filter(f => isPointInPolygon(f.lon, f.lat, geom));
}

function handleDistrictClick(e) {
  const layer = e.target;
  const feature = layer.feature;
  // clear previous
  if (selectedDistrictLayer && selectedDistrictLayer !== layer) {
    districtsLayer.resetStyle(selectedDistrictLayer);
  }
  selectedDistrictLayer = layer;
  layer.setStyle({ weight: 3, color: '#ff0000', fillOpacity: 0.35 });

  // compute stats for permits inside this district
  const filtered = filterFeaturesInGeometry(feature.geometry);
  const stats = computePermitStats(filtered);
  document.querySelector('#districtTitle').innerText = getDistrictName(feature);
  updateDistrictPanelFromStats(stats, filtered);

  // add district heat overlay (temporary)
  if (districtHeatLayer) { map.removeLayer(districtHeatLayer); districtHeatLayer = null; }
  const pts = filtered.map(f => [f.lat, f.lon, 0.7]);
  if (pts.length) {
    districtHeatLayer = L.heatLayer(pts, { radius: 25, blur: 15 }).addTo(map);
  }
}

function handleDistrictHover(e) {
  const layer = e.target;
  layer.setStyle({ weight: 2, fillOpacity: 0.2 });
  layer.openTooltip();
}

function handleDistrictOut(e) {
  const layer = e.target;
  if (selectedDistrictLayer !== layer) districtsLayer.resetStyle(layer);
  layer.closeTooltip();
}

// load geojson and attach events
fetch('data/districts.geojson')
  .then(r => r.json())
  .then(g => {
    districtsLayer = L.geoJSON(g, {
      style: districtStyle,
      onEachFeature: function(feature, layer) {
        const display = getDistrictDisplay(feature);
        layer.bindTooltip(display, { sticky: true });
        layer.on({ mouseover: handleDistrictHover, mouseout: handleDistrictOut, click: handleDistrictClick });
      }
    }).addTo(map);
  })
  .catch(() => console.warn('Could not load districts'));

// district control buttons
document.addEventListener('click', (ev) => {
  if (ev.target && ev.target.id === 'showDistrictOnly') {
    if (!selectedDistrictLayer) return;
    const geom = selectedDistrictLayer.feature.geometry;
    const filtered = filterFeaturesInGeometry(geom);
    rebuildLayers(filtered);
    const bounds = selectedDistrictLayer.getBounds ? selectedDistrictLayer.getBounds() : L.geoJSON(selectedDistrictLayer.feature).getBounds();
    if (bounds && bounds.isValid()) map.fitBounds(bounds);
  }
  if (ev.target && ev.target.id === 'showAllDistricts') {
    clearDistrictSelection();
    rebuildLayers(allFeatures);
  }
});


/* =============================
      State holders
============================= */
const MAX_CONSTRUCTION = 5000;
let allFeatures = []; // parsed features
let currentCluster = null;
let currentHeat = null;
let currentMarkerLayer = null; // unclustered markers layer
let isClusterOn = true;
let isHeatOn = false;


/* =============================
      UI helpers
============================= */
function q(selector) { return document.querySelector(selector); }

function updateStatsPanel(stats) {
  q('#totalPermits').innerText = stats.total || 0;

  const boroughList = q('#boroughList');
  boroughList.innerHTML = '';
  Object.entries(stats.byBorough).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => {
    const li = document.createElement('li'); li.textContent = `${k}: ${v}`; boroughList.appendChild(li);
  });

  const permitTypeList = q('#permitTypeList');
  permitTypeList.innerHTML = '';
  Object.entries(stats.byPermitType).sort((a,b)=>b[1]-a[1]).forEach(([k,v]) => {
    const li = document.createElement('li'); li.textContent = `${k}: ${v}`; permitTypeList.appendChild(li);
  });

  const jobTypeList = q('#jobTypeList');
  jobTypeList.innerHTML = '';
  Object.entries(stats.byJobType).sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([k,v]) => {
    const li = document.createElement('li'); li.textContent = `${k}: ${v}`; jobTypeList.appendChild(li);
  });
}


/* =============================
      Marker + layer builders
============================= */
function createMarkerFromParsed(p, index) {
  const color = getPermitColor(p.permitType);
  const marker = L.circleMarker([p.lat, p.lon], {
    radius: 5,
    color: color,
    weight: 1,
    fillColor: color,
    fillOpacity: 0.9
  });

  const props = p.properties || {};
  const popup = `
    <b>Permit Status:</b> ${props['Permit Status'] || ''}<br>
    <b>Permit Type:</b> ${props['Permit Type'] || ''}<br>
    <b>Borough:</b> ${props['BOROUGH'] || ''}<br>
    <b>Job Type:</b> ${props['Job Type'] || ''}<br>
    <b>Filing Status:</b> ${props['Filing Status'] || ''}
  `;
  marker.bindPopup(popup);
  return marker;
}

function rebuildLayers(filteredFeatures) {
  // remove old
  if (currentCluster) { map.removeLayer(currentCluster); currentCluster = null; }
  if (currentHeat) { map.removeLayer(currentHeat); currentHeat = null; }
  if (currentMarkerLayer) { map.removeLayer(currentMarkerLayer); currentMarkerLayer = null; }

  // create new cluster and flat marker layer
  const cluster = L.markerClusterGroup();
  const markerLayer = L.layerGroup();
  const heatPoints = [];

  filteredFeatures.forEach((f) => {
    const clusterMarker = createMarkerFromParsed(f);
    const flatMarker = createMarkerFromParsed(f);
    cluster.addLayer(clusterMarker);
    markerLayer.addLayer(flatMarker);
    heatPoints.push([f.lat, f.lon, 0.6]);
  });

  currentCluster = cluster;
  currentMarkerLayer = markerLayer;
  currentHeat = L.heatLayer(heatPoints, { radius: 25, blur: 15 });

  if (isClusterOn) map.addLayer(currentCluster);
  else map.addLayer(currentMarkerLayer);
  if (isHeatOn) map.addLayer(currentHeat);
}


/* =============================
      NDJSON streaming loader
============================= */
async function loadConstructionFromNDJSON() {
  let fileIndex = 0;
  let processed = 0;
  while (processed < MAX_CONSTRUCTION) {
    const url = `data/ndjson/construction_${fileIndex}.ndjson`;
    fileIndex++;
    try {
      const res = await fetch(url);
      if (!res.ok) { break; }
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let { value, done } = await reader.read();
      let buffer = '';
      while (!done && processed < MAX_CONSTRUCTION) {
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split(/\r?\n/);
        buffer = parts.pop();
        for (const line of parts) {
          if (!line || !line.trim()) continue;
          try {
            const f = JSON.parse(line);
            const p = parsePermitFeature(f);
            if (!p || !p.lat || !p.lon || isNaN(p.lat) || isNaN(p.lon)) continue;
            allFeatures.push(p);
            processed++;
            if (processed >= MAX_CONSTRUCTION) break;
          } catch (e) { console.warn('Invalid NDJSON line skipped:', e && e.message); }
        }
        ({ value, done } = await reader.read());
      }
      if (buffer && buffer.trim() && processed < MAX_CONSTRUCTION) {
        try {
          const f = JSON.parse(buffer);
          const p = parsePermitFeature(f);
          if (p && p.lat && p.lon) { allFeatures.push(p); processed++; }
        } catch (e) { console.warn('Invalid trailing NDJSON line skipped:', e && e.message); }
      }
    } catch (err) { console.warn('Failed to fetch or stream', url, err && err.message); break; }
  }

  console.log(`Finished loading construction NDJSON — processed ${allFeatures.length} features`);

  // Build initial layers and stats
  rebuildLayers(allFeatures);
  const stats = computePermitStats(allFeatures);
  updateStatsPanel(stats);
}

loadConstructionFromNDJSON().catch(err => console.error('Error loading NDJSON construction data:', err));


/* =============================
      UI: filters / toggles
============================= */
function applyBoroughFilter(shortCode) {
  const filtered = shortCode ? filterByBorough(allFeatures, shortCode) : allFeatures.slice();
  rebuildLayers(filtered);
  const stats = computePermitStats(filtered);
  updateStatsPanel(stats);
}

q('#showAll').addEventListener('click', () => applyBoroughFilter(null));
document.querySelectorAll('.borough-btn').forEach(b => {
  b.addEventListener('click', (ev) => {
    const code = ev.currentTarget.dataset.boro;
    applyBoroughFilter(code);
  });
});

q('#toggleCluster').addEventListener('click', () => {
  isClusterOn = !isClusterOn;
  if (isClusterOn) {
    if (currentMarkerLayer) map.removeLayer(currentMarkerLayer);
    if (currentCluster) map.addLayer(currentCluster);
  } else {
    if (currentCluster) map.removeLayer(currentCluster);
    if (currentMarkerLayer) map.addLayer(currentMarkerLayer);
  }
});

q('#toggleHeat').addEventListener('click', () => {
  isHeatOn = !isHeatOn;
  if (isHeatOn) {
    if (currentHeat) map.addLayer(currentHeat);
  } else {
    if (currentHeat) map.removeLayer(currentHeat);
  }
});

