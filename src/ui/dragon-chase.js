// Original, code-drawn pixel miniatures. No sprite imports, audio or application state.
export const CHASE_WIDTH = 384;
export const CHASE_HEIGHT = 176;
export const CHASE_DURATION = 6800;

const C = {
  night: '#101c22', deep: '#16272b', mortar: '#233537', wall: '#2d4140', wallLight: '#3b5050',
  ground: '#354746', stone: '#53625a', stoneLight: '#6d7866', stoneDark: '#42534e',
  moss: '#425b47', leaf: '#6e895b', leafLight: '#96ab70', ink: '#192a30',
  steel: '#a9c3bd', steelLight: '#e0e3ce', steelDark: '#638b91', blue: '#355f7a', blueDark: '#294454',
  gold: '#ddba79', goldDark: '#8d6c3a', red: '#9d3e46', redLight: '#c95c51', redDark: '#693341',
  ember: '#de753f', flame: '#f0b85f', ivory: '#f6eddb', wood: '#564736',
  scale: '#253034', scaleLight: '#52615e', scaleEdge: '#849082', scaleDark: '#111a1e',
  wing: '#bc843c', wingLight: '#e1b668', wingDark: '#765331',
};

export function chasePose(milliseconds) {
  const t = ((milliseconds % CHASE_DURATION) + CHASE_DURATION) % CHASE_DURATION / 1000;
  const hop = t > 3.45 && t < 4.1 ? Math.sin((t - 3.45) / .65 * Math.PI) * 31 : 0;
  const knightX = t < 1.5 ? -28 + t / 1.5 * 199
    : t < 3.45 ? 171 + (t - 1.5) / 1.95 * 41 : 212 + (t - 3.45) / 2.15 * 248;
  const dragonX = t < 3.45 ? knightX - 105 : 107 + (t - 3.45) / 2.9 * 343;
  return { knightX, dragonX, hop, breath: t > 1.8 && t < 3.55, ember: t > 3.3 && t < 3.85,
    step: Math.floor(t * 10) % 4, beat: Math.floor(t * 12),
    phase: t < 1.8 ? 'chase' : t < 3.45 ? 'shield' : t < 4.1 ? 'hop' : 'escape' };
}

function pens(ctx) {
  const rect = (x, y, w, h, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };
  // Scanline fills keep diagonals deliberately stepped, including at small phone sizes.
  const poly = (points, color) => {
    const ys = points.map(p => p[1]);
    for (let y = Math.ceil(Math.min(...ys)); y < Math.max(...ys); y++) {
      const cuts = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) cuts.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
      cuts.sort((a, b) => a - b);
      for (let i = 0; i + 1 < cuts.length; i += 2) rect(Math.ceil(cuts[i]), y, Math.floor(cuts[i + 1]) - Math.ceil(cuts[i]) + 1, 1, color);
    }
  };
  const oval = (x, y, rx, ry, color) => {
    for (let dy = -ry; dy <= ry; dy++) {
      const dx = Math.round(rx * Math.sqrt(Math.max(0, 1 - dy * dy / (ry * ry))));
      rect(x - dx, y + dy, dx * 2 + 1, 1, color);
    }
  };
  const line = (x1, y1, x2, y2, width, color) => {
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1);
    for (let i = 0; i <= steps; i++) rect(x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps, width, width, color);
  };
  return { rect, poly, oval, line };
}

function courtyard(p) {
  const { rect, poly } = p;
  rect(0, 0, 384, 176, C.night);
  // A quiet castle wall, with the path much lighter than the distant masonry.
  rect(0, 29, 384, 82, C.mortar);
  for (let row = 0; row < 6; row++) {
    for (let col = -1; col < 16; col++) {
      const x = col * 27 + (row % 2) * 13, y = 29 + row * 14;
      rect(x, y, 25, 12, (col + row) % 3 === 0 ? C.deep : C.wall);
      rect(x + 1, y + 1, 22, 1, C.wallLight);
      if ((col + row) % 4 === 0) rect(x + 13, y + 6, 5, 1, C.mortar);
    }
  }
  // Crenellations and an old gate, not an extra UI panel.
  for (let x = 0; x < 384; x += 32) {
    rect(x, 19, 17, 10, C.wall); rect(x + 1, 19, 16, 2, C.wallLight);
  }
  poly([[295, 111], [295, 57], [304, 43], [318, 35], [332, 35], [346, 43], [355, 57], [355, 111]], C.wallLight);
  poly([[302, 111], [302, 59], [309, 49], [320, 42], [330, 42], [341, 49], [348, 59], [348, 111]], C.night);
  for (let x = 309; x < 346; x += 9) { rect(x, 57, 3, 55, C.wood); rect(x, 55, 1, 57, C.goldDark); }
  rect(304, 74, 42, 3, C.wood); rect(304, 94, 42, 3, C.wood);
  rect(0, 110, 384, 66, C.ground); rect(0, 111, 384, 3, C.ink);
  // Staggered, individually highlighted cobbles. Deterministic: no random flicker.
  for (let row = 0; row < 5; row++) {
    for (let col = -1; col < 21; col++) {
      const x = col * 20 + (row % 2) * 10, y = 116 + row * 12;
      const light = (col * 7 + row * 3) % 4 === 0;
      rect(x + 1, y + 1, 17, 9, C.stoneDark);
      rect(x + 2, y, 15, 8, light ? C.stone : C.stoneDark);
      rect(x + 3, y, 12, 1, light ? C.stoneLight : C.stone);
      rect(x + 1, y + 2, 1, 5, C.stone);
      rect(x + 15, y + 7, 3, 2, C.mortar);
    }
  }
  for (const x of [11, 31, 78, 266, 358]) { rect(x, 151, 3, 2, C.moss); rect(x + 2, 149, 2, 3, C.leaf); }
  // Ivy stays at the edges so the two characters remain the focal point.
  for (const side of [0, 1]) {
    for (let i = 0; i < 13; i++) {
      const x = side ? 374 - i % 3 * 5 : 4 + i % 3 * 5, y = 23 + i * 6;
      rect(x, y, 2, 11, C.moss);
      poly([[x, y], [x - 6, y - 3], [x - 8, y + 2], [x - 2, y + 5]], C.moss);
      poly([[x + 1, y + 4], [x + 7, y], [x + 10, y + 4], [x + 5, y + 8]], C.leaf);
      rect(x + 5, y + 3, 2, 1, C.leafLight);
    }
  }
  for (const x of [67, 273]) {
    rect(x - 3, 79, 6, 15, C.ink); rect(x - 1, 76, 2, 14, C.goldDark);
    poly([[x - 4, 76], [x - 3, 69], [x, 65], [x + 2, 70], [x + 4, 73], [x + 2, 78]], C.ember);
    rect(x - 1, 71, 2, 5, C.flame); rect(x, 73, 1, 3, C.ivory);
  }
}

function dragon(p, x, y, pose) {
  const { rect, poly, line } = p;
  const leg = [0, 5, 0, -5][pose.step], flap = [0, 2, 0, -2][pose.step];
  y += pose.step % 2;
  const shape = (points, color) => poly(points.map(([a, b]) => [x + a, y + b]), color);
  const r = (a, b, w, h, color) => rect(x + a, y + b, w, h, color);
  const stroke = (a, b, c, d, w, color) => line(x + a, y + b, x + c, y + d, w, color);
  const wing = (points, color) => shape(points.map(([a, b]) => [a, b + flap * Math.max(0, (-b - 45) / 60)]), color);

  // A long, tapering tail curls behind the hindquarters.
  shape([[-10,-29],[-26,-22],[-43,-22],[-55,-32],[-59,-48],[-56,-57],[-64,-51],[-64,-34],[-56,-22],[-41,-13],[-20,-13],[1,-21]], C.scaleDark);
  shape([[-14,-25],[-29,-19],[-44,-19],[-56,-30],[-60,-44],[-60,-33],[-53,-24],[-40,-16],[-21,-16],[-3,-22]], C.scale);
  stroke(-51,-27,-59,-41,1,C.scaleEdge);
  shape([[-59,-46],[-67,-49],[-61,-57],[-55,-60],[-57,-51]],C.wingDark);
  shape([[-62,-49],[-60,-54],[-57,-55],[-59,-49]],C.gold);

  // Four weight-bearing legs, staggered in the running gait.
  stroke(-8,-24,-17+leg,-8,7,C.scaleDark);
  r(-21+leg,-6,17,6,C.scaleDark); r(-9+leg,-4,4,3,C.steelDark);
  stroke(18,-31,27-leg,-8,5,C.scaleDark);
  r(25-leg,-6,14,6,C.scaleDark); r(35-leg,-3,3,2,C.steelDark);

  // The far wing is narrower; the near wing has three ribbed, scalloped membranes.
  wing([[7,-43],[10,-74],[22,-90],[37,-95],[28,-83],[26,-72],[20,-74],[21,-61],[14,-63],[15,-48]],C.scaleDark);
  wing([[11,-52],[14,-73],[24,-86],[31,-90],[24,-80],[23,-75],[18,-76],[18,-64]],C.wingDark);
  wing([[3,-44],[-10,-84],[-25,-98],[-46,-105],[-73,-104],[-57,-96],[-45,-85],[-55,-78],[-35,-79],[-38,-64],[-20,-66],[-21,-52],[-7,-56]],C.scaleDark);
  wing([[-1,-48],[-14,-83],[-27,-95],[-46,-101],[-63,-102],[-52,-96],[-40,-85],[-48,-81],[-31,-82],[-34,-67],[-17,-69],[-18,-57],[-8,-60]],C.wing);
  wing([[-61,-101],[-45,-99],[-28,-92],[-15,-82],[-24,-88],[-40,-91]],C.wingLight);
  wing([[-36,-83],[-17,-81],[-8,-59],[-17,-70],[-30,-70]],C.wingLight);
  wing([[-14,-82],[-2,-51],[-9,-62],[-18,-67]],C.wingDark);
  wing([[-15,-87],[-12,-85],[3,-44],[-1,-46]],C.scaleDark);
  wing([[-14,-85],[-11,-83],[-1,-47],[-3,-49]],C.scaleLight);
  wing([[-14,-85],[-40,-85],[-47,-81],[-32,-82],[-13,-82]],C.scaleDark);
  wing([[-12,-80],[-34,-68],[-34,-65],[-9,-76]],C.scaleDark);
  stroke(-68,-103+flap,-46,-103+flap,1,C.scaleEdge);

  // Low, muscular body; a plated S-shaped neck rises to the horned head.
  shape([[-24,-29],[-17,-43],[-2,-49],[13,-45],[24,-34],[24,-22],[11,-14],[-8,-14],[-21,-19]],C.scaleDark);
  shape([[-21,-29],[-14,-41],[-1,-46],[12,-42],[20,-33],[20,-23],[9,-18],[-7,-18],[-18,-22]],C.scale);
  shape([[-16,-37],[-4,-43],[7,-42],[12,-38],[-2,-39],[-13,-33]],C.scaleLight);
  shape([[7,-45],[11,-59],[18,-74],[28,-75],[35,-66],[30,-54],[27,-39],[22,-27],[12,-25],[5,-32]],C.scaleDark);
  shape([[11,-44],[15,-58],[21,-71],[28,-71],[31,-65],[27,-53],[24,-38],[20,-30],[13,-29],[9,-34]],C.scale);
  shape([[24,-65],[29,-64],[25,-50],[23,-38],[19,-28],[12,-27],[15,-38],[19,-50]],C.wingDark);
  shape([[24,-63],[27,-62],[23,-49],[22,-39],[18,-31],[15,-32],[18,-42],[21,-53]],C.gold);
  for (const [a,b,w] of [[22,-58,5],[20,-52,5],[18,-46,5],[16,-40,6],[14,-34,6]]) r(a,b,w,2,C.wingDark);
  for (const [a,b] of [[13,-62],[10,-53],[5,-46],[-5,-43],[-16,-38]]) {
    shape([[a,b],[a-7,b-7],[a-6,b+2],[a,b+4]],C.scaleDark);
    stroke(a-5,b-4,a-2,b,1,C.scaleLight);
  }

  // Thick hind thigh, bent hock and three pale claws; a separate foreleg reaches ahead.
  shape([[-17,-33],[-7,-32],[1,-24],[-3,-17],[-12,-11],[-11-leg,-6],[-3-leg,-4],[-3-leg,1],[-23-leg,1],[-24-leg,-5],[-19,-13],[-23,-22]],C.scaleDark);
  shape([[-16,-29],[-9,-29],[-3,-24],[-6,-19],[-15,-13],[-17-leg,-5],[-10-leg,-4],[-19-leg,-3],[-19,-13],[-20,-21]],C.scaleLight);
  shape([[-14,-27],[-8,-26],[-6,-23],[-12,-18],[-18,-15],[-17,-23]],C.scale);
  for (const a of [-15,-9,-3]) shape([[a-leg,-4],[a+3-leg,-1],[a-2-leg,-1]],C.ivory);
  stroke(21,-35,27+leg,-22,8,C.scaleDark);
  stroke(27+leg,-22,23+leg,-9,6,C.scaleDark);
  stroke(22,-34,28+leg,-23,4,C.scaleLight);
  stroke(28+leg,-21,25+leg,-10,2,C.scaleLight);
  shape([[23+leg,-11],[30+leg,-7],[38+leg,-5],[40+leg,0],[21+leg,0],[19+leg,-5]],C.scaleDark);
  r(23+leg,-7,10,4,C.scale);
  for (const a of [28,34,39]) shape([[a+leg,-5],[a+3+leg,-1],[a-1+leg,-1]],C.ivory);

  // Swept horns, angular brow, long muzzle, teeth and amber eye: a full dragon silhouette.
  shape([[19,-69],[17,-79],[23,-85],[34,-82],[41,-74],[49,-68],[55,-66],[58,-57],[54,-53],[42,-53],[33,-58],[27,-63]],C.scaleDark);
  shape([[22,-70],[21,-77],[25,-81],[33,-79],[39,-72],[47,-66],[54,-64],[55,-59],[51,-56],[41,-56],[33,-61],[28,-67]],C.scale);
  shape([[25,-80],[33,-77],[37,-73],[30,-73],[25,-70],[22,-72]],C.scaleLight);
  shape([[36,-70],[46,-65],[53,-64],[52,-62],[43,-64]],C.scaleLight);
  shape([[19,-77],[12,-84],[9,-98],[13,-94],[17,-86],[25,-82]],C.scaleDark);
  shape([[20,-79],[15,-85],[12,-94],[17,-87],[23,-83]],C.gold);
  shape([[30,-81],[26,-88],[28,-101],[30,-95],[30,-89],[35,-83]],C.scaleDark);
  shape([[31,-83],[28,-89],[29,-97],[31,-89],[34,-84]],C.ivory);
  shape([[22,-76],[12,-73],[18,-69],[13,-65],[27,-67]],C.scaleDark);
  stroke(17,-72,24,-73,1,C.scaleLight);
  shape([[32,-72],[39,-69],[38,-65],[32,-66]],C.gold);
  r(36,-69,2,4,C.scaleDark); r(33,-69,1,1,C.ivory);
  stroke(31,-74,40,-70,2,C.scaleDark);
  r(51,-62,3,2,C.scaleDark);
  const jaw = pose.breath ? 9 : 2;
  shape([[35,-58],[45,-57],[55,-57],[54,-50+jaw],[45,-47+jaw],[34,-53+jaw],[30,-57]],C.scaleDark);
  shape([[35,-56],[45,-55],[53,-55],[51,-50+jaw],[45,-50+jaw],[36,-54+jaw]],C.redDark);
  shape([[34,-53+jaw],[44,-48+jaw],[53,-51+jaw],[49,-46+jaw],[40,-47+jaw],[32,-53+jaw]],C.scaleLight);
  for (const a of [38,44,50]) shape([[a,-57],[a+3,-57],[a+1,-52]],C.ivory);
  if (pose.breath) shape([[43,-44],[46,-48],[47,-43]],C.ivory);
}

function knight(p, x, ground, pose) {
  const { rect, poly, line } = p;
  const y = ground - Math.round(pose.hop) - (pose.step % 2 && !pose.hop ? 1 : 0);
  const leg = pose.hop ? 7 : [0, 7, 0, -7][pose.step];
  // Running legs and boots, then the blue surcoat over silver armor.
  line(x - 4, y - 18, x - 8 - leg, y - 6, 5, C.ink);
  line(x - 3, y - 16, x - 7 - leg, y - 7, 3, C.steelDark);
  rect(x - 11 - leg, y - 5, 12, 5, C.ink); rect(x - 10 - leg, y - 5, 9, 2, C.steel);
  line(x + 4, y - 18, x + 7 + leg, y - 7, 5, C.ink);
  line(x + 5, y - 17, x + 8 + leg, y - 7, 3, C.steel);
  rect(x + 7 + leg, y - 5, 12, 5, C.ink); rect(x + 8 + leg, y - 5, 9, 2, C.steelLight);
  poly([[x - 9, y - 39], [x + 6, y - 40], [x + 11, y - 32], [x + 9, y - 18], [x - 6, y - 16], [x - 12, y - 24]], C.ink);
  poly([[x - 7, y - 36], [x + 5, y - 37], [x + 8, y - 31], [x + 6, y - 19], [x - 5, y - 19], [x - 9, y - 25]], C.blue);
  rect(x - 5, y - 35, 9, 8, C.steel); rect(x - 3, y - 35, 2, 8, C.steelLight);
  rect(x - 8, y - 25, 16, 3, C.goldDark); rect(x + 1, y - 25, 3, 3, C.gold);
  // Sword held forward, never swung at the dragon.
  line(x + 22, y - 29, x + 30, y - 51, 4, C.ink);
  line(x + 23, y - 29, x + 31, y - 51, 2, C.steelLight);
  line(x + 19, y - 32, x + 29, y - 28, 2, C.gold);
  line(x + 22, y - 28, x + 20, y - 22, 3, C.wood);
  line(x + 8, y - 34, x + 14, y - 25, 6, C.ink);
  line(x + 10, y - 32, x + 15, y - 26, 3, C.steel);
  rect(x + 15, y - 27, 7, 5, C.steelLight);
  // Helmet, visor, plume and one visible eye slit.
  rect(x - 6, y - 51, 15, 15, C.ink); rect(x - 3, y - 54, 10, 4, C.ink);
  rect(x - 4, y - 50, 12, 12, C.steel); rect(x - 1, y - 52, 8, 4, C.steelLight);
  rect(x - 4, y - 47, 3, 9, C.steelDark); rect(x + 1, y - 46, 10, 6, C.steelLight);
  rect(x + 3, y - 45, 7, 2, C.ink); rect(x + 5, y - 40, 1, 3, C.steelDark); rect(x + 8, y - 40, 1, 3, C.steelDark);
  poly([[x, y - 54], [x - 1, y - 59], [x - 10, y - 60], [x - 18, y - 56], [x - 11, y - 56], [x - 8, y - 53]], C.red);
  rect(x - 10, y - 59, 7, 2, C.redLight);
  // A broad, clearly readable shield strapped to the knight's back.
  poly([[x - 19, y - 42], [x - 8, y - 39], [x - 7, y - 20], [x - 13, y - 13], [x - 22, y - 21]], C.ink);
  poly([[x - 18, y - 40], [x - 10, y - 37], [x - 9, y - 21], [x - 13, y - 16], [x - 20, y - 22]], C.gold);
  poly([[x - 17, y - 37], [x - 12, y - 35], [x - 11, y - 22], [x - 13, y - 19], [x - 18, y - 23]], C.blueDark);
  rect(x - 16, y - 32, 2, 9, C.gold); rect(x - 18, y - 29, 6, 2, C.gold);
  if (pose.ember) {
    // A tiny ember on the clothed surcoat: comic surprise, no injury.
    poly([[x - 8, y - 18], [x - 13, y - 20], [x - 10, y - 26], [x - 9, y - 23], [x - 5, y - 25], [x - 5, y - 19]], C.ember);
    rect(x - 9, y - 22, 2, 4, C.flame);
  }
  if (pose.hop > 3) { rect(x + 15, y - 66, 3, 9, C.gold); rect(x + 15, y - 54, 3, 3, C.gold); }
}

function flame(p, pose) {
  if (!pose.breath) return;
  const { poly, rect } = p;
  const mouth = pose.dragonX + 54, shield = pose.knightX - 22, y = 107;
  const mouthY = 94 + pose.step % 2;
  const flutter = pose.beat % 2 * 2;
  poly([[mouth, mouthY - 3], [mouth + 10, mouthY - 2], [shield - 5, y - 6 - flutter], [shield + 2, y - 1], [shield - 2, y + 6], [mouth + 12, mouthY + 7], [mouth, mouthY + 2]], C.ember);
  poly([[mouth, mouthY], [mouth + 12, mouthY + 1], [shield - 1, y - 2], [shield - 4, y + 3], [mouth + 12, mouthY + 5]], C.flame);
  poly([[mouth + 1, mouthY], [mouth + 14, mouthY + 2], [mouth + 10, mouthY + 3], [mouth + 1, mouthY + 2]], C.ivory);
  // The flame visibly forks ABOVE and BELOW the shield, not through the torso.
  poly([[shield - 3, y], [shield - 1, y - 13], [shield + 7, y - 19], [shield + 18, y - 21], [shield + 12, y - 16], [shield + 5, y - 15], [shield + 2, y - 5]], C.ember);
  poly([[shield - 2, y - 4], [shield + 2, y - 13], [shield + 9, y - 17], [shield + 5, y - 12]], C.flame);
  poly([[shield - 3, y + 1], [shield, y + 16], [shield + 9, y + 25], [shield + 22, y + 28], [shield + 15, y + 22], [shield + 9, y + 21], [shield + 4, y + 12]], C.ember);
  poly([[shield, y + 6], [shield + 4, y + 16], [shield + 11, y + 23], [shield + 6, y + 20]], C.flame);
  rect(shield + 21 + flutter, y + 25, 2, 2, C.flame);
}

export function drawDragonChase(ctx, milliseconds = 1800) {
  const pose = chasePose(milliseconds), p = pens(ctx);
  ctx.imageSmoothingEnabled = false;
  courtyard(p);
  p.oval(pose.dragonX + 6, 145, 36, 3, C.mortar);
  p.oval(pose.knightX + 1, 145, 20 - Math.round(pose.hop / 5), 3, C.mortar);
  dragon(p, Math.round(pose.dragonX), 144, pose);
  flame(p, pose);
  knight(p, Math.round(pose.knightX), 144, pose);
  if (pose.phase === 'hop' || pose.phase === 'escape') {
    for (let i = 0; i < 3; i++) {
      const x = pose.knightX - 31 - i * 10, y = 139 - (pose.beat + i) % 3 * 2;
      p.rect(x, y, 4 - i, 2, C.stoneLight);
    }
  }
  return pose;
}
