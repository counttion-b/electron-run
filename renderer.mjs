import { RULES, ionLane } from './engine.mjs';

const TAU = Math.PI * 2;
const RADIUS = 3;
const LANE_ANGLE = .83;
const DEPTH = 118;
const CAMERA_OFFSET = 34;
const FAR = 1900;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const rgb = (color, alpha) => `rgba(${color},${alpha})`;

/** A lightweight perspective view of the inside of a cut metal cylinder. */
export class TubeRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.width = 1;
    this.height = 1;
    this.pixelRatio = 1;
    this.motionHistory = [];
    this.motionPrevious = null;
    this.motionRows = null;
    this.nextMotionSample = 0;
    this.resize = this.resize.bind(this);
    this.observer = typeof ResizeObserver === 'function' ? new ResizeObserver(this.resize) : null;
    this.observer?.observe(canvas);
    if (!this.observer) window.addEventListener('resize', this.resize);
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width || this.canvas.clientWidth || window.innerWidth);
    this.height = Math.max(1, rect.height || this.canvas.clientHeight || window.innerHeight);
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * this.pixelRatio);
    this.canvas.height = Math.round(this.height * this.pixelRatio);
    this.cx = this.width * .5;
    this.horizon = this.height * .15;
    this.floorSpan = this.height * .86;
    const playWidth = Math.min(this.width, this.height * 1.55);
    this.xScale = playWidth * .55 / RADIUS;
    this.yScale = Math.min(this.xScale * .88, this.height * .39 / RADIUS);
    this.playerScale = DEPTH / (DEPTH + CAMERA_OFFSET);
    // Keep the visible sphere footprint close to the simulation's lane hitbox
    // on a large monitor as well as on a phone.
    const contactChord = 2 * RADIUS * Math.sin(LANE_ANGLE * RULES.hitWidth / 2);
    this.ballSize = 1.04 * contactChord * this.xScale * this.playerScale / (1 + .79);
  }

  project(x, y, z) {
    const scale = DEPTH / Math.max(22, DEPTH + CAMERA_OFFSET + z);
    return { x: this.cx + x * this.xScale * scale,
      y: this.horizon + (this.floorSpan - y * this.yScale) * scale, scale };
  }

  surface(lane, z) {
    const angle = (lane - 1) * LANE_ANGLE;
    return this.project(RADIUS * Math.sin(angle), RADIUS * (1 - Math.cos(angle)), z);
  }

  /** Continuous lane coordinate: the input layer may round it for a tap. */
  laneAt(screenX) {
    const unit = (screenX - this.cx) / (RADIUS * this.xScale * this.playerScale);
    return clamp(1 + Math.asin(clamp(unit, -.999, .999)) / LANE_ANGLE, 0, 2);
  }

  tubePoint(angle, z, radius = RADIUS) {
    return this.project(radius * Math.sin(angle), RADIUS - radius * Math.cos(angle), z);
  }

  polygon(points, fill) {
    const ctx = this.ctx;
    ctx.beginPath();
    points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  tube(distance, speed, reducedMotion) {
    const ctx = this.ctx;
    const { width: w, height: h } = this;
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#f8f6ef');
    sky.addColorStop(.48, '#e7e5df');
    sky.addColorStop(1, '#d8dad5');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Each strip follows the actual circular cross-section, then converges in Z.
    const strips = 42;
    for (let i = 0; i < strips; i++) {
      const a = -Math.PI / 2 + i * Math.PI / strips;
      const b = a + Math.PI / strips + .002;
      const angle = (a + b) * .5;
      const side = Math.abs(Math.sin(angle));
      const bright = Math.round(234 - side * 51 + Math.sin(angle * 3.3 + .8) * 11);
      const gradient = ctx.createLinearGradient(0, this.horizon, 0, h);
      gradient.addColorStop(0, '#f3f1e9');
      gradient.addColorStop(.33, `rgb(${bright + 3},${bright + 2},${bright - 2})`);
      gradient.addColorStop(1, `rgb(${bright - 9},${bright - 8},${bright - 13})`);
      this.polygon([this.tubePoint(a, -58), this.tubePoint(b, -58),
        this.tubePoint(b, FAR), this.tubePoint(a, FAR)], gradient);
    }

    // Subtle reflected highlights make the two raised walls read as metal.
    for (const angle of [-1.22, 1.14]) {
      const gradient = ctx.createLinearGradient(0, this.horizon, 0, h);
      gradient.addColorStop(0, 'rgba(255,255,255,0)');
      gradient.addColorStop(.5, 'rgba(255,255,255,.47)');
      gradient.addColorStop(1, 'rgba(255,255,255,.12)');
      this.polygon([this.tubePoint(angle - .09, -58), this.tubePoint(angle + .09, -58),
        this.tubePoint(angle + .09, FAR), this.tubePoint(angle - .09, FAR)], gradient);
    }

    // Moving cross-section marks reveal the concave floor without a busy grid.
    const step = 47;
    const shift = distance % step;
    for (let z = FAR - shift; z > -60; z -= step) {
      const q = DEPTH / (DEPTH + CAMERA_OFFSET + z);
      ctx.beginPath();
      for (let j = 0; j <= 32; j++) {
        const p = this.tubePoint(-Math.PI / 2 + j * Math.PI / 32, z);
        if (j === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = rgb('102,112,111', clamp(q * .15, .015, .15));
      ctx.lineWidth = Math.max(.5, q * 1.25);
      ctx.stroke();
    }

    // Recessed lane seams follow the cylinder rather than a flat three-lane road.
    for (const angle of [-LANE_ANGLE / 2, LANE_ANGLE / 2]) {
      for (let z = -75 - distance % 44; z < FAR; z += 44) {
        const p = this.tubePoint(angle, z);
        const end = this.tubePoint(angle, z + 21);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(end.x, end.y);
        ctx.strokeStyle = rgb('113,123,121', Math.min(.31, p.scale * .35));
        ctx.lineWidth = Math.max(.6, p.scale * 1.65);
        ctx.stroke();
      }
    }

    // The exposed copper lips identify the scene as a lengthwise-cut wire.
    for (const side of [-1, 1]) {
      const lip = ctx.createLinearGradient(0, this.horizon, 0, h);
      lip.addColorStop(0, '#d8c3ac'); lip.addColorStop(.45, '#b8794c');
      lip.addColorStop(1, '#754832');
      this.polygon([this.project(side * RADIUS, RADIUS, -58),
        this.project(side * (RADIUS + .095), RADIUS + .06, -58),
        this.project(side * (RADIUS + .095), RADIUS + .06, FAR),
        this.project(side * RADIUS, RADIUS, FAR)], lip);
      const near = this.project(side * RADIUS, RADIUS, -58);
      const far = this.project(side * RADIUS, RADIUS, FAR);
      ctx.beginPath(); ctx.moveTo(near.x, near.y); ctx.lineTo(far.x, far.y);
      ctx.strokeStyle = '#f5d2a7'; ctx.lineWidth = 1.3; ctx.stroke();
      const innerNear = this.tubePoint(side * 1.54, -58);
      const innerFar = this.tubePoint(side * 1.54, FAR);
      ctx.beginPath(); ctx.moveTo(innerNear.x, innerNear.y); ctx.lineTo(innerFar.x, innerFar.y);
      ctx.strokeStyle = 'rgba(77,71,62,.23)'; ctx.lineWidth = 1; ctx.stroke();
    }

    if (!reducedMotion && speed > 12) {
      const intensity = clamp(speed / (RULES.maxSpeed || 360), 0, 1);
      const count = 14 + Math.floor(intensity * 50);
      for (let i = 0; i < count; i++) {
        // Restrict the streaks to the raised walls: the playable lanes and
        // moving-ion arrows remain clear even when the electron is flying.
        const angle = (i % 2 ? 1 : -1) * (1.04 + (i * .137 % .46));
        const z = ((i * 79.13 - distance * 1.65) % 1060 + 1060) % 1060 - 74;
        const p = this.tubePoint(angle, z);
        const end = this.tubePoint(angle, z + 24 + intensity ** 1.3 * 190);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(end.x, end.y);
        const opacity = intensity ** .8 * .62 * Math.min(1, p.scale * 1.5);
        ctx.strokeStyle = rgb(i % 4 === 0 ? '180,226,243' : '255,255,255', opacity);
        ctx.lineWidth = Math.max(.7, p.scale * (1.2 + intensity * 2.7));
        ctx.lineCap = 'round'; ctx.stroke();
      }
    }

    // A little atmosphere removes distant geometric clutter.
    const mist = ctx.createLinearGradient(0, this.horizon - h * .02, 0, this.horizon + h * .20);
    mist.addColorStop(0, '#f8f6ef'); mist.addColorStop(.35, 'rgba(248,246,239,.87)');
    mist.addColorStop(1, 'rgba(248,246,239,0)');
    ctx.fillStyle = mist; ctx.fillRect(0, this.horizon - h * .03, w, h * .24);
  }

  updateMotion(game, mode, reducedMotion) {
    const current = { time: game.time || 0, distance: game.distance || 0,
      x: Number.isFinite(game.x) ? game.x : 1, speed: game.speed || 0 };
    const previous = this.motionPrevious;
    const inactive = mode !== 'playing' || reducedMotion || current.speed < 4;
    const restarted = previous && (current.time < previous.time - 1e-7
      || current.distance < previous.distance - .001 || this.motionRows !== game.rows);
    const collision = previous && previous.speed > 30 && current.speed < previous.speed * .55;
    const jumped = previous && current.time - previous.time > .3;
    if (inactive || restarted || collision || jumped) {
      this.motionHistory.length = 0;
      this.motionPrevious = null;
      this.nextMotionSample = current.time;
    }
    this.motionRows = game.rows;
    if (inactive) return;

    const last = this.motionPrevious;
    if (!last) {
      this.motionHistory.push({ ...current });
      this.nextMotionSample = current.time + 1 / 60;
    } else if (current.time > last.time + 1e-8) {
      // Sample simulation time, not animation frames. Interpolation preserves
      // turns on 30 Hz displays without adding duplicate samples while paused.
      while (this.nextMotionSample <= current.time + 1e-8) {
        const fraction = clamp((this.nextMotionSample - last.time) / (current.time - last.time), 0, 1);
        this.motionHistory.push({ time: this.nextMotionSample,
          x: last.x + (current.x - last.x) * fraction,
          distance: last.distance + (current.distance - last.distance) * fraction });
        this.nextMotionSample += 1 / 60;
      }
    }
    this.motionPrevious = current;
    while (this.motionHistory.length && this.motionHistory[0].time < current.time - .34) this.motionHistory.shift();
  }

  motionTrail(game, mode, reducedMotion) {
    if (mode !== 'playing' || reducedMotion || !(game.speed > 4)) return;
    const ctx = this.ctx;
    const strength = clamp(game.speed / (RULES.maxSpeed || 360), 0, 1);
    const time = game.time || 0;
    const lane = Number.isFinite(game.x) ? game.x : 1;
    const current = this.surface(lane, 0);
    const radius = this.ballSize * .79;
    const center = { x: current.x, y: current.y - radius * .92, age: 0 };
    const lifetime = .13 + strength * .19;
    const points = [center];
    for (let i = this.motionHistory.length - 1; i >= 0; i--) {
      const sample = this.motionHistory[i];
      const age = time - sample.time;
      if (age < .006 || age > lifetime) continue;
      const z = sample.distance - (game.distance || 0);
      if (z < -91) break;
      const position = this.surface(sample.x, z);
      const oldRadius = radius * position.scale / this.playerScale;
      points.push({ x: position.x, y: position.y - oldRadius * .92, age: age / lifetime });
      if (position.y - oldRadius > this.height * 1.35) break;
    }

    // A short launch plume is visible before enough history has accumulated.
    // After that every bend follows actual earlier electron positions.
    if (points.length < 3) {
      const length = this.height * (.012 + strength ** 1.1 * .43);
      points.length = 1;
      points.push({ x: center.x, y: center.y + length * .40, age: .45 },
        { x: center.x, y: center.y + length, age: 1 });
    }

    const opacity = strength ** .72;
    ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const layer of [
      { width: 1.45, color: '38,158,222', alpha: .16 },
      { width: .77, color: '28,151,220', alpha: .45 },
      { width: .31, color: '90,211,246', alpha: .62 },
      { width: .085, color: '220,253,255', alpha: .86 },
    ]) {
      const left = [], right = [];
      for (let i = 0; i < points.length; i++) {
        const point = points[i];
        const before = points[Math.max(0, i - 1)], after = points[Math.min(points.length - 1, i + 1)];
        const dx = after.x - before.x, dy = after.y - before.y;
        const length = Math.max(.001, Math.hypot(dx, dy));
        const taper = Math.max(0, 1 - point.age) ** 1.3;
        const width = radius * layer.width * taper * (.38 + strength * .62);
        left.push({ x: point.x - dy / length * width, y: point.y + dx / length * width });
        right.push({ x: point.x + dy / length * width, y: point.y - dx / length * width });
      }
      const end = points[points.length - 1];
      const fade = ctx.createLinearGradient(center.x, center.y, end.x, Math.max(center.y + 1, end.y));
      fade.addColorStop(0, rgb(layer.color, layer.alpha * opacity));
      fade.addColorStop(.55, rgb(layer.color, layer.alpha * opacity * .58));
      fade.addColorStop(1, rgb(layer.color, 0));
      this.polygon([...left, ...right.reverse()], fade);
    }

    // Low-opacity snapshots emphasize sideways movement without hiding ions.
    // They are rendered beneath all live objects, oldest first.
    if (strength > .18) {
      const interval = .027 + (1 - strength) * .017;
      let targetAge = interval * 4;
      for (let i = 0; i < this.motionHistory.length && targetAge >= interval * .85; i++) {
        const sample = this.motionHistory[i];
        const age = time - sample.time;
        if (age > targetAge + 1 / 60 || age < targetAge - 1 / 60) continue;
        const z = sample.distance - (game.distance || 0);
        targetAge -= interval;
        if (z < -72) continue;
        const position = this.surface(sample.x, z);
        const ghostRadius = radius * position.scale / this.playerScale * .91;
        const y = position.y - ghostRadius * .92;
        if (y - ghostRadius > this.height) continue;
        const alpha = opacity * .24 * clamp(1 - age / .18, 0, 1);
        const glow = ctx.createRadialGradient(position.x - ghostRadius * .18, y - ghostRadius * .2,
          ghostRadius * .12, position.x, y, ghostRadius);
        glow.addColorStop(0, rgb('166,239,255', alpha * .6));
        glow.addColorStop(.8, rgb('41,160,218', alpha));
        glow.addColorStop(1, rgb('31,132,190', 0));
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(position.x, y, ghostRadius, 0, TAU); ctx.fill();
        ctx.strokeStyle = rgb('207,251,255', alpha * .9); ctx.lineWidth = Math.max(1, ghostRadius * .08);
        ctx.beginPath(); ctx.moveTo(position.x - ghostRadius * .31, y); ctx.lineTo(position.x + ghostRadius * .31, y); ctx.stroke();
      }
    }
    ctx.restore();
  }

  shadow(x, y, radius, lane, blue = false) {
    const ctx = this.ctx;
    const angle = (lane - 1) * LANE_ANGLE;
    ctx.save(); ctx.translate(x, y + radius * .03);
    ctx.rotate(-Math.atan(Math.tan(angle) * this.yScale / this.xScale));
    ctx.scale(1, .31);
    const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 1.65);
    shadow.addColorStop(0, blue ? 'rgba(29,82,115,.37)' : 'rgba(66,47,33,.36)');
    shadow.addColorStop(.45, blue ? 'rgba(29,82,115,.18)' : 'rgba(66,47,33,.16)');
    shadow.addColorStop(1, 'rgba(35,40,36,0)');
    ctx.fillStyle = shadow; ctx.beginPath(); ctx.arc(0, 0, radius * 1.65, 0, TAU); ctx.fill();
    ctx.restore();
  }

  warningJitter(row, time, radius, reducedMotion) {
    if (reducedMotion || !row.moving || row.warnedAt === null || row.hit || row.passed) return 0;
    const elapsed = time - row.warnedAt;
    const windup = RULES.windup || .9;
    if (elapsed < 0 || elapsed >= windup) return 0;
    return Math.sin(elapsed * TAU * 5.3) * Math.min(2, radius * .055);
  }

  warning(row, z, time, radius, reducedMotion) {
    if (!row.moving || row.warnedAt === null || row.hit || row.passed || z < Math.max(14, RULES.hitDepth * 2)) return;
    const elapsed = time - row.warnedAt;
    const windup = RULES.windup || .9;
    const swing = RULES.swing || .24;
    if (elapsed < 0 || elapsed > windup + swing + .12) return;
    const ctx = this.ctx;
    const source = this.surface(row.from, z);
    const target = this.surface(row.to, z);
    const moving = this.surface(ionLane(row, time), z);
    const jitter = this.warningJitter(row, time, radius, reducedMotion);
    const fade = elapsed > windup ? clamp(1 - (elapsed - windup) / (swing + .12), 0, 1) : 1;
    const breath = reducedMotion ? 1 : .90 + .10 * Math.sin(elapsed * Math.PI * 3);
    const lineWidth = Math.max(2.6, radius * .095);
    const ringRadius = Math.max(10, radius * 1.12);
    ctx.save(); ctx.globalAlpha *= fade;

    // The destination is an empty footprint, distinct from the solid source.
    // ellipse() keeps its stroke equally legible in both screen directions.
    ctx.beginPath(); ctx.ellipse(target.x, target.y - radius * .035,
      ringRadius, Math.max(4.5, ringRadius * .37), 0, 0, TAU);
    ctx.fillStyle = rgb('224,135,55', .14 * breath); ctx.fill();
    ctx.lineWidth = lineWidth + 2.6; ctx.strokeStyle = 'rgba(255,252,239,.91)'; ctx.stroke();
    ctx.setLineDash([Math.max(4, ringRadius * .27), Math.max(3, ringRadius * .17)]);
    ctx.lineWidth = lineWidth; ctx.strokeStyle = rgb('173,83,24', .94 * breath); ctx.stroke();
    ctx.setLineDash([]);

    // Draw the source outline after every ion, so a second charge on the same
    // row cannot hide which one is about to move. The body itself jitters too.
    const sourceRadius = radius * 1.075 + (reducedMotion ? 0 : (breath - .8) * 2.2);
    ctx.beginPath(); ctx.arc(moving.x + jitter, moving.y - radius * .92, sourceRadius, 0, TAU);
    ctx.lineWidth = Math.max(1.8, radius * .06) + 2.4;
    ctx.strokeStyle = 'rgba(255,252,235,.91)'; ctx.stroke();
    ctx.lineWidth = Math.max(1.8, radius * .06);
    ctx.strokeStyle = rgb('193,92,24', .94 * breath); ctx.stroke();

    const direction = Math.sign(target.x - source.x);
    const startX = source.x + direction * radius * .60;
    const endX = target.x - direction * radius * .06;
    const startY = source.y - radius * 2.10 - 3;
    const endY = target.y - Math.max(12, radius * .72);
    const middleX = (startX + endX) * .5;
    const middleY = Math.min(startY, endY) - Math.max(9, radius * .50);
    ctx.beginPath(); ctx.moveTo(startX, startY); ctx.quadraticCurveTo(middleX, middleY, endX, endY);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255,252,239,.96)'; ctx.lineWidth = lineWidth + 3; ctx.stroke();
    ctx.strokeStyle = '#a65219'; ctx.lineWidth = lineWidth; ctx.stroke();
    const a = Math.atan2(endY - middleY, endX - middleX);
    const arrow = Math.max(8, radius * .37);
    ctx.beginPath(); ctx.moveTo(endX, endY);
    ctx.lineTo(endX - Math.cos(a - .53) * arrow, endY - Math.sin(a - .53) * arrow);
    ctx.lineTo(endX - Math.cos(a + .53) * arrow, endY - Math.sin(a + .53) * arrow);
    ctx.closePath(); ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(255,252,239,.97)'; ctx.stroke();
    ctx.fillStyle = '#a65219'; ctx.fill();
    ctx.restore();
  }

  sphere(lane, z, { electron = false, time = 0, speed = 0, invulnerable = 0, moving = false, jitter = 0, reducedMotion = false } = {}) {
    const ctx = this.ctx;
    const surface = this.surface(lane, z);
    const radius = this.ballSize * surface.scale / this.playerScale * (electron ? .79 : 1);
    if (radius < 1.25) return;
    const x = surface.x + jitter;
    const y = surface.y - radius * .92;
    const depthAlpha = clamp((1200 - z) / 800, .12, 1);
    ctx.save(); ctx.globalAlpha *= depthAlpha;
    if (electron && invulnerable > 0 && !reducedMotion) ctx.globalAlpha *= .48 + Math.abs(Math.sin(time * 24)) * .52;
    this.shadow(x, surface.y, radius, lane, electron);

    if (electron) {
      const glow = ctx.createRadialGradient(x, y, radius * .4, x, y, radius * 2.7);
      glow.addColorStop(0, 'rgba(65,174,218,.24)'); glow.addColorStop(1, 'rgba(65,174,218,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, radius * 2.7, 0, TAU); ctx.fill();
    }

    const ball = ctx.createRadialGradient(x - radius * .34, y - radius * .39, radius * .04, x + radius * .15, y + radius * .24, radius * 1.24);
    if (electron) {
      ball.addColorStop(0, '#f1feff'); ball.addColorStop(.23, '#8ee1f2');
      ball.addColorStop(.58, '#2b9bce'); ball.addColorStop(.89, '#17618f'); ball.addColorStop(1, '#164b70');
    } else {
      ball.addColorStop(0, '#fff3d9'); ball.addColorStop(.22, '#efc58f');
      ball.addColorStop(.56, '#ce9360'); ball.addColorStop(.85, '#99613d'); ball.addColorStop(1, '#74472f');
    }
    ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU); ctx.fillStyle = ball; ctx.fill();
    ctx.strokeStyle = electron ? 'rgba(13,86,122,.45)' : 'rgba(102,62,35,.39)';
    ctx.lineWidth = Math.max(.6, radius * .035); ctx.stroke();
    ctx.beginPath(); ctx.arc(x - radius * .14, y - radius * .10, radius * .79, Math.PI * 1.12, Math.PI * 1.66);
    ctx.strokeStyle = electron ? 'rgba(242,255,255,.70)' : 'rgba(255,247,222,.61)';
    ctx.lineWidth = Math.max(.7, radius * .065); ctx.stroke();

    if (radius > 3.5) {
      const mark = radius * .36;
      ctx.beginPath(); ctx.moveTo(x - mark, y + radius * .055); ctx.lineTo(x + mark, y + radius * .055);
      if (!electron) { ctx.moveTo(x, y - mark + radius * .055); ctx.lineTo(x, y + mark + radius * .055); }
      ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1.1, radius * .135);
      ctx.strokeStyle = electron ? '#effeff' : '#fff5df'; ctx.stroke();
    }
    ctx.restore();
  }

  draw(game = {}, { mode = 'playing', pulse = 0, hit = 0, reducedMotion = false } = {}) {
    const ctx = this.ctx;
    if (!ctx || this.width <= 1 || this.height <= 1) return;
    const distance = game.distance || 0;
    const speed = game.speed || 0;
    const time = game.time || 0;
    const isHome = mode === 'home';
    ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    ctx.globalAlpha = 1; ctx.lineCap = 'butt'; ctx.setLineDash([]);
    this.updateMotion(game, mode, reducedMotion);
    this.tube(distance, mode === 'playing' ? speed : 0, reducedMotion);
    this.motionTrail(game, mode, reducedMotion);

    const sprites = [];
    for (const row of game.rows || []) {
      const z = row.z - distance;
      if (z < -80 || z > 1120) continue;
      const lanes = row.lanes || [];
      for (const lane of lanes) sprites.push({ z, lane, row, moving: false });
      if (row.moving) sprites.push({ z, lane: ionLane(row, time), row, moving: true });
    }
    sprites.sort((a, b) => b.z - a.z);
    for (const sprite of sprites) {
      ctx.save();
      if (isHome) ctx.globalAlpha = .56;
      if (sprite.row?.hit) ctx.globalAlpha *= .60;
      const radius = this.ballSize * this.surface(sprite.lane, sprite.z).scale / this.playerScale;
      const jitter = sprite.moving ? this.warningJitter(sprite.row, time, radius, reducedMotion) : 0;
      this.sphere(sprite.lane, sprite.z, { time, speed, jitter, reducedMotion });
      ctx.restore();
    }

    // Warning graphics have their own pass: stationary ions cannot overpaint
    // the arrow. The electron is last so controls remain visually unobscured.
    if (!isHome) {
      for (const sprite of sprites) {
        if (!sprite.moving) continue;
        const radius = this.ballSize * this.surface(sprite.lane, sprite.z).scale / this.playerScale;
        this.warning(sprite.row, sprite.z, time, radius, reducedMotion);
      }
    }
    this.sphere(Number.isFinite(game.x) ? game.x : 1, 0, { electron: true, time, speed,
      invulnerable: game.invulnerable || 0, reducedMotion });

    if (hit > 0) {
      const shade = ctx.createRadialGradient(this.cx, this.height * .72, this.width * .05,
        this.cx, this.height * .72, Math.max(this.width, this.height) * .72);
      shade.addColorStop(0, 'rgba(223,123,69,0)');
      shade.addColorStop(1, rgb('210,101,51', clamp(hit, 0, 1) * .23));
      ctx.fillStyle = shade; ctx.fillRect(0, 0, this.width, this.height);
    }
    if (pulse > 0 && mode === 'countdown') {
      ctx.fillStyle = rgb('255,253,245', clamp(pulse, 0, 1) * .08);
      ctx.fillRect(0, 0, this.width, this.height);
    }
    ctx.globalAlpha = 1; ctx.setLineDash([]);
  }

  dispose() {
    this.motionHistory.length = 0;
    this.motionPrevious = null;
    this.observer?.disconnect();
    if (!this.observer) window.removeEventListener('resize', this.resize);
  }
}
