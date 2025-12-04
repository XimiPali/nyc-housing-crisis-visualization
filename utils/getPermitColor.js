const permitColors = {
  PL: '#e67e22', // orange
  EW: '#2e86c1', // blue
  NB: '#27ae60', // green
  AL: '#8e44ad', // purple (Alteration permit)
  FO: '#c0392b', // red
  EQ: '#34495e', // dark gray
  DM: '#ffffff', // white-ish for demolition (use border or gray circle)
  SG: '#7f5315'  // brown for sign
};

export function getPermitColor(permitType) {
  if (!permitType) return '#7f8c8d';
  const t = permitType.toString().toUpperCase().trim();
  // direct match or startsWith
  if (permitColors[t]) return permitColors[t];
  const key = Object.keys(permitColors).find(k => t.indexOf(k) === 0);
  return permitColors[key] || '#7f8c8d';
}
