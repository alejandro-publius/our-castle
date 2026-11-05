// Presentation footprints in district-local metres. No entitlement or money rules.
export const FARM_SITES = Object.freeze([
  { id: 'village-coop', district: 'cottage', kind: 'coop', x: -11.8, z: 7.6, angle: 0, bounds: [-13.4, -8.7, 5.2, 9.1] },
  { id: 'village-goat', district: 'cottage', kind: 'goat', x: 8.5, z: 5.4, angle: 0, bounds: [6.7, 10.3, 3.9, 6.9] },
  { id: 'manor-pasture', district: 'manor', kind: 'sheep', x: -8.8, z: -4.6, angle: 0, bounds: [-11.8, -5.8, -7.3, -1.9] },
  { id: 'citadel-stables', district: 'castle', kind: 'stable', x: 21, z: -16, angle: 0, bounds: [17.2, 24.8, -18.8, -8.8] },
  { id: 'palace-stables', district: 'palace', kind: 'stable', x: 18, z: -7, angle: 0, bounds: [14.2, 21.8, -9.8, .2] },
].map((site) => Object.freeze({ ...site, bounds: Object.freeze(site.bounds) })));
export const inFarmPlot = (district, x, z, padding = 0) => FARM_SITES.some((site) =>
  site.district === district && x >= site.bounds[0] - padding && x <= site.bounds[1] + padding &&
  z >= site.bounds[2] - padding && z <= site.bounds[3] + padding);
