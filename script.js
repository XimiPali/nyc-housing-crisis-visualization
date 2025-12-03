// === CONFIG ===
const GEOAPIFY_KEY = "2330b8f47ad147fbb2564712ca2c0db3";
const VACATE_API =
  "https://data.cityofnewyork.us/resource/tb8q-a3ar.json?$limit=50000";
const MAX_POINTS = 5000; // max records to plot (for performance)



// === MAP SETUP ===
const map = L.map("map").setView([40.7128, -74.0060], 12);

// Base map layer
L.tileLayer("https://tile.openstreetmap.de/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);


// === OPTIONAL: NYC boundary via Geoapify (kept, but can remove if you want) ===
const boundaryURL =
  `https://api.geoapify.com/v1/boundaries/part-of?lat=40.7128&lon=-74.0060&apiKey=${GEOAPIFY_KEY}`;

fetch(boundaryURL)
  .then(resp => resp.json())
  .then(geojson => {
    L.geoJSON(geojson, {
      style: { color: "#ff7800", weight: 2, fillOpacity: 0.1 },
      // Convert any Point geometries to circle markers instead of default pin markers
      pointToLayer: function(feature, latlng) {
        return L.circleMarker(latlng, {
          radius: 6,
          color: '#ff7800',
          fillColor: '#ffcc99',
          fillOpacity: 0.9,
          weight: 1
        });
      }
    }).addTo(map);
  })
  .catch(err => console.error("Boundary error:", err));


// === SEARCH BAR (Leaflet-Control-Geocoder) ===
if (L.Control.Geocoder) {
  const geocoder = L.Control.geocoder({
    defaultMarkGeocode: false,
    position: 'topright'
  })
    .on("markgeocode", function (e) {
      const bbox = e.geocode.bbox;
      const poly = L.polygon([
        bbox.getSouthEast(),
        bbox.getNorthEast(),
        bbox.getNorthWest(),
        bbox.getSouthWest()
      ]);
      map.fitBounds(poly.getBounds());
    })
    .addTo(map);

  // Move the geocoder control below the stats panel so it's not overlapping
  // the NYC Housing Crisis Summary menu in the top-right.
  // Calculate an appropriate margin-top based on the stats panel height.
  try {
    const stats = document.getElementById('statsPanel');
    // geocoder control container: prefer control API, fallback to selector
    const container = (typeof geocoder.getContainer === 'function')
      ? geocoder.getContainer()
      : document.querySelector('.leaflet-control-geocoder');

    if (container && stats) {
      // Add a small gap after the panel
      const gap = 10;
      const marginTop = stats.offsetTop + stats.offsetHeight + gap;
      container.style.marginTop = marginTop + 'px';
      // Ensure it sits above map tiles but below the stats panel visually
      container.style.zIndex = 1000;
    }
  } catch (err) {
    console.error('Could not reposition geocoder control:', err);
  }
}


// === COLOR FUNCTION ===
function getMarkerColor(reason) {
  if (!reason) return "gray";
  const r = reason.toLowerCase();

  if (r.includes("fire")) return "red";
  if (r.includes("illegal")) return "purple";
  if (r.includes("habit")) return "orange";
  if (r.includes("entire")) return "black";

  return "blue"; // default/other
}

// === DATE FORMATTING ===
function formatDate(dateStr) {
  if (!dateStr) return "";
  // If date is an ISO string like '2024-01-23T00:00:00.000', strip the time portion
  try {
    return String(dateStr).replace(/T.*$/, "");
  } catch (e) {
    return String(dateStr);
  }
}


// === GLOBAL STATE ===
const markersData = []; // { marker, lat, lon, boro, reason }
let currentBoroFilter = null;

const clusterGroup = L.markerClusterGroup();
const nonClusterGroup = L.layerGroup();
let clusterEnabled = true;

let heatLayer = null;
let heatEnabled = true;


// === APPLY FILTER + REBUILD LAYERS ===
function applyFilter() {
  // clear all layers
  clusterGroup.clearLayers();
  nonClusterGroup.clearLayers();
  if (heatLayer) {
    map.removeLayer(heatLayer);
    heatLayer = null;
  }

  const heatPoints = [];

  // Stats counters
  let total = 0,
    fire = 0,
    illegal = 0,
    habit = 0,
    entire = 0,
    other = 0;

  markersData.forEach(md => {
    if (currentBoroFilter && md.boro !== currentBoroFilter) return;
      
    total++;

    const reason = (md.reason || "").toLowerCase();
    if (reason.includes("fire")) fire++;
    else if (reason.includes("illegal")) illegal++;
    else if (reason.includes("habit")) habit++;
    else if (reason.includes("entire")) entire++;
    else other++;

    // add marker to both groups
    clusterGroup.addLayer(md.marker);
    nonClusterGroup.addLayer(md.marker);

    // heatmap point
    heatPoints.push([md.lat, md.lon, 0.6]);
  });

  // add correct marker layer to map
  if (clusterEnabled) {
    if (!map.hasLayer(clusterGroup)) map.addLayer(clusterGroup);
    if (map.hasLayer(nonClusterGroup)) map.removeLayer(nonClusterGroup);
  } else {
    if (!map.hasLayer(nonClusterGroup)) map.addLayer(nonClusterGroup);
    if (map.hasLayer(clusterGroup)) map.removeLayer(clusterGroup);
  }

  // heatmap
  if (heatPoints.length > 0) {
    heatLayer = L.heatLayer(heatPoints, {
      radius: 25,
      blur: 15,
      maxZoom: 17,
      gradient: {
        0.2: "blue",
        0.4: "purple",
        0.6: "red",
        0.8: "orange",
        1.0: "yellow"
      }
    });
    if (heatEnabled) {
      heatLayer.addTo(map);
    }
  }

  // update stats panel
  document.getElementById("totalCases").textContent = total;
  document.getElementById("fireCount").textContent = fire;
  document.getElementById("illegalCount").textContent = illegal;
  document.getElementById("habitCount").textContent = habit;
  document.getElementById("entireCount").textContent = entire;
  document.getElementById("otherCount").textContent = other;
}


// === FETCH DATA & BUILD MARKERS ===
fetch(VACATE_API)
  .then(res => res.json())
  .then(rows => {
    console.log("Records loaded:", rows.length);
    let count = 0;

    rows.forEach(r => {
      if (count >= MAX_POINTS) return;
      if (!r.latitude || !r.longitude) return;

      const lat = parseFloat(r.latitude);
      const lon = parseFloat(r.longitude);

      if (isNaN(lat) || isNaN(lon)) return;

      const color = getMarkerColor(r.primary_vacate_reason);

      const marker = L.circleMarker([lat, lon], {
        radius: 7,
        color,
        fillColor: color,
        fillOpacity: 0.9
      });

      marker.bindPopup(`
        <b>Address:</b> ${r.house_number || ""} ${r.street_name || ""}<br>
        <b>Borough:</b> ${r.boro_short_name || ""}<br>
        <b>Reason:</b> ${r.primary_vacate_reason || ""}<br>
        <b>Vacated Units:</b> ${r.number_of_vacated_units || ""}<br>
        <b>Date:</b> ${formatDate(r.vacate_effective_date) || ""}<br>
      `);

      markersData.push({
        marker,
        lat,
        lon,
        boro: r.boro_short_name,
        reason: r.primary_vacate_reason
      });

      count++;
    });

    // initial render
    applyFilter();
  })
  .catch(err => console.error("Vacate API error:", err));


// === UI BUTTON HANDLERS ===

// Heatmap toggle
document.getElementById("toggleHeat").addEventListener("click", () => {
  heatEnabled = !heatEnabled;
  if (heatLayer) {
    if (heatEnabled) {
      heatLayer.addTo(map);
    } else {
      map.removeLayer(heatLayer);
    }
  }
});

// Cluster toggle
document.getElementById("toggleCluster").addEventListener("click", () => {
  clusterEnabled = !clusterEnabled;
  applyFilter(); // rebuilding which group is on map
});

// Borough filter buttons
document.querySelectorAll(".borough-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const boro = btn.getAttribute("data-boro");
    currentBoroFilter = boro;
    applyFilter();
  });
});

// Show all boroughs
document.getElementById("showAll").addEventListener("click", () => {
  currentBoroFilter = null;
  applyFilter();
});

