import * as THREE from "three";
import { OrbitControls } from "../../vendor/three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "../../vendor/three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "../../vendor/three/addons/environments/RoomEnvironment.js";
import { PixelRenderer } from "../graphics/pixel-renderer.js";
import { assetUrl } from "../assets.js";
import { HEROES, fieldById } from "./rules.js";

function randomFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const PAINT = {
  stone: 0xb8b6a0,
  light: 0xdcd1ad,
  dark: 0x35484a,
  timber: 0x684e38,
  brass: 0xd8b168,
  red: 0x994650,
  blue: 0x477ba3,
  steel: 0x9fadb2,
  leaf: 0x416746,
};
const FIELD_WIDTH = 90;
const FIELD_DEPTH = 31;
function insideField(x, z, margin = 1) {
  const u = Math.abs(x) / (FIELD_WIDTH / 2 - margin);
  const v = Math.abs(z) / (FIELD_DEPTH / 2 - margin);
  return u + (Math.SQRT2 - 1) * v < 1 && v + (Math.SQRT2 - 1) * u < 1;
}

/** A small original geometry vocabulary, batched by primitive and army. */
class Builder {
  constructor() {
    this.geometries = {
      box: new THREE.BoxGeometry(1, 1, 1),
      round: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
      cone: new THREE.ConeGeometry(0.5, 1, 6),
      rock: new THREE.IcosahedronGeometry(0.5, 0),
    };
    this.owned = new Set(Object.values(this.geometries));
    this.materials = new Set();
    this.buckets = new Map();
  }
  part(group, kind, x, y, z, w, h, d, colour, rx = 0, ry = 0, rz = 0) {
    let kinds = this.buckets.get(group);
    if (!kinds) this.buckets.set(group, (kinds = new Map()));
    if (!kinds.has(kind)) kinds.set(kind, []);
    kinds.get(kind).push({ x, y, z, w, h, d, colour, rx, ry, rz });
  }
  box(g, x, y, z, w, h, d, c, ry = 0, rz = 0) {
    this.part(g, "box", x, y, z, w, h, d, c, 0, ry, rz);
  }
  flush() {
    const t = new THREE.Object3D();
    for (const [group, kinds] of this.buckets)
      for (const [kind, pieces] of kinds) {
        const mat = new THREE.MeshStandardMaterial({
          roughness: 0.9,
          flatShading: true,
        });
        this.materials.add(mat);
        const mesh = new THREE.InstancedMesh(
          this.geometries[kind],
          mat,
          pieces.length,
        );
        pieces.forEach((p, i) => {
          t.position.set(p.x, p.y, p.z);
          t.scale.set(p.w, p.h, p.d);
          t.rotation.set(p.rx, p.ry, p.rz);
          t.updateMatrix();
          mesh.setMatrixAt(i, t.matrix);
          mesh.setColorAt(i, new THREE.Color(p.colour));
        });
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        group.add(mesh);
      }
    this.buckets.clear();
  }
  mesh(group, kind, x, y, z, w, h, d, colour, metalness = 0) {
    const mat = new THREE.MeshStandardMaterial({
      color: colour,
      roughness: metalness ? 0.48 : 0.85,
      metalness,
      flatShading: true,
    });
    this.materials.add(mat);
    const m = new THREE.Mesh(this.geometries[kind], mat);
    m.position.set(x, y, z);
    m.scale.set(w, h, d);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    return m;
  }
  dispose(root) {
    root.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
    });
    this.owned.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
  }
}

function banner(b, g, x, y, z, colour, size = 1) {
  b.box(g, x, y + 1.1 * size, z, 0.09, 2.5 * size, 0.09, PAINT.timber);
  b.part(g, "rock", x, y + 2.4 * size, z, 0.18, 0.23, 0.18, PAINT.brass);
  for (let i = 0; i < 4; i++) {
    b.box(
      g,
      x + (0.18 + i * 0.2) * size,
      y + 1.9 * size,
      z + Math.sin(i) * 0.08,
      0.22 * size,
      (0.85 - i * 0.06) * size,
      0.05,
      colour,
    );
  }
  b.box(
    g,
    x + 0.38 * size,
    y + 1.9 * size,
    z + 0.055,
    0.08 * size,
    0.45 * size,
    0.04,
    PAINT.brass,
  );
}
function tree(b, g, x, z, r, type = "oak") {
  const h = 2.1 + r() * 1.9;
  b.box(g, x, h * 0.42, z, 0.36, h * 0.85, 0.38, PAINT.timber, r());
  if (type === "pine") {
    for (let j = 0; j < 3; j++)
      b.part(
        g,
        "cone",
        x,
        h * 0.6 + j * 0.85,
        z,
        2.9 - j * 0.65,
        2.6,
        2.9 - j * 0.65,
        [0x254d3d, 0x356248, 0x547753][j],
      );
  } else {
    for (let j = 0; j < 4; j++)
      b.part(
        g,
        "rock",
        x + (r() - 0.5) * 1.4,
        h + (j % 2) * 0.7,
        z + (r() - 0.5) * 1.5,
        2.8,
        2.2,
        2.5,
        [0x396044, 0x547753, 0x668c55, 0x31513c][j],
        0,
        r() * 6,
      );
  }
}
function person(b, g, x, y, z, colour, r, cowboy = false, crowd = false) {
  const skin = [0xb78061, 0xe0ba91, 0x795141, 0xc99a73][Math.floor(r() * 4)];
  const s = crowd ? 0.7 : 1;
  const part = (xx, yy, zz, w, h, d, c) =>
    b.box(g, x + xx * s, y + yy * s, z + zz * s, w * s, h * s, d * s, c);
  part(-0.12, 0.17, 0, 0.19, 0.32, 0.22, 0x364248);
  part(0.12, 0.17, 0, 0.19, 0.32, 0.22, 0x364248);
  part(0, 0.53, 0, 0.45, 0.43, 0.28, colour);
  part(-0.3, 0.51, 0, 0.15, 0.38, 0.19, crowd ? skin : PAINT.steel);
  part(0.3, 0.51, 0, 0.15, 0.38, 0.19, crowd ? skin : PAINT.steel);
  part(0, 0.9, 0, 0.34, 0.34, 0.33, crowd || cowboy ? skin : PAINT.steel);
  if (cowboy) {
    part(0, 1.06, 0, 0.58, 0.07, 0.5, PAINT.timber);
    part(0, 1.17, 0, 0.34, 0.2, 0.32, PAINT.timber);
  } else if (!crowd) {
    part(0, 0.93, 0.18, 0.27, 0.045, 0.02, PAINT.dark);
    part(0, 1.17, 0, 0.09, 0.24, 0.26, colour);
    part(-0.33, 0.5, 0.18, 0.32, 0.42, 0.09, colour);
    part(-0.33, 0.5, 0.24, 0.06, 0.3, 0.025, PAINT.brass);
    part(0.32, 0.9, 0.12, 0.065, 0.67, 0.055, PAINT.light);
  }
}
function tent(b, g, x, z, colour) {
  b.box(g, x, 0.5, z, 2.5, 1, 2.4, colour);
  b.part(g, "cone", x, 1.65, z, 3.5, 1.4, 3.5, colour, 0, Math.PI / 4);
  b.box(g, x, 0.55, z + 1.22, 0.75, 1.1, 0.05, PAINT.dark);
  banner(b, g, x + 1.5, 0, z, colour, 0.7);
}
function wagon(b, g, x, z, frontier = false) {
  b.box(g, x, 0.68, z, 1.5, 0.3, 2.8, PAINT.timber);
  for (const dx of [-0.82, 0.82])
    for (const dz of [-0.85, 0.85]) {
      b.part(
        g,
        "round",
        x + dx,
        0.44,
        z + dz,
        0.72,
        0.18,
        0.72,
        PAINT.dark,
        0,
        0,
        Math.PI / 2,
      );
      b.part(
        g,
        "round",
        x + dx * 1.12,
        0.44,
        z + dz,
        0.22,
        0.2,
        0.22,
        PAINT.brass,
        0,
        0,
        Math.PI / 2,
      );
    }
  if (frontier) {
    b.part(g, "round", x, 1.45, z, 1.7, 2.4, 1.6, PAINT.light, Math.PI / 2);
    b.box(g, x, 1.2, z + 1.23, 1, 0.9, 0.06, PAINT.dark);
  } else {
    b.box(g, x, 1.2, z, 0.18, 2, 0.18, PAINT.timber, 0, -0.6);
    b.box(g, x - 0.48, 1.7, z, 1.2, 0.15, 0.9, PAINT.timber);
  }
}
function turret(b, g, x, z, h, colour) {
  b.part(g, "round", x, h / 2, z, 3.2, h, 3.2, PAINT.stone);
  b.part(g, "round", x, h - 0.15, z, 3.65, 0.45, 3.65, PAINT.light);
  for (let j = 0; j < 8; j++) {
    const a = (j * Math.PI) / 4;
    b.box(
      g,
      x + Math.cos(a) * 1.5,
      h + 0.2,
      z + Math.sin(a) * 1.5,
      0.68,
      0.75,
      0.65,
      PAINT.light,
      -a,
    );
  }
  b.box(g, x, h * 0.65, z + 1.63, 0.3, 0.8, 0.05, PAINT.dark);
  banner(b, g, x, h + 0.4, z, colour, 0.85);
}
function castle(b, g) {
  turret(b, g, -10, -7.5, 5, PAINT.red);
  turret(b, g, 10, -7.5, 5, PAINT.blue);
  for (const s of [-1, 1]) {
    b.box(g, s * 6, 1.65, -7.5, 6, 3.3, 1.2, PAINT.stone);
    for (let j = 0; j < 6; j++)
      b.box(g, s * (3.4 + j), 3.5, -7.5, 0.6, 0.75, 1.25, PAINT.light);
    for (let j = 0; j < 6; j++)
      for (let k = 0; k < 3; k++)
        b.box(
          g,
          s * (3.3 + j),
          0.5 + k * 0.85,
          -6.87,
          0.7,
          0.06,
          0.02,
          0x90978b,
        );
  }
  // A real opening between gate piers; the lattice is visible through it.
  for (const s of [-1, 1]) b.box(g, s * 2.3, 2, -7.4, 1.3, 4, 2, PAINT.light);
  b.box(g, 0, 4, -7.4, 5.9, 1.15, 2, PAINT.stone);
  for (let i = -3; i <= 3; i++)
    b.box(g, i * 0.43, 1.8, -7, 0.095, 3.5, 0.12, PAINT.timber);
  for (let i = 0; i < 3; i++)
    b.box(g, 0, 0.8 + i, -6.95, 3.1, 0.1, 0.15, PAINT.timber);
  b.box(g, 0, 3.4, -10.3, 6, 6.8, 3.7, PAINT.light);
  b.part(g, "cone", 0, 8, -10.3, 8.4, 3, 6.4, PAINT.red, 0, Math.PI / 4);
  for (const s of [-1, 1]) {
    b.box(g, s * 2, 5, -8.41, 0.5, 1.4, 0.06, PAINT.dark);
    turret(b, g, s * 4, -10, 6.4, s < 0 ? PAINT.red : PAINT.blue);
    b.box(g, s * 20.8, 1.2, -8, 18.6, 2.4, 1.05, PAINT.stone);
    for (let j = 0; j < 18; j++)
      b.box(g, s * (12 + j), 2.6, -8, 0.55, 0.65, 1.1, PAINT.light);
    turret(b, g, s * 30.5, -8, 3.6, s < 0 ? PAINT.red : PAINT.blue);
  }
}
function chapel(b, g, r) {
  for (const s of [-1, 1]) {
    b.box(g, s * 4, 2.3, -6.6, 1.3, 4.6, 1.3, PAINT.stone);
    for (let j = 0; j < 4; j++)
      b.box(
        g,
        s * (3.5 - j * 0.85),
        4.8 + j * 0.62,
        -6.6,
        1.3,
        0.8,
        1.25,
        PAINT.stone,
        0,
        s * 0.53,
      );
    b.box(g, s * 6, 1, -7.5, 3, 2, 1, 0x71866c);
    for (let j = 0; j < 6; j++)
      b.part(
        g,
        "rock",
        s * (2.8 + r() * 6),
        0.3,
        -5 - r() * 4,
        1.2,
        0.8,
        1.4,
        PAINT.stone,
        0,
        r() * 4,
      );
  }
  b.box(g, 0, 0.2, -6.5, 7, 0.4, 4, 0x7f8b72);
  for (let j = 0; j < 14; j++)
    b.box(
      g,
      -4.5 + r() * 9,
      0.05,
      -5 + r() * 6,
      0.7,
      0.11,
      0.8,
      PAINT.stone,
      r() * 3,
    );
  for (let j = 0; j < 12; j++) {
    const x = (j < 6 ? -1 : 1) * (5 + r() * 3),
      z = -4 + r() * 5;
    b.part(g, "rock", x, 0.7, z, 0.32, 0.6, 0.3, 0xa1c19a);
  }
}
function canyon(b, g, r) {
  for (const s of [-1, 1])
    for (let j = 0; j < 5; j++) {
      const x = s * (30 + r() * 5),
        z = -10 + j * 3.3,
        h = 3 + r() * 4;
      b.box(g, x, h / 2, z, 4.5, h, 4, 0xa96d52, r() * 0.3);
      b.box(g, x, h * 0.9, z, 3.6, 0.35, 3.9, 0xd19a76);
      b.box(g, x, h * 0.5, z, 4.6, 0.22, 4.05, 0x80573f);
    }
  for (let j = -6; j <= 6; j++)
    b.box(g, j * 0.55, 1.15, -8, 0.4, 2.3, 0.4, PAINT.timber);
  b.box(g, 0, 3.3, -8, 5.6, 1, 2.5, 0xbf9567);
  banner(b, g, -2.5, 3.7, -8, PAINT.blue, 0.8);
  wagon(b, g, -15, 9.5, true);
  wagon(b, g, 15, 9.5, true);
}

function flankScenery(b, g, fieldId, r) {
  for (const side of [-1, 1]) {
    const x = side * 34;
    if (fieldId === "chapel") {
      for (let j = 0; j < 5; j++) {
        b.box(
          g,
          side * (20 + j * 2.3),
          1.1 + (j % 2) * 0.4,
          -9.2,
          0.9,
          2.2 + (j % 2) * 0.8,
          0.8,
          PAINT.stone,
          r() * 0.35,
        );
        b.part(
          g,
          "rock",
          side * (20 + j * 2.3),
          0.25,
          -6.5,
          1.4,
          0.6,
          1.2,
          0x71866c,
        );
      }
    } else if (fieldId === "camelot") {
      for (let j = 0; j < 3; j++) {
        const z = -4 + j * 3.2;
        b.box(g, x, 1, z, 2.6, 2, 2.1, j % 2 ? 0xcfb997 : 0xb1ad94);
        b.part(
          g,
          "cone",
          x,
          2.7,
          z,
          3.9,
          1.6,
          3.2,
          side < 0 ? PAINT.red : PAINT.blue,
          0,
          Math.PI / 4,
        );
        b.box(g, x, 0.7, z + 1.07, 0.5, 1.4, 0.05, PAINT.timber);
        b.box(g, x + side * 0.7, 1.35, z + 1.09, 0.38, 0.55, 0.04, PAINT.dark);
      }
    }
    tent(b, g, side * 25, 10.4, side < 0 ? PAINT.red : PAINT.blue);
    tent(b, g, side * 35, 5.5, side < 0 ? PAINT.red : PAINT.blue);
    for (let j = 0; j < 8; j++) {
      b.box(g, side * (12 + j * 2.5), 0.45, 10, 0.12, 0.9, 0.12, PAINT.timber);
      if (j < 7)
        b.box(
          g,
          side * (13.25 + j * 2.5),
          0.6,
          10,
          2.5,
          0.1,
          0.1,
          PAINT.timber,
        );
    }
    for (let j = 0; j < 8; j++) {
      const bx = side * (12 + r() * 19),
        z = 10.7 + r();
      b.box(
        g,
        bx,
        0.28,
        z,
        0.8,
        0.55,
        0.65,
        j % 2 ? 0xa58e5d : PAINT.timber,
        r(),
      );
    }
    wagon(b, g, side * 12, 11.2, fieldId === "frontier");
    banner(b, g, side * 23, 0, 3.4, side < 0 ? PAINT.red : PAINT.blue);
    banner(b, g, side * 23, 0, -2.5, 0x615980);
  }
}

function makeSpecialHero(b, id, gear = "sword") {
  const g = new THREE.Group(),
    wizard = id === "merlin";
  const cloth = wizard ? 0x58678f : 0x527557,
    gold = PAINT.brass,
    steel = PAINT.steel;
  b.mesh(g, "round", 0, 0.07, 0, 1.3, 0.14, 1.2, PAINT.dark, 0.2);
  b.mesh(g, "round", 0, 0.14, 0, 1.25, 0.06, 1.16, gold, 0.4);
  for (const side of [-1, 1]) {
    b.mesh(g, "box", side * 0.23, 0.32, 0.1, 0.33, 0.3, 0.5, PAINT.dark, 0.1);
    b.mesh(
      g,
      "round",
      side * 0.23,
      0.59,
      0,
      0.32,
      0.4,
      0.34,
      wizard ? cloth : steel,
      0.35,
    );
  }
  if (wizard) {
    b.mesh(g, "cone", 0, 0.91, 0, 1.1, 1.3, 0.8, cloth);
    b.mesh(g, "box", 0, 1.3, 0.33, 0.16, 0.7, 0.06, gold, 0.25);
  } else {
    b.mesh(g, "box", 0, 1.13, 0, 0.77, 0.8, 0.57, steel, 0.5);
    b.mesh(g, "box", 0, 1.15, 0.32, 0.5, 0.68, 0.07, cloth);
    b.mesh(g, "box", 0, 0.87, 0, 0.84, 0.12, 0.63, PAINT.timber);
    b.mesh(g, "box", 0, 0.88, 0.34, 0.17, 0.15, 0.07, gold, 0.4);
    b.mesh(g, "box", 0, 1.2, -0.36, 0.82, 0.85, 0.07, cloth).rotation.x = 0.13;
  }
  for (const side of [-1, 1]) {
    b.mesh(
      g,
      "rock",
      side * 0.53,
      1.38,
      0,
      0.48,
      0.4,
      0.58,
      wizard ? cloth : steel,
      0.4,
    );
    b.mesh(
      g,
      "round",
      side * 0.56,
      1.03,
      0.06,
      0.27,
      0.56,
      0.3,
      wizard ? cloth : steel,
      0.35,
    ).rotation.z = side * 0.13;
    b.mesh(
      g,
      "rock",
      side * 0.59,
      0.81,
      0.09,
      0.3,
      0.28,
      0.33,
      wizard ? 0xbf8569 : steel,
      0.3,
    );
    b.mesh(g, "round", side * 0.57, 0.94, 0.06, 0.3, 0.08, 0.33, gold, 0.3);
  }
  b.mesh(g, "round", 0, 1.63, 0, 0.42, 0.18, 0.4, PAINT.dark);
  b.mesh(
    g,
    "round",
    0,
    1.9,
    0,
    0.69,
    0.62,
    0.65,
    wizard ? 0xd7b78f : steel,
    wizard ? 0 : 0.45,
  );
  if (wizard) {
    b.mesh(g, "round", 0, 2.2, 0, 1.05, 0.09, 0.95, cloth);
    const hat = b.mesh(g, "cone", 0.02, 2.58, -0.03, 0.84, 0.8, 0.8, cloth);
    hat.rotation.z = -0.09;
    b.mesh(g, "round", 0, 2.29, 0, 0.81, 0.09, 0.78, gold, 0.3);
    b.mesh(g, "rock", 0.05, 2.48, 0.31, 0.17, 0.2, 0.06, PAINT.light, 0.2);
    b.mesh(g, "cone", 0, 1.56, 0.29, 0.46, 0.65, 0.21, PAINT.light).rotation.z =
      Math.PI;
    b.mesh(g, "rock", 0, 1.88, 0.34, 0.14, 0.15, 0.13, 0xd7b78f);
    for (const side of [-1, 1])
      b.mesh(g, "box", side * 0.15, 1.98, 0.31, 0.07, 0.06, 0.04, PAINT.dark);
    b.mesh(g, "round", 0.7, 1.29, 0.14, 0.09, 2.25, 0.09, PAINT.timber);
    b.mesh(g, "round", 0.7, 2.31, 0.14, 0.23, 0.13, 0.23, gold, 0.4);
    b.mesh(g, "rock", 0.7, 2.54, 0.14, 0.32, 0.39, 0.3, 0x99c7d7, 0.2);
  } else {
    b.mesh(g, "box", 0, 1.99, 0.33, 0.5, 0.065, 0.04, PAINT.dark);
    b.mesh(g, "box", 0, 1.87, 0.34, 0.065, 0.27, 0.05, gold, 0.4);
    for (const side of [-1, 1])
      for (let j = 0; j < 3; j++)
        b.mesh(
          g,
          "box",
          side * (0.12 + j * 0.055),
          1.76,
          0.33,
          0.025,
          0.065,
          0.035,
          PAINT.dark,
        );
    b.mesh(g, "rock", 0, 2.38, -0.07, 0.18, 0.43, 0.5, gold, 0.3);
    b.mesh(g, "box", -0.66, 1.04, 0.32, 0.64, 0.77, 0.14, gold, 0.3);
    b.mesh(g, "box", -0.66, 1.05, 0.41, 0.53, 0.64, 0.06, cloth);
    b.mesh(g, "rock", -0.66, 1.1, 0.47, 0.27, 0.27, 0.1, gold, 0.4);
    for (let j = 0; j < 8; j++)
      b.mesh(
        g,
        "box",
        -0.66 + Math.sin((j * Math.PI) / 4) * 0.2,
        1.1 + Math.cos((j * Math.PI) / 4) * 0.2,
        0.46,
        0.045,
        0.045,
        0.06,
        gold,
      );
    if (gear === "lance") {
      b.mesh(g, "round", 0.67, 1.7, 0.14, 0.085, 3.05, 0.085, PAINT.timber);
      b.mesh(g, "round", 0.67, 0.94, 0.14, 0.16, 0.14, 0.16, gold, 0.4);
      b.mesh(g, "cone", 0.67, 3.38, 0.14, 0.22, 0.4, 0.18, PAINT.light, 0.5);
      b.mesh(g, "box", 0.9, 2.96, 0.14, 0.43, 0.29, 0.04, cloth);
      b.mesh(g, "rock", 0.91, 2.96, 0.18, 0.13, 0.13, 0.03, gold);
    } else {
      b.mesh(g, "box", 0.63, 1.5, 0.14, 0.12, 1.25, 0.07, PAINT.light, 0.5);
      b.mesh(g, "box", 0.63, 0.94, 0.14, 0.5, 0.09, 0.15, gold, 0.4);
      b.mesh(g, "round", 0.63, 0.78, 0.14, 0.1, 0.26, 0.1, PAINT.timber);
    }
  }
  return g;
}
function makeBoss(b, fieldId) {
  const boss = new THREE.Group(),
    arm = new THREE.Group();
  boss.add(arm);
  arm.position.set(1.3, 2.5, 0);
  if (fieldId === "chapel") {
    const green = 0x3b6d4c;
    for (const s of [-1, 1])
      b.mesh(boss, "box", s * 0.52, 0.75, 0, 0.65, 1.5, 0.8, green, 0.3);
    b.mesh(boss, "box", 0, 2.1, 0, 1.85, 1.7, 1, green, 0.3);
    b.mesh(boss, "box", 0, 3.1, 0, 0.55, 0.3, 0.5, PAINT.dark);
    // The crowned helmet is carried in the left gauntlet, honoring the beheading tale without gore.
    b.mesh(boss, "box", -1.3, 2.2, 0, 0.5, 1.5, 0.6, green, 0.3);
    b.mesh(boss, "box", -1.4, 1.7, 0.25, 0.95, 0.9, 0.85, green, 0.4);
    b.mesh(boss, "box", -1.4, 1.75, 0.7, 0.65, 0.09, 0.05, PAINT.dark);
    for (const x of [-1.7, -1.4, -1.1])
      b.mesh(boss, "cone", x, 2.3, 0.25, 0.2, 0.45, 0.2, PAINT.brass);
    b.mesh(arm, "box", 0, -0.15, 0, 0.5, 1.5, 0.6, green, 0.3);
    b.mesh(arm, "box", 0.3, 0.1, 0.1, 0.12, 3.5, 0.12, PAINT.timber);
    b.mesh(
      arm,
      "box",
      0.68,
      1.4,
      0.1,
      1.1,
      0.95,
      0.22,
      PAINT.steel,
      0.4,
    ).rotation.z = -0.3;
    for (let j = 0; j < 8; j++)
      b.mesh(
        boss,
        "rock",
        Math.sin(j * 2) * 0.85,
        1.5 + j * 0.18,
        0.55,
        0.4,
        0.18,
        0.1,
        0x86a56c,
      );
  } else {
    for (const s of [-1, 1]) {
      b.mesh(boss, "box", s * 0.8, 0.7, 0, 1, 1.4, 1.25, 0x465458);
      b.mesh(boss, "box", s * 1.7, 2.15, 0, 0.95, 2, 1, 0x526970);
      b.mesh(boss, "rock", s * 1.5, 3.1, 0, 1.6, 1.2, 1.6, 0x7a847a);
    }
    b.mesh(boss, "box", 0, 2.3, 0, 2.55, 2.1, 1.4, 0x5d706d);
    b.mesh(boss, "box", 0, 3.95, 0, 1.4, 1.15, 1.2, PAINT.stone);
    for (const s of [-1, 1])
      b.mesh(boss, "box", s * 0.35, 4.07, 0.62, 0.35, 0.15, 0.06, 0xd8b168);
    b.mesh(boss, "rock", 0, 2.5, 0.77, 0.8, 0.95, 0.15, PAINT.brass, 0.6);
    for (const s of [-1, 1])
      b.mesh(boss, "box", s * 0.6, 2.2, 0.74, 0.1, 1.2, 0.04, PAINT.dark);
    b.mesh(boss, "box", 0, 3.7, 0.63, 0.8, 0.09, 0.04, PAINT.dark);
  }
  boss.userData.arm = arm;
  return boss;
}

export class BattlefieldScene {
  constructor(
    container,
    { onError = () => {}, onLabels = () => {}, reducedMotion = false } = {},
  ) {
    this.container = container;
    this.onError = onError;
    this.onLabels = onLabels;
    this.reducedMotion = reducedMotion;
    this.cache = new Map();
    this.token = 0;
    this.frame = 0;
    this.until = 0;
    this.pixel = true;
    this.view = "whole";
    this.heroes = new Map();
    this.selected = "arthur";
    this.basePositions = new Map();
    try {
      this.renderer = new THREE.WebGLRenderer({
        antialias: false,
        preserveDrawingBuffer: true,
        powerPreference: "low-power",
      });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.NoToneMapping;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      const canvas = this.renderer.domElement;
      canvas.setAttribute("role", "img");
      canvas.setAttribute(
        "aria-label",
        "Wide Tiny Castle battlefield with heroes, armies, scenery and a boss. Drag to orbit; right-drag to pan. Pinch to zoom and use two fingers to pan on a phone.",
      );
      canvas.tabIndex = 0;
      canvas.addEventListener("webglcontextlost", (e) => {
        e.preventDefault();
        this.fail();
      });
      container.prepend(canvas);
      this.pipeline = new PixelRenderer(this.renderer);
      this.pipeline.configure({ exposure: 0.6 });
      this.scene = new THREE.Scene();
      this.camera = new THREE.OrthographicCamera(-50, 50, 20, -20, 0.1, 240);
      this.controls = new OrbitControls(this.camera, canvas);
      this.controls.enablePan = true;
      this.controls.minZoom = 0.65;
      this.controls.maxZoom = 5;
      this.controls.minPolarAngle = 0.42;
      this.controls.maxPolarAngle = 1.28;
      this.controls.addEventListener("change", () => {
        this.fitCamera();
        this.draw();
      });
      this.hemi = new THREE.HemisphereLight(0xe8f0e1, 0x344243, 1.8);
      this.scene.add(this.hemi);
      this.sun = new THREE.DirectionalLight(0xffe9c5, 2.3);
      this.sun.position.set(-30, 55, 32);
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(2048, 2048);
      Object.assign(this.sun.shadow.camera, {
        left: -55,
        right: 55,
        top: 36,
        bottom: -36,
        near: 1,
        far: 170,
      });
      this.sun.shadow.bias = -0.0005;
      this.sun.shadow.normalBias = 0.035;
      this.scene.add(this.sun);
      const studio = new RoomEnvironment(),
        pmrem = new THREE.PMREMGenerator(this.renderer);
      this.environment = pmrem.fromScene(studio, 0.04);
      this.scene.environment = this.environment.texture;
      studio.dispose();
      pmrem.dispose();
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(container);
      this.visibility = () => {
        if (document.hidden) this.stop();
        else this.draw();
      };
      document.addEventListener("visibilitychange", this.visibility);
      this.reset();
      this.resize();
    } catch {
      this.fail();
    }
  }
  fail() {
    this.failed = true;
    this.stop();
    this.renderer?.domElement.remove();
    this.onError();
  }
  stop() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.until = 0;
  }
  resize() {
    if (this.failed) return;
    const { width, height } = this.container.getBoundingClientRect();
    this.fitCamera();
    this.renderer.setSize(width, height, false);
    this.pipeline.setSize(width, height);
    this.draw();
  }
  fitCamera() {
    if (this.failed || !this.camera) return;
    const { width, height } = this.container.getBoundingClientRect();
    const aspect = width / Math.max(1, height);
    this.camera.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(
      this.camera.matrixWorld,
      0,
    );
    const up = new THREE.Vector3().setFromMatrixColumn(
      this.camera.matrixWorld,
      1,
    );
    let horizontal = 0,
      vertical = 0;
    // Fit the expanded octagonal ground and its buildings in any orbit orientation.
    // Only orientation enters this calculation, so fitting does not fight user panning.
    for (let i = 0; i < 8; i++)
      for (const y of [-2, 9.5]) {
        const angle = (i * Math.PI) / 4;
        const p = new THREE.Vector3(
          (Math.sin(angle) * FIELD_WIDTH) / 2,
          y - 1,
          (Math.cos(angle) * FIELD_DEPTH) / 2 + 0.2,
        );
        horizontal = Math.max(horizontal, Math.abs(p.dot(right)));
        vertical = Math.max(vertical, Math.abs(p.dot(up)));
      }
    const half = Math.max(vertical + 1.5, (horizontal + 2) / aspect) * 1.08;
    Object.assign(this.camera, {
      left: -half * aspect,
      right: half * aspect,
      top: half,
      bottom: -half,
    });
    this.camera.updateProjectionMatrix();
  }
  reset(view = this.view) {
    if (this.failed) return;
    this.view = view;
    this.camera.zoom = view === "close" ? 2.7 : 1;
    this.controls.target.set(0, 1, -0.2);
    this.camera.position.set(20, 48, 78);
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.fitCamera();
    this.draw();
  }
  turn(direction) {
    if (this.failed) return;
    const delta = this.camera.position
      .clone()
      .sub(this.controls.target)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), (direction * Math.PI) / 2);
    this.camera.position.copy(this.controls.target).add(delta);
    this.controls.update();
    this.draw();
  }
  finish(pixel) {
    if (this.failed) return;
    this.pixel = pixel;
    this.pipeline.configure({
      pixelMode: pixel,
      pixelSize: 2,
      outlines: true,
      dither: true,
    });
    this.renderer.domElement.style.imageRendering = pixel
      ? "pixelated"
      : "auto";
    this.draw();
  }
  lighting(dusk = false) {
    if (this.failed) return;
    this.dusk = dusk;
    const forest = this.fieldId === "chapel";
    this.scene.background = new THREE.Color(
      dusk ? 0x424959 : forest ? 0x718b7c : 0x8faeb7,
    );
    this.sun.intensity = dusk ? 0.75 : forest ? 1.7 : 2.3;
    this.sun.color.set(dusk ? 0xd59e8c : 0xffe9c5);
    this.hemi.intensity = dusk ? 1.1 : 1.8;
    this.draw();
  }
  async loadModel(id) {
    if (!this.cache.has(id))
      this.cache.set(
        id,
        new GLTFLoader()
          .loadAsync(assetUrl(`assets/models/${id}.glb`))
          .then((g) => g.scene)
          .catch((e) => {
            this.cache.delete(id);
            throw e;
          }),
      );
    const model = (await this.cache.get(id)).clone(true);
    model.traverse((o) => {
      if (o.isMesh) o.castShadow = o.receiveShadow = true;
    });
    const bounds = new THREE.Box3().setFromObject(model),
      size = bounds.getSize(new THREE.Vector3());
    const wrap = new THREE.Group(),
      scale = 2.1 / size.y;
    model.scale.multiplyScalar(scale);
    const actual = new THREE.Box3().setFromObject(model),
      center = actual.getCenter(new THREE.Vector3());
    model.position.add(new THREE.Vector3(-center.x, -actual.min.y, -center.z));
    wrap.add(model);
    return wrap;
  }
  async show(fieldId, heroId) {
    if (this.failed) return;
    const token = ++this.token;
    this.stop();
    if (this.root) {
      this.scene.remove(this.root);
      this.builder.dispose(this.root);
    }
    this.fieldId = fieldId;
    this.heroes.clear();
    this.basePositions.clear();
    this.boss = null;
    this.modelFallback = false;
    const field = fieldById(fieldId),
      r = randomFrom(field.seed),
      frontier = fieldId === "frontier",
      forest = fieldId === "chapel";
    const root = (this.root = new THREE.Group()),
      b = (this.builder = new Builder());
    this.scene.add(root);
    const scenery = new THREE.Group(),
      allies = (this.allies = new THREE.Group()),
      foes = (this.foes = new THREE.Group());
    root.add(scenery, allies, foes);
    const shape = new THREE.CylinderGeometry(18, 17, 1.8, 8);
    b.owned.add(shape);
    const baseMat = new THREE.MeshStandardMaterial({
      color: frontier ? 0x80583f : 0x6a6250,
      roughness: 1,
    });
    b.materials.add(baseMat);
    const island = new THREE.Mesh(shape, baseMat);
    island.scale.set(2.5, 1, 0.86);
    island.position.y = -1;
    island.receiveShadow = true;
    root.add(island);
    const topGeo = new THREE.CylinderGeometry(18.05, 18.05, 0.22, 8);
    b.owned.add(topGeo);
    const topMat = new THREE.MeshStandardMaterial({
      color: frontier ? 0xb98b65 : forest ? 0x4c704d : 0x6e8b55,
      roughness: 1,
    });
    b.materials.add(topMat);
    const ground = new THREE.Mesh(topGeo, topMat);
    ground.scale.set(2.5, 1, 0.86);
    ground.position.y = -0.06;
    ground.receiveShadow = true;
    root.add(ground);
    // Broken earth, worn paving and small vegetation, all from the scenery seed.
    for (let j = 0; j < 820; j++) {
      const x = (r() - 0.5) * 86,
        z = (r() - 0.5) * 28;
      if (!insideField(x, z)) continue;
      const colour = frontier
        ? [0xc79972, 0xa27453, 0xb98b65][j % 3]
        : [0x829761, 0x6c8651, 0x567b4d][j % 3];
      b.box(
        scenery,
        x,
        0.066,
        z,
        0.15 + r() * 0.65,
        0.025,
        0.12 + r() * 0.7,
        colour,
        r() * 4,
      );
    }
    for (let j = 0; j < 58; j++) {
      const z = -7 + j * 0.3,
        x = (r() - 0.5) * 3.5;
      b.box(
        scenery,
        x,
        0.085,
        z,
        0.4 + r() * 0.8,
        0.07,
        0.45,
        frontier ? 0xd3b18a : 0xb2b39a,
        r() * 0.4,
      );
    }
    if (fieldId === "camelot") castle(b, scenery);
    else if (forest) chapel(b, scenery, r);
    else canyon(b, scenery, r);
    flankScenery(b, scenery, fieldId, r);
    for (let j = 0; j < 130; j++) {
      const x = -36 + j * 0.55;
      b.box(
        scenery,
        x,
        0.075,
        0.5 + (r() - 0.5) * 1.5,
        0.45 + r() * 0.45,
        0.05,
        0.35 + r() * 0.4,
        frontier ? 0xcaa37a : 0xa5aa89,
        r() * 0.3,
      );
    }
    if (!frontier) {
      for (let j = 0; j < (forest ? 95 : 60); j++) {
        const x = (r() - 0.5) * 83;
        let z = (r() - 0.5) * 27;
        if (Math.abs(x) < 33 && z > -9 && z < 9)
          z = (z < 0 ? -1 : 1) * (10.8 + r() * 2);
        if (insideField(x, z, 2.5) && !(Math.abs(x) < 11 && Math.abs(z) > 8))
          tree(b, scenery, x, z, r, j % 3 === 0 ? "pine" : "oak");
      }
      // A narrow stream and a plank bridge along the western edge.
      for (let j = 0; j < 18; j++) {
        const z = -8 + j;
        b.box(
          scenery,
          -32 + Math.sin(j * 0.4) * 0.4,
          0.09,
          z,
          1.8,
          0.06,
          1.15,
          0x648f9f,
        );
        b.box(
          scenery,
          -32.4 + r() * 0.7,
          0.13,
          z + r() * 0.4,
          0.6,
          0.025,
          0.08,
          0xb8c8be,
        );
      }
      for (let j = 0; j < 8; j++)
        b.box(
          scenery,
          -33.1 + j * 0.31,
          0.33,
          1,
          0.27,
          0.13,
          1.6,
          PAINT.timber,
        );
    }
    tent(b, scenery, -9.5, 10.4, PAINT.red);
    tent(b, scenery, 9.5, 10.4, PAINT.blue);
    if (!frontier) wagon(b, scenery, -14, 2);
    for (let j = 0; j < 32; j++) {
      const x = (j % 2 ? -1 : 1) * (12 + r() * 18),
        z = -4 + r() * 13;
      b.part(scenery, "round", x, 0.35, z, 0.65, 0.65, 0.65, PAINT.timber);
      b.part(scenery, "round", x, 0.65, z, 0.68, 0.08, 0.68, PAINT.dark);
    }
    for (const s of [-1, 1])
      for (let j = 0; j < 5; j++) {
        b.box(scenery, s * 8.5, 0.5, -4 + j * 1.5, 0.12, 1, 0.12, PAINT.timber);
        if (j < 4)
          b.box(
            scenery,
            s * 8.5,
            0.6,
            -3.25 + j * 1.5,
            0.09,
            0.1,
            1.5,
            PAINT.timber,
          );
      }
    for (const [x, z, c] of [
      [-4.7, 4.5, PAINT.red],
      [5.4, 3.8, PAINT.blue],
      [-6, -3, 0x615980],
      [6.5, -4, 0x615980],
    ])
      banner(b, scenery, x, 0, z, c);
    for (const company of [-23, 0, 23])
      for (let row = 0; row < 3; row++)
        for (let col = 0; col < 10; col++) {
          person(
            b,
            allies,
            company - 5.5 + col * 1.22,
            0.1,
            5.1 + row * 1.1,
            col < 5 ? PAINT.red : PAINT.blue,
            r,
            frontier && col % 3 === 0,
          );
          person(
            b,
            foes,
            company - 5.5 + col * 1.22,
            0.1,
            -3.6 - row * 0.92,
            forest ? 0x4d6650 : 0x665d75,
            r,
          );
        }
    // Citizens watch from low side bleachers, leaving the center clear at all quarter turns.
    for (const s of [-1, 1])
      for (let row = 0; row < 3; row++) {
        b.box(
          scenery,
          s * (36.5 + row * 0.63),
          0.17 + row * 0.3,
          0,
          0.7,
          0.2 + row * 0.6,
          6,
          PAINT.timber,
        );
        for (let j = 0; j < 10; j++)
          person(
            b,
            scenery,
            s * (36.5 + row * 0.63),
            0.3 + row * 0.6,
            -2.5 + j * 0.53,
            [PAINT.red, PAINT.blue, 0x927b53, 0x71886c, 0x8c788d][
              Math.floor(r() * 5)
            ],
            r,
            false,
            true,
          );
      }
    for (let j = 0; j < 95; j++) {
      const x = (r() - 0.5) * 84,
        z = (r() - 0.5) * 25;
      if (Math.abs(x) < 10 || !insideField(x, z, 2)) continue;
      b.box(scenery, x, 0.18, z, 0.05, 0.3, 0.05, 0x789355);
      b.part(
        scenery,
        "rock",
        x,
        0.36,
        z,
        0.2,
        0.15,
        0.2,
        forest ? 0xb1b2ce : PAINT.light,
      );
    }
    b.flush();
    this.effects = new THREE.Group();
    root.add(this.effects);
    this.effects.visible = false;
    this.particles = Array.from({ length: 32 }, (_, j) =>
      b.mesh(
        this.effects,
        "box",
        0,
        0,
        0,
        0.1,
        0.1,
        0.1,
        j % 2 ? PAINT.brass : PAINT.light,
      ),
    );
    const ringGeo = new THREE.TorusGeometry(1.2, 0.045, 4, 32);
    b.owned.add(ringGeo);
    const ringMat = new THREE.MeshBasicMaterial({ color: PAINT.brass });
    b.materials.add(ringMat);
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.rotation.x = Math.PI / 2;
    this.ring.position.set(-2.2, 0.15, 2.5);
    root.add(this.ring);
    this.lighting(this.dusk);
    this.reset();
    this.draw();
    const places = [
      [-4.4, 3.5],
      [-0.7, 4],
      [-5.9, 6.3],
      [2.4, 4.2],
      [-6.4, 3.7],
      [5.9, 5.4],
    ];
    const tasks = HEROES.map(async (hero, index) => {
      let model;
      try {
        if (token !== this.token || this.failed) return;
        model = hero.model
          ? await this.loadModel(hero.model)
          : makeSpecialHero(b, hero.id);
      } catch {
        if (token !== this.token || this.failed) return;
        model = makeSpecialHero(b, hero.id === "merlin" ? "merlin" : "gawain");
        this.modelFallback = true;
      }
      if (token !== this.token || this.failed) return;
      model.rotation.y = 0.35;
      root.add(model);
      this.heroes.set(hero.id, model);
      this.basePositions.set(hero.id, places[index]);
    });
    const bossTask = (async () => {
      let boss;
      if (frontier) {
        try {
          boss = await this.loadModel("dragon");
          boss.scale.setScalar(2.15);
          boss.rotation.y = -0.45;
        } catch {
          if (token !== this.token || this.failed) return;
          boss = makeBoss(b, "camelot");
          this.modelFallback = true;
        }
      } else boss = makeBoss(b, fieldId);
      if (token !== this.token || this.failed) return;
      this.boss = boss;
      boss.position.set(1.8, 0.1, -0.6);
      root.add(boss);
    })();
    await Promise.all([...tasks, bossTask]);
    if (token !== this.token || this.failed) return;
    this.selectHero(heroId);
    this.renderer.domElement.dataset.field = fieldId;
    this.renderer.domElement.dataset.heroes = String(this.heroes.size);
    this.renderer.domElement.dataset.ready = "true";
    this.renderer.domElement.dataset.people = "240";
    this.draw();
  }
  selectHero(id) {
    this.selected = id;
    for (const [key, model] of this.heroes) {
      const pos = key === id ? [-2.2, 2.5] : this.basePositions.get(key);
      model.position.set(pos[0], 0.1, pos[1]);
      model.scale.setScalar(key === id ? 1.18 : 0.82);
    }
    this.draw();
  }
  react(result) {
    if (this.failed || !result) return;
    this.result = result;
    this.started = performance.now();
    this.until = this.started + (this.reducedMotion ? 0 : 1100);
    this.draw();
  }
  updateReaction(now) {
    const hero = this.heroes.get(this.selected);
    const t = Math.min(1, (now - (this.started || 0)) / 1100),
      pulse = this.until > now ? Math.sin(t * Math.PI) : 0;
    if (hero) {
      hero.position.z = 2.5 - pulse * 1.5;
      hero.rotation.z = pulse * (this.result?.outcome === "loss" ? -0.1 : 0.05);
    }
    if (this.boss) {
      this.boss.position.y = 0.1 + pulse * (this.result?.revived ? 0.7 : 0.1);
      this.boss.rotation.z = this.result?.dealt
        ? Math.sin(t * Math.PI * 8) * pulse * 0.05
        : 0;
      if (this.boss.userData.arm)
        this.boss.userData.arm.rotation.x = pulse * 0.7;
    }
    if (this.allies) {
      this.allies.position.z = -pulse * 0.7;
      this.foes.position.z = pulse * 0.4;
    }
    if (this.effects) {
      this.effects.visible = pulse > 0.01;
      this.particles.forEach((p, j) => {
        const a = j * 2.399;
        p.position.set(
          0.4 + Math.cos(a) * t * 3,
          0.5 + Math.sin(t * Math.PI) * (1.5 + (j % 4)),
          0.7 + Math.sin(a) * t * 3,
        );
        p.rotation.set(t * j, t * 4, 0);
      });
    }
  }
  draw() {
    if (this.failed || this.frame || document.hidden) return;
    this.frame = requestAnimationFrame((now) => {
      this.frame = 0;
      try {
        this.updateReaction(now);
        this.pipeline.render(this.scene, this.camera);
        const project = (object, height) => {
          if (!object) return null;
          const p = object.position
            .clone()
            .add(new THREE.Vector3(0, height, 0))
            .project(this.camera);
          const x = (p.x + 1) * 50,
            y = (1 - p.y) * 50;
          return {
            x,
            y,
            visible: x > 8 && x < 92 && y > 16 && y < 88 && p.z > -1 && p.z < 1,
          };
        };
        this.onLabels({
          hero: project(this.heroes.get(this.selected), 2.9),
          boss: project(this.boss, this.fieldId === "chapel" ? 4.2 : 5.1),
        });
        this.renderer.domElement.dataset.frame = String(
          Number(this.renderer.domElement.dataset.frame || 0) + 1,
        );
        if (now < this.until) this.draw();
      } catch {
        this.fail();
      }
    });
  }
  dispose() {
    this.token++;
    this.stop();
    this.observer?.disconnect();
    document.removeEventListener("visibilitychange", this.visibility);
    this.controls?.dispose();
    if (this.root) this.builder.dispose(this.root);
    this.cache.forEach(async (promise) => {
      try {
        (await promise).traverse((o) => {
          if (o.isMesh) {
            o.geometry.dispose();
            for (const m of Array.isArray(o.material)
              ? o.material
              : [o.material])
              m.dispose();
          }
        });
      } catch {}
    });
    this.pipeline?.dispose();
    this.environment?.dispose();
    this.renderer?.dispose();
  }
}

// Original geometry shared by the card deployment arena and portrait generator.
export {
  Builder,
  PAINT,
  randomFrom,
  tree,
  tent,
  wagon,
  turret,
  banner,
  makeSpecialHero,
  makeBoss,
};
