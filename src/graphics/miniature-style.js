import * as THREE from "three";

/** Brighter heraldic enamel over the original authored geometry. */
export const MINIATURE_INK = 0x122638;
export const ENAMEL = Object.freeze({
  gold: 0xf2b62f,
  steel: 0x92bde0,
  darksteel: 0x294562,
  red: 0xd42f49,
  blue: 0x2469d8,
  purple: 0x914dc8,
  green: 0x228b59,
  moss: 0x176249,
  leaf: 0x6fcf65,
  stone: 0x70968d,
  lightstone: 0xa8c6a1,
  orange: 0xf18232,
  black: MINIATURE_INK,
  brown: 0x70452e,
  cream: 0xffe5ab,
  skin: 0xd5926c,
  pale: 0xf2be91,
  copper: 0xd78839,
});
const procedural = new Map([
  [0x9fadb2, ENAMEL.steel],
  [0xd8b168, ENAMEL.gold],
  [0xdcd1ad, ENAMEL.cream],
  [0x35484a, ENAMEL.black],
  [0x527557, ENAMEL.green],
  [0x58678f, 0x575bd5],
  [0xd7b78f, ENAMEL.pale],
  [0x99c7d7, 0x45d9ec],
  [0x684e38, ENAMEL.brown],
]);

export function paintMiniature(root) {
  const replacements = new Map();
  root.traverse((object) => {
    if (!object.isMesh) return;
    const original = Array.isArray(object.material)
      ? object.material[0]
      : object.material;
    object.userData.plateInk =
      /steel|gold|copper/.test(original.name) || original.metalness >= 0.3;
    if (!replacements.has(original)) {
      const material = original.clone();
      const name = original.name.replace(/\.\d+$/, "").toLowerCase();
      const colour = ENAMEL[name] ?? procedural.get(original.color.getHex());
      if (colour !== undefined) material.color.setHex(colour);
      material.metalness = object.userData.plateInk ? 0.2 : 0;
      material.roughness = object.userData.plateInk ? 0.48 : 0.79;
      replacements.set(original, material);
    }
    object.material = replacements.get(original);
  });
  for (const original of replacements.keys()) original.dispose();
  return root;
}

/** Screen-independent contour thickness in normalized portrait/view space. */
export function inkPortrait(root, width = 0.014) {
  const hullMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: true,
    uniforms: {
      ink: { value: new THREE.Color(MINIATURE_INK) },
      width: { value: width },
    },
    vertexShader: `uniform float width;
      void main(){vec4 p=modelViewMatrix*vec4(position,1.0);
        p.xyz+=normalize(normalMatrix*normal)*width;gl_Position=projectionMatrix*p;}`,
    fragmentShader: `uniform vec3 ink;
      void main(){gl_FragColor=vec4(ink,1.0);
        #include <colorspace_fragment>
      }`,
  });
  const lineMaterial = new THREE.LineBasicMaterial({
    color: MINIATURE_INK,
    depthWrite: false,
    toneMapped: true,
  });
  const parts = [];
  root.traverse((object) => {
    if (object.isMesh) parts.push(object);
  });
  for (const object of parts) {
    const hull = new THREE.Mesh(object.geometry, hullMaterial);
    hull.name = "Portrait contour";
    hull.renderOrder = -1;
    object.add(hull);
    if (object.userData.plateInk) {
      const geometry = new THREE.EdgesGeometry(object.geometry, 36);
      const edges = new THREE.LineSegments(geometry, lineMaterial);
      edges.name = "Armor plate seams";
      edges.renderOrder = 1;
      object.add(edges);
    }
  }
  return root;
}
