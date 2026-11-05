import { memberAvatar } from '../core/avatars.js';

// One original miniature shared by the map and its rendered portrait. All dimensions
// are local to the traveler; the caller supplies the existing batched part builder.
export function addMemberModel(part, group, member, { x = 0, z = 0, size = 1, index = 0 } = {}) {
  const a = memberAvatar(member, index), ink = 0x302e36, cream = 0xeddcb4, gold = 0xddba79;
  const p = (kind, px, py, pz, w, h, d, color, ry = 0, rz = 0) =>
    part(group, kind, x + px * size, py * size, z + pz * size, w * size, h * size, d * size, color, ry, rz);
  // Boots, flared coat, shoulders, hands and a dark belt with a brass buckle.
  for (const side of [-1, 1]) {
    p('box', side * .15, .16, .08, .22, .25, .38, 0x513b35);
    p('box', side * .36, .88, .02, .2, .51, .25, a.cloth, 0, side * .08);
    p('round', side * .36, .59, .04, .16, .18, .16, a.skin);
  }
  p('cone', 0, .48, 0, .8, .66, .68, a.cloth);
  p('box', 0, .88, 0, .62, .61, .38, a.cloth);
  p('box', 0, .7, .23, .64, .1, .05, ink);
  p('box', 0, .7, .27, .13, .13, .07, gold);
  p('box', 0, .34, .22, .56, .08, .04, a.trim);
  // Face, visible ears and a readable hair silhouette.
  p('box', 0, 1.34, 0, .45, .48, .39, a.skin);
  for (const side of [-1, 1]) p('box', side * .245, 1.32, .01, .1, .14, .14, a.skin);
  p('box', 0, 1.59, -.04, .52, .17, .45, a.hair);
  p('box', 0, 1.37, -.2, .5, .42, .1, a.hair);
  for (const side of [-1, 1]) p('box', side * .12, 1.38, .21, .065, .075, .04, ink);
  p('box', 0, 1.29, .23, .08, .1, .07, a.skin);
  p('box', 0, 1.2, .21, .11, .025, .025, 0x9d635c);
  p('box', 0, 1.09, .23, .22, .12, .05, a.trim);
  if (a.kind === 'hood') {
    p('box', 0, 1.64, -.04, .66, .17, .58, a.cloth);
    for (const side of [-1, 1]) p('box', side * .28, 1.4, -.01, .12, .49, .52, a.cloth);
    p('box', -.18, 1.02, .25, .12, .1, .06, gold);
  } else if (a.kind === 'helm') {
    p('round', 0, 1.55, -.02, .63, .33, .56, a.trim);
    for (const side of [-1, 1]) p('box', side * .27, 1.35, 0, .1, .35, .5, a.trim);
    p('box', 0, 1.54, .28, .62, .08, .08, gold);
    p('box', 0, 1.79, -.04, .13, .24, .35, a.cloth);
    p('box', 0, .97, .25, .4, .4, .06, a.trim);
    p('box', 0, .97, .3, .09, .3, .03, a.cloth);
  } else if (a.kind === 'crown') {
    for (const side of [-1, 1]) {
      p('round', side * .25, 1.12, -.01, .17, .74, .18, a.hair);
      p('box', side * .25, .85, .04, .16, .07, .2, gold);
    }
    p('box', 0, 1.65, .01, .59, .12, .5, gold);
    for (const px of [-.23, 0, .23]) {
      p('box', px, 1.76, .2, .1, .17, .08, gold);
      p('rock', px, 1.83, .2, .1, .1, .1, cream);
    }
    p('rock', 0, 1.66, .29, .12, .13, .07, a.cloth);
    p('box', 0, .92, .25, .16, .28, .05, cream);
  } else if (a.kind === 'hat') {
    p('round', 0, 1.63, 0, .88, .07, .8, a.cloth);
    p('cone', 0, 1.99, -.04, .63, .72, .63, a.cloth, 0, -.13);
    p('round', 0, 1.69, -.01, .57, .1, .57, gold);
    p('rock', -.08, 2.08, .21, .13, .13, .06, cream);
    p('cone', 0, 1.07, .21, .25, .37, .13, a.hair, 0, Math.PI);
  } else if (a.kind === 'straw') {
    p('round', 0, 1.63, 0, .94, .08, .83, gold);
    p('round', 0, 1.75, -.02, .56, .2, .5, gold);
    p('round', 0, 1.68, -.02, .58, .09, .51, 0x9d3e46);
    p('box', 0, .66, .27, .35, .49, .05, cream);
    p('box', 0, .59, .31, .2, .14, .03, a.cloth);
  } else if (a.kind === 'beret') {
    p('round', -.06, 1.66, -.02, .7, .2, .59, a.cloth);
    p('box', .2, 1.88, -.03, .06, .35, .1, cream, 0, -.3);
    p('rock', .15, 1.72, .25, .12, .12, .07, gold);
    p('box', -.14, .93, .25, .12, .3, .05, gold);
  } else if (a.kind === 'book') {
    p('box', 0, 1.39, .245, .4, .045, .04, gold);
    for (const side of [-1, 1]) p('box', side * .12, 1.37, .24, .16, .15, .045, gold);
    p('box', .34, .74, .18, .26, .36, .13, 0x9d3e46, -.12);
    p('box', .34, .74, .26, .21, .29, .03, cream, -.12);
    p('box', 0, .98, .24, .16, .3, .06, cream);
  } else if (a.kind === 'scarf') {
    p('box', 0, 1.08, .01, .65, .15, .46, cream);
    p('box', -.16, .84, .25, .15, .4, .05, cream);
    p('box', .25, .72, -.27, .31, .54, .22, 0x9e714b);
    p('box', .25, .9, -.4, .33, .1, .08, a.trim);
  }
  return a.id;
}
