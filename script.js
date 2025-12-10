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
============================= 
  This controls outline color, thickness, and fill transparency for each district.
*/
function districtStyle() {
  return { color: '#444', weight: 1, fillColor: '#87CEFA', fillOpacity: 0.12 };
}

// Districts layer with interactivity (hover, click -> district stats)
let districtsLayer = null;
let selectedDistrictLayer = null;
let districtHeatLayer = null;

// helper functions for point-in-polygon check if a coordinate is inside a district using the ray-casting algorithm even or odd
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

/* Determine whether a point belongs inside a district geometry. 
    Supports Polygon and MultiPolygon geometries.
    Used to assign each construction permit to a district.
*/
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

// Extracts the district name from various possible fields in the GeoJson properties
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

// Returns the borough name with a district feature
function getDistrictBorough(feature) {
  const p = feature.properties || {};

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

// Build the label shown hovering over a district
function getDistrictDisplay(feature) {
  const name = getDistrictName(feature);
  const boro = (getDistrictBorough(feature) || '').toString();
  if (boro) return `${name} — ${boro}`;
  return name;
}

/* 
    This update the dashboard panel with total permits and everything inside the district

    Development score = (NB(New Buildings) permits * 2) + (A1 permits) + (total permits * 0.1)
   The Development Score shows how much growth and construction is happening in each district.
   I got some of the idea from https://furmancenter.org/research/publications
*/

/**
 * Date: 12/05/2025
 * What I asked the AI (exact type of question):

I asked:

“I need to update my district panel with permit counts, job type counts, 
and calculate a development score. I also need to know if my logic is correct and how to structure the data inside the sidebar. 
Please debug anything that looks incorrect.”

I also asked:

“Where should the development score formula go?  Can you show me how to write this function correctly?”
 */
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

// Removes previous district selection and heat layer
function clearDistrictSelection() {
  if (selectedDistrictLayer && districtsLayer) {
    districtsLayer.resetStyle(selectedDistrictLayer);
    selectedDistrictLayer = null;
  }
  if (districtHeatLayer) { map.removeLayer(districtHeatLayer); districtHeatLayer = null; }
  const panel = document.querySelector('#districtPanel');
  if (panel) panel.style.display = 'none';
}

// Returns all permit points whose coordinates are inside the selected district
function filterFeaturesInGeometry(geom) {
  return allFeatures.filter(f => isPointInPolygon(f.lon, f.lat, geom));
}

// Handlers for district interactivity it will show the heat map and the stats when you click on the district
function handleDistrictClick(e) {
  const layer = e.target;
  const feature = layer.feature;
  // clear previous
  if (selectedDistrictLayer && selectedDistrictLayer !== layer) {
    districtsLayer.resetStyle(selectedDistrictLayer);
  }
  selectedDistrictLayer = layer;
  layer.setStyle({
    color: null,        // keep original outline
    weight: 1,          // do not increase border thickness
    fillColor: '#ff0000',
    fillOpacity: 0.35
  });

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

// Hover effect for districts and shows tooltip 
function handleDistrictHover(e) {
  const layer = e.target;
  layer.setStyle({ weight: 2, fillOpacity: 0.2 });
  layer.openTooltip();
}

// Remove hover effect when a user leaves a district
function handleDistrictOut(e) {
  const layer = e.target;
  if (selectedDistrictLayer !== layer) districtsLayer.resetStyle(layer);
  layer.closeTooltip();
}

// load geojson and attach events
// draws them on the map and attaches hover and click events
// After the districts shapes are ready, the permit layers are rebuilt
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

    if (allFeatures.length > 0) {
      rebuildLayers(allFeatures);
      const stats = computePermitStats(allFeatures);
      updateStatsPanel(stats);
    }

  })
  .catch(() => console.warn('Could not load districts'));


// district control buttons
// Show only selected district's permits
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
const MAX_CONSTRUCTION = Infinity;
let allFeatures = []; // parsed features
let currentCluster = null;
let currentHeat = null;
let currentMarkerLayer = null; // unclustered markers layer for now guys
let isClusterOn = true;
let isHeatOn = false;


/* =============================
      UI helpers
============================= */
// helps fucntions for document query selector
function q(selector) { return document.querySelector(selector); }


// Updates the stats panel with given stats object for all the permits: by boruough, permit type, job type
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
// Creates a Leaflet circle marker from a parsed permit feature
// Color depends on permit type and it also build the popup content with permit details
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

/**
 * REBUILD LAYERS — DISTRICT-BASED CLUSTERING
 * Instead of one global cluster, we build one per district.
 */
/**
 * This function rebuilds the map layers (clusters, markers, heatmap) based on the filtered features.
  It ensures that each permit is assigned to the correct district polygon,
  and creates separate cluster and marker layers for each district.
  Finally, it combines all district layers into single layers for display.
 * 
 */

  /**
   * Data: 12/04/2025
   * 
   * Source:
    OpenAI ChatGPT (Debugging assistance and logic explanation)

    What I asked the AI:
    Can you find the errors that I am having? I don’t know why my code is not working in this function.
    Here is my rebuildLayers() function—please debug it and explain what might be going wrong.

    Summary of Help Received:
    ChatGPT helped me understand and debug why my district-based clustering system was failing.
   */

function rebuildLayers(filteredFeatures) {

  // Removing old layers
  if (currentCluster) { map.removeLayer(currentCluster); currentCluster = null; }
  if (currentHeat) { map.removeLayer(currentHeat); currentHeat = null; }
  if (currentMarkerLayer) { map.removeLayer(currentMarkerLayer); currentMarkerLayer = null; }

  if (!districtsLayer) return;

  // Storing clusters and marker layers per district
  const districtClusters = {};
  const districtMarkerLayers = {};
  const heatPoints = [];

  // Build structure for each district
  districtsLayer.eachLayer(d => {
    const id = L.stamp(d);  // unique layer ID
    districtClusters[id] = L.markerClusterGroup({
  iconCreateFunction: function (cluster) {
    const count = cluster.getChildCount();

    // Iam only modifying these thresholds
    let sizeClass;
    if (count < 250) sizeClass = 'small';        //  green
    else if (count < 400) sizeClass = 'medium';  //  yellow
    else if (count < 600) sizeClass = 'large';  // orange
    else sizeClass = 'xlarge';                // red

    return new L.DivIcon({
      html: `<div><span>${count}</span></div>`,
      className: `marker-cluster marker-cluster-${sizeClass}`,
      iconSize: new L.Point(40, 40)
    });
  }
});

    districtMarkerLayers[id] = L.layerGroup();
  });

  // Assigning permits to the correct district polygon
  filteredFeatures.forEach(f => {
    let assigned = false;

    districtsLayer.eachLayer(d => {
      const geom = d.feature.geometry;
      const id = L.stamp(d);

      if (!assigned && isPointInPolygon(f.lon, f.lat, geom)) {

        // Create marker
        const clusterMarker = createMarkerFromParsed(f);
        const flatMarker = createMarkerFromParsed(f);

        districtClusters[id].addLayer(clusterMarker);
        districtMarkerLayers[id].addLayer(flatMarker);

        // Collect for heat map
        heatPoints.push([f.lat, f.lon, 0.6]);

        assigned = true;
      }
    });

  });

  // Combining all district clusters into one layer group
  const finalClusterGroup = L.layerGroup();
  const finalMarkerLayerGroup = L.layerGroup();

  Object.values(districtClusters).forEach(dc => finalClusterGroup.addLayer(dc));
  Object.values(districtMarkerLayers).forEach(ml => finalMarkerLayerGroup.addLayer(ml));

  currentCluster = finalClusterGroup;
  currentMarkerLayer = finalMarkerLayerGroup;

  // Heatmap
  currentHeat = L.heatLayer(heatPoints, { radius: 25, blur: 15 });

  // Adding layers to map
  if (isClusterOn) map.addLayer(currentCluster);
  else map.addLayer(currentMarkerLayer);

  if (isHeatOn) map.addLayer(currentHeat);
}



/* =============================
      NDJSON streaming loader
============================= */
/* 
  Loading construction permits from multiple NDJSON files until reaching MAX_CONSTRUCTION
  It also parses each permit, stores them in allFeatures array and 
  it triggers the initial map and stats building after loading.
*/

/**
 * Date: 12/04/2025
 * Source:
  OpenAI ChatGPT (Prompt-based debugging assistance)

  What I asked the AI:
  Can you help me debug this NDJSON streaming loader function by showing some console warnings, 
  invalid JSON lines, and how to skip null or missing coordinates?
 * 
 */
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
  // Wait for districtsLayer
  if (districtsLayer) {
    rebuildLayers(allFeatures);
    const stats = computePermitStats(allFeatures);
    updateStatsPanel(stats);
  }

}

loadConstructionFromNDJSON().catch(err => console.error('Error loading NDJSON construction data:', err));


/* =============================
      UI: filters / toggles
============================= */

// Rebuilds the map layers and update the sidebar
// After filtering, i also updated the map layers and recalculates the sidebar
function applyBoroughFilter(shortCode) {
  const filtered = shortCode ? filterByBorough(allFeatures, shortCode) : allFeatures.slice();
  rebuildLayers(filtered);
  const stats = computePermitStats(filtered);
  updateStatsPanel(stats);
}

q('#showAll').addEventListener('click', () => applyBoroughFilter(null));

// shows permit for a specific borough when clicking the buttons
document.querySelectorAll('.borough-btn').forEach(b => {
  b.addEventListener('click', (ev) => {
    const code = ev.currentTarget.dataset.boro;
    applyBoroughFilter(code);
  });
});

// Turns clustering on/off
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


// Enable/disable heatmap layer
q('#toggleHeat').addEventListener('click', () => {
  isHeatOn = !isHeatOn;
  if (isHeatOn) {
    if (currentHeat) map.addLayer(currentHeat);
  } else { 
    if (currentHeat) map.removeLayer(currentHeat);
  }
});

