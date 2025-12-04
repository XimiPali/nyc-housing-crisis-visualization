export function parsePermitFeature(f) {
  const props = f.properties || {};
  const coords = f.geometry && f.geometry.coordinates;
  const lon = coords && coords[0] !== undefined ? parseFloat(coords[0]) : null;
  const lat = coords && coords[1] !== undefined ? parseFloat(coords[1]) : null;

  return {
    lon,
    lat,
    borough: (props.BOROUGH || '').toString().toUpperCase(),
    permitType: (props['Permit Type'] || props.PermitType || '').toString().toUpperCase(),
    jobType: (props['Job Type'] || props.JobType || '').toString().toUpperCase(),
    permitStatus: (props['Permit Status'] || '').toString().toUpperCase(),
    properties: props,
    raw: f
  };
}
