import * as THREE from 'three';
import { districtById } from '../core/realm.js';

// Small maker's marks in the existing architecture, not navigation or reward gates. Dimensions retain the official
// SVG viewBoxes and their clear space. This persistent group is built once, so progression never reloads a logo.
const SITES = Object.freeze([
  { id: 'channel3', district: 'market', x: 9.35, z: 6.2, y: 3.95, width: 5.8, ratio: 1381 / 283, supportBase: 2.5 },
  { id: 'ag-grid', district: 'keep', x: -14, z: 8, y: 2.8, width: 7.6, ratio: 238 / 70, supportBase: .25 },
  { id: 'apimatic', district: 'wizard', x: 7.4, z: 2.5, y: 3.1, width: 7.5, ratio: 350 / 55, supportBase: .25 },
]);

export function createSponsorSigns(parent, { part, builder, colours: C, onReady = () => {} }) {
  const geometry = new THREE.PlaneGeometry(1, 1), textures = [], materials = [], records = [];
  const loader = new THREE.TextureLoader();
  let disposed = false;
  for (const site of SITES) {
    const district = districtById(site.district), height = site.width / site.ratio, boardW = site.width + .65, boardH = height + .55;
    const group = new THREE.Group(); group.name = `sponsor-${site.id}`; group.position.set(district.x + site.x, 0, district.z + site.z); parent.add(group);
    const box = (x, y, z, w, h, d, c) => part(group, 'box', x, y, z, w, h, d, c);
    const top = site.y + boardH / 2, supportH = top + .12 - site.supportBase;
    for (const side of [-1, 1]) {
      const x = side * (boardW / 2 - .24);
      box(x, site.supportBase + supportH / 2, 0, .19, supportH, .22, C.wood);
      box(x, top + .11, 0, .3, .16, .32, C.gold);
      if (site.supportBase < 1) box(x, .36, 0, .52, .24, .58, C.stone);
    }
    box(0, site.y, 0, boardW, boardH, .23, C.wood);
    box(0, site.y, .13, boardW - .2, boardH - .2, .06, C.dark);
    box(0, site.y, -.13, boardW - .2, boardH - .2, .06, C.dark);
    for (const yy of [-1, 1]) box(0, site.y + yy * (boardH / 2 - .07), 0, boardW, .065, .28, C.gold);
    const record = { id: site.id, district: site.district, loaded: false, failed: false, x: group.position.x, z: group.position.z, width: boardW };
    records.push(record);
    // The viewBox-only AG Grid SVG loads but paints blank as a WebGL texture in Chromium. Its local transparent PNG
    // is rasterized from the unchanged official SVG; the original file and conversion provenance remain bundled.
    const extension = site.id === 'ag-grid' ? 'png' : 'svg';
    const texture = loader.load(`/assets/brand/sponsors/${site.id}.${extension}`, () => {
      if (disposed) return;
      record.loaded = true; onReady();
    }, undefined, () => { if (!disposed) { record.failed = true; onReady(); } });
    texture.colorSpace = THREE.SRGBColorSpace;
    textures.push(texture);
    const material = new THREE.MeshLambertMaterial({ map: texture, transparent: true, alphaTest: .08, depthWrite: false });
    materials.push(material);
    for (const side of [-1, 1]) {
      const face = new THREE.Mesh(geometry, material);
      face.position.set(0, site.y, side * .17); face.rotation.y = side < 0 ? Math.PI : 0;
      face.scale.set(site.width, height, 1); group.add(face);
    }
  }
  builder.flush();
  return {
    debug: () => records.map(record => ({ ...record })),
    dispose() { disposed = true; geometry.dispose(); textures.forEach(t => t.dispose()); materials.forEach(m => m.dispose()); },
  };
}
