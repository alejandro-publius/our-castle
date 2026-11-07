import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PROJECT_KIND, FAMILY_PROJECT_SITE, PROJECT_KINDS, PROJECT_STAGES, isProjectKind, projectKind, projectLabel, projectSite, projectStage,
} from '../../src/core/family-project.js';
import { TIERS, milestoneCents, tierForProgress } from '../../src/core/rules.js';
import { ESTATE_MILESTONES } from '../../src/core/rewards.js';
import { FRONTIER_CLEARINGS, terrainElevation } from '../../src/core/realm-terrain.js';
import { REALM_DISTRICTS, REALM_LEGENDS, districtById, riverAt } from '../../src/core/realm.js';

// The campsite's stages are a reading of existing progress and milestone rules: no new threshold, no counter.
test('every stage boundary is an existing home milestone and every detail step an existing estate milestone', () => {
  assert.deepEqual(PROJECT_STAGES.map((s) => s.percent), TIERS.map((t) => t.percent));
  assert.deepEqual(PROJECT_STAGES.map((s) => s.key), ['survey', 'construction', 'furnished', 'gathering']);
  const target = 30000;
  for (let progress = 0; progress <= 33000; progress += 50) {
    const stage = projectStage(progress, target);
    assert.equal(stage.index, tierForProgress(progress, target), `stage at ${progress}`);
    const detail = ESTATE_MILESTONES.find((m) => m.key === { 0: 'porch', 1: 'market', 2: 'ramparts' }[stage.index]);
    assert.equal(stage.detail, Boolean(detail && progress >= milestoneCents(target, detail.percent)), `detail at ${progress}`);
    if (stage.detail) assert.equal(stage.detailKey, detail.key);
  }
});

test('exact boundaries on the demo goal: 10/25/40/60/80/100 percent of $300, rounded up to whole cents like the server', () => {
  const at = (cents) => { const s = projectStage(cents, 30000); return [s.key, s.detail]; };
  assert.deepEqual(at(0), ['survey', false]);
  assert.deepEqual(at(2999), ['survey', false]);
  assert.deepEqual(at(3000), ['survey', true]);     // 10% porch
  assert.deepEqual(at(6000), ['survey', true]);     // the demo household's $60 start
  assert.deepEqual(at(7499), ['survey', true]);
  assert.deepEqual(at(7500), ['construction', false]); // 25% manor
  assert.deepEqual(at(11999), ['construction', false]);
  assert.deepEqual(at(12000), ['construction', true]); // 40% village quarter
  assert.deepEqual(at(17999), ['construction', true]);
  assert.deepEqual(at(18000), ['furnished', false]);   // 60% keep
  assert.deepEqual(at(24000), ['furnished', true]);    // 80% ramparts
  assert.deepEqual(at(29999), ['furnished', true]);
  assert.deepEqual(at(30000), ['gathering', false]);   // 100% castle
  assert.equal(projectStage(30000, 30000).complete, true);
  assert.equal(projectStage(45000, 30000).key, 'gathering', 'past the goal stays complete');
  // An odd target rounds its thresholds up, exactly as milestoneCents does.
  assert.equal(projectStage(milestoneCents(33333, 25) - 1, 33333).key, 'survey');
  assert.equal(projectStage(milestoneCents(33333, 25), 33333).key, 'construction');
});

test('a refund sets the project back and a larger goal reopens earlier stages; the next visible change is named', () => {
  assert.equal(projectStage(30000, 30000).key, 'gathering');
  assert.equal(projectStage(30000 - 12000, 30000).key, 'furnished', 'a $120 refund from a finished goal');
  assert.equal(projectStage(18000, 30000).nextPercent, 80);
  assert.equal(projectStage(18000, 100000).key, 'survey', 'the same $180 toward a $1,000 goal');
  assert.equal(projectStage(18000, 100000).detail, true, '18% still clears the 10% detail');
  assert.equal(projectStage(18000, 100000).nextPercent, 25);
  assert.equal(projectStage(2999, 30000).nextPercent, 10);
  assert.equal(projectStage(30000, 30000).nextPercent, null);
});

test('invalid or missing values read as an untouched survey, never as progress', () => {
  for (const [p, t] of [[6000, 0], [6000, -1], [6000, null], [null, 30000], [-500, 30000], [6000.5, 30000], [NaN, 30000]]) {
    const stage = projectStage(p, t);
    assert.equal(stage.index, 0, `${p}/${t}`);
    assert.equal(stage.key, 'survey');
  }
  assert.equal(projectStage(-500, 30000).detail, false);
  assert.equal(projectLabel(projectStage(7500, 30000)), 'Family Campsite · Under construction');
});

test('the site is one existing unbuilt meadow: flat, dry, not a district, discovery or reward', () => {
  const s = FAMILY_PROJECT_SITE;
  const meadow = FRONTIER_CLEARINGS.find((c) => c.x === s.x && c.z === s.z);
  assert.ok(meadow, 'placed on a frontier clearing');
  assert.deepEqual([s.width, s.depth], [meadow.width, meadow.depth]);
  for (const x of [-8, 0, 8]) for (const z of [-8, 0, 8]) assert.equal(terrainElevation(s.x + x, s.z + z), 0);
  for (const x of [-9, 0, 9]) for (const z of [-9, 0, 9]) assert.ok(riverAt(s.x + x, s.z + z).depth < -3, 'dry ground');
  assert.equal(districtById(s.id), undefined);
  assert.ok(!REALM_LEGENDS.some((l) => l.id === s.id));
  assert.ok(REALM_DISTRICTS.every((d) => Math.abs(d.x - s.x) > (d.width + s.width) / 2 || Math.abs(d.z - s.z) > (d.depth + s.depth) / 2), 'overlaps no district');
});

// ---------- What the project builds: an explicit, listed family choice that only changes the picture ----------
test('the three listed choices; every goal without one is a campsite; nothing else is read as a choice', () => {
  assert.deepEqual(PROJECT_KINDS.map((k) => k.key), ['campsite', 'garden', 'schoolhouse']);
  assert.deepEqual(PROJECT_KINDS.map((k) => k.label), ['Campsite', 'Garden', 'Schoolhouse']);
  assert.equal(DEFAULT_PROJECT_KIND, 'campsite');
  for (const key of ['campsite', 'garden', 'schoolhouse']) assert.equal(isProjectKind(key), true, key);
  // Free text, look-alikes and other values (a goal named "Garden fund", a merchant title, a model reply) are not choices.
  for (const value of ['Garden', ' garden', 'garden ', 'GARDEN', 'school', 'school house', 'greenhouse', 'Garden fund', 'castle', '', null, undefined, 1, {}, ['garden'], { key: 'garden' }]) {
    assert.equal(isProjectKind(value), false, JSON.stringify(value));
    assert.equal(projectKind(value).key, 'campsite', `${JSON.stringify(value)} falls back to the campsite`);
  }
  assert.equal(projectKind('schoolhouse').name, 'Family Schoolhouse');
});

test('every choice develops through the same stages, thresholds and details; only the place and its stage names change', () => {
  for (const target of [30000, 33333, 100000]) {
    for (let progress = 0; progress <= target * 1.1; progress += Math.ceil(target / 600)) {
      const base = projectStage(progress, target);
      for (const kind of ['garden', 'schoolhouse']) {
        const stage = projectStage(progress, target, kind);
        const { kind: k, name, ...rest } = stage;
        const { kind: baseKind, name: baseName, ...baseRest } = base;
        assert.deepEqual(rest, baseRest, `${kind} at ${progress}/${target}`);
        assert.equal(k, kind); assert.equal(baseKind, 'campsite');
        assert.equal(name, projectKind(kind).stageNames[stage.index]);
      }
    }
  }
  assert.equal(projectLabel(projectStage(6000, 30000, 'garden')), 'Family Garden · Survey stakes');
  assert.equal(projectLabel(projectStage(18000, 30000, 'garden')), 'Family Garden · Planted garden');
  assert.equal(projectLabel(projectStage(30000, 30000, 'garden')), 'Family Garden · Garden in bloom');
  assert.equal(projectLabel(projectStage(7500, 30000, 'schoolhouse')), 'Family Schoolhouse · Under construction');
  assert.equal(projectLabel(projectStage(18000, 30000, 'schoolhouse')), 'Family Schoolhouse · Finished schoolhouse');
  assert.equal(projectLabel(projectStage(30000, 30000, 'schoolhouse')), 'Family Schoolhouse · Gathering place');
  // The campsite keeps exactly its earlier names, and an unknown kind reads as the campsite.
  assert.deepEqual(projectKind('campsite').stageNames, PROJECT_STAGES.map((s) => s.name));
  assert.equal(projectLabel(projectStage(18000, 30000, 'castle')), 'Family Campsite · Furnished campsite');
  // A refund or a larger goal steps every choice back the same way.
  assert.equal(projectStage(30000 - 12000, 30000, 'schoolhouse').key, 'furnished');
  assert.equal(projectStage(18000, 100000, 'garden').key, 'survey');
});

test('the same meadow for every choice; the camera and marker frame the taller schoolhouse', () => {
  for (const kind of PROJECT_KINDS) {
    const site = projectSite(kind.key);
    for (const key of ['id', 'x', 'z', 'width', 'depth']) assert.equal(site[key], FAMILY_PROJECT_SITE[key], `${kind.key} ${key}`);
    assert.equal(site.name, kind.name);
    assert.ok(Object.isFrozen(site));
  }
  assert.deepEqual(projectSite('campsite'), FAMILY_PROJECT_SITE);
  assert.deepEqual(projectSite(undefined), FAMILY_PROJECT_SITE);
  assert.ok(projectSite('schoolhouse').height > FAMILY_PROJECT_SITE.height, 'room for the bell tower');
  assert.ok(projectSite('garden').height >= FAMILY_PROJECT_SITE.height, 'the marker clears the glasshouse ridge');
});
