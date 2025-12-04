const shortToFull = {
  MN: 'MANHATTAN',
  BK: 'BROOKLYN',
  BX: 'BRONX',
  QN: 'QUEENS',
  SI: 'STATEN ISLAND'
};

export function filterByBorough(features, boroughShort) {
  if (!boroughShort) return features.slice();
  const full = shortToFull[boroughShort] || boroughShort;
  return features.filter(f => (f.borough || '').toUpperCase() === full);
}
