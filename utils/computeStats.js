export function computePermitStats(features) {
  const stats = {
    total: 0,
    active: 0,
    byBorough: {},
    byPermitType: {},
    byJobType: {}
  };

  for (const f of features) {
    stats.total += 1;
    const status = (f.permitStatus || '').toUpperCase();
    if (status === 'ISSUED') stats.active += 1;

    const b = (f.borough || 'UNKNOWN') || 'UNKNOWN';
    stats.byBorough[b] = (stats.byBorough[b] || 0) + 1;

    const pt = (f.permitType || 'OTHER') || 'OTHER';
    stats.byPermitType[pt] = (stats.byPermitType[pt] || 0) + 1;

    const jt = (f.jobType || 'OTHER') || 'OTHER';
    stats.byJobType[jt] = (stats.byJobType[jt] || 0) + 1;
  }

  return stats;
}
