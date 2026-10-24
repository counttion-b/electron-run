// Shared deterministic simulation: browsers draw it; the server replays inputs.
export const RULES = Object.freeze({ version: 'electron-30-v6', duration: 30, hz: 120,
  initialSpeed: 70, rampDuration: 24, recovery: 1.5, maxSpeed: 650, laneSpeed: 12, inputDelay: .08,
  firstRowTime: 2, firstRowDistance: 160, minRowGap: 155, hitDepth: 6.5, hitWidth: .55,
  warning: .9, windup: .4, swing: .15, invulnerable: .2, seed: 20261023 });
export const resistance = (time, distance) => distance > 0 ? 100 * time / distance : null;
const clamp01 = value => Math.max(0, Math.min(1, value));
const smoothstep = value => { const p = clamp01(value); return p * p * (3 - 2 * p); };
export const cruiseSpeed = time => RULES.initialSpeed + (RULES.maxSpeed - RULES.initialSpeed) * smoothstep(time / RULES.rampDuration);
export function distanceAtTime(time) {
  const t = Math.max(0, time), u = Math.min(t / RULES.rampDuration, 1);
  return RULES.initialSpeed * Math.min(t, RULES.rampDuration) +
    (RULES.maxSpeed - RULES.initialSpeed) * RULES.rampDuration * (u ** 3 - .5 * u ** 4) +
    RULES.maxSpeed * Math.max(0, t - RULES.rampDuration);
}
const speedAt = (time, lastHit) => cruiseSpeed(time) * smoothstep((time - lastHit) / RULES.recovery);
function timeAtDistance(distance) {
  let low = 0, high = Math.max(1, distance / RULES.initialSpeed);
  for (let i = 0; i < 45; i++) {
    const middle = (low + high) / 2;
    if (distanceAtTime(middle) < distance) low = middle; else high = middle;
  }
  return (low + high) / 2;
}

function random(seed) {
  let n = seed >>> 0;
  return () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; };
}
export function makeCourse(seed = RULES.seed, count = 96) {
  const rand = random(seed); const rows = [];
  let arrival = Math.max(RULES.firstRowTime, timeAtDistance(RULES.firstRowDistance)), previousSafe = 1, rush = false, lateBeat = 0;
  for (let i = 0; i < count; i++) {
    let safe = Math.floor(rand() * 3);
    if (safe === previousSafe && rand() < .7) safe = (safe + 1 + Math.floor(rand() * 2)) % 3;
    if (rush && safe === previousSafe) safe = (safe + 1 + Math.floor(rand() * 2)) % 3;
    const blocked = [0, 1, 2].filter(lane => lane !== safe);
    const moving = i >= 1 && rand() < Math.min(.65, .3 + i * .022);
    // The moving ion leaves the eventual safe lane. Its destination is adjacent,
    // and any stationary ion occupies the remaining lane, never the moving ion.
    const from = moving ? safe : null;
    const adjacent = [safe - 1, safe + 1].filter(lane => lane >= 0 && lane <= 2);
    const to = moving ? adjacent[Math.floor(rand() * adjacent.length)] : null;
    const lanes = moving
      ? rand() < .78 ? blocked.filter(lane => lane !== to) : []
      : rand() < Math.min(.82, .48 + i * .018) ? blocked : [blocked[Math.floor(rand() * 2)]];
    rows.push({ id: i, z: distanceAtTime(arrival), safe,
      lanes, from, to, moving, warnedAt: null, hit: false, passed: false });
    previousSafe = safe;
    // Follow the fastest cruise curve, with three distinct pacing phases.
    // Late runs alternate three quick changes with one short breathing space.
    if (arrival < 7) { arrival += .85 + rand() * .15; rush = false; }
    else if (arrival < 17) { arrival += .55 + rand() * .15; rush = false; }
    else {
      rush = lateBeat < 3;
      arrival += rush ? .38 + rand() * .08 : .75 + rand() * .2;
      lateBeat = (lateBeat + 1) % 4;
    }
    // Low speed must also leave visible depth between rows. The time rhythm is
    // only extended where needed; existing rows never move or get backfilled.
    const minimumZ = rows.at(-1).z + RULES.minRowGap;
    if (distanceAtTime(arrival) < minimumZ) arrival = timeAtDistance(minimumZ);
  }
  return rows;
}
/** Predicted distance from a global time, retaining the current collision recovery. */
export function travelIn(seconds, startTime = 0, lastHit = -Infinity) {
  if (seconds <= 0) return 0;
  const end = startTime + seconds;
  if (lastHit + RULES.recovery <= startTime) return distanceAtTime(end) - distanceAtTime(startTime);
  // Four-point Gaussian quadrature exactly integrates the degree-six product
  // of the cruise and recovery smoothsteps. Split at their piecewise joins.
  const cuts = [startTime, end, RULES.rampDuration, lastHit, lastHit + RULES.recovery]
    .filter(value => value >= startTime && value <= end).sort((a, b) => a - b);
  const nodes = [-.8611363115940526, -.3399810435848563, .3399810435848563, .8611363115940526];
  const weights = [.3478548451374538, .6521451548625461, .6521451548625461, .3478548451374538];
  let distance = 0;
  for (let i = 1; i < cuts.length; i++) {
    const half = (cuts[i] - cuts[i - 1]) / 2, middle = (cuts[i] + cuts[i - 1]) / 2;
    for (let j = 0; j < nodes.length; j++) distance += half * weights[j] * speedAt(middle + half * nodes[j], lastHit);
  }
  return distance;
}
export function ionLane(row, time) {
  if (!row.moving) return row.lanes[0];
  if (row.warnedAt === null) return row.from;
  const p = Math.max(0, Math.min(1, (time - row.warnedAt - RULES.windup) / RULES.swing));
  const ease = p * p * (3 - 2 * p);
  return row.from + (row.to - row.from) * ease;
}
export function ionLanes(row, time) {
  return row.moving ? [...row.lanes, ionLane(row, time)] : row.lanes;
}
export function createGame({ seed = RULES.seed, rows, duration = RULES.duration } = {}) {
  return { tick: 0, time: 0, duration, distance: 0, speed: RULES.initialSpeed, x: 1, lane: 1,
    lastInput: -1000, collisions: 0, invulnerable: 0, lastHit: -100,
    longest: 0, rows: rows ? structuredClone(rows) : makeCourse(seed), events: [], finished: false };
}
export function move(game, direction) {
  if (game.finished || ![-1, 1].includes(direction) || game.time - game.lastInput < RULES.inputDelay - 1e-8) return false;
  const lane = direction < 0 ? Math.ceil(game.lane) - 1 : Math.floor(game.lane) + 1;
  if (!steer(game, Math.max(0, Math.min(2, lane)))) return false;
  game.lastInput = game.time; return true;
}
export function steer(game, target) {
  if (game.finished || !Number.isFinite(target) || target < 0 || target > 2) return false;
  const lane = Math.round(target * 1000) / 1000;
  if (lane === game.lane) return false;
  game.lane = lane; return true;
}
export function step(game) {
  if (game.finished) return;
  const dt = 1 / RULES.hz;
  game.events = [];
  const before = game.distance;
  const oldSpeed = game.speed;
  game.speed = speedAt((game.tick + 1) / RULES.hz, game.lastHit);
  game.distance += (oldSpeed + game.speed) * .5 * dt;
  const dx = game.lane - game.x;
  game.x += Math.sign(dx) * Math.min(Math.abs(dx), RULES.laneSpeed * dt);
  game.tick++; game.time = game.tick / RULES.hz;
  game.invulnerable = Math.max(0, game.invulnerable - dt);
  const warningDistance = travelIn(RULES.warning, game.time, game.lastHit);
  for (const row of game.rows) {
    if (row.passed) continue;
    if (row.moving && row.warnedAt === null && row.z - game.distance <= warningDistance) {
      row.warnedAt = game.time; game.events.push({ type: 'warning', row: row.id });
    }
    const touching = before <= row.z + RULES.hitDepth && game.distance >= row.z - RULES.hitDepth;
    const lanes = ionLanes(row, game.time);
    if (touching && !row.hit && game.invulnerable <= 0 && lanes.some(x => Math.abs(x - game.x) < RULES.hitWidth)) {
      row.hit = true; game.collisions++;
      game.longest = Math.max(game.longest, game.time - Math.max(0, game.lastHit));
      game.lastHit = game.time; game.speed = 0; game.invulnerable = RULES.invulnerable;
      game.events.push({ type: 'hit', row: row.id });
    }
    if (game.distance > row.z + RULES.hitDepth) { row.passed = true; game.events.push({ type: 'pass', row: row.id, clean: !row.hit }); }
  }
  game.longest = Math.max(game.longest, game.time - Math.max(0, game.lastHit));
  game.finished = game.tick >= Math.round(game.duration * RULES.hz);
}
export function result(game) {
  return { distance: game.distance, collisions: game.collisions, duration: game.duration,
    resistance: resistance(game.duration, game.distance), longest: game.longest, version: RULES.version };
}
export function replay(inputs, seed = RULES.seed) {
  if (!Array.isArray(inputs) || inputs.length > RULES.duration * RULES.hz) throw new Error('操作记录格式不正确');
  const end = RULES.duration * RULES.hz; let previous = -1;
  for (const entry of inputs) {
    if (!Array.isArray(entry) || entry.length !== 2 || !Number.isInteger(entry[0]) || entry[0] < 0 || entry[0] >= end || entry[0] <= previous ||
      !Number.isFinite(entry[1]) || entry[1] < 0 || entry[1] > 2 || Math.abs(entry[1] * 1000 - Math.round(entry[1] * 1000)) > 1e-8) throw new Error('操作记录格式不正确');
    previous = entry[0];
  }
  const game = createGame({ seed }); let cursor = 0;
  while (!game.finished) {
    while (cursor < inputs.length && inputs[cursor][0] === game.tick) {
      steer(game, inputs[cursor][1]);
      cursor++;
    }
    step(game);
  }
  return result(game);
}
