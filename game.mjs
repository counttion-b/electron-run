import { RULES, createGame, steer, step, result, resistance, distanceAtTime } from './engine.mjs';
import { TubeRenderer } from './renderer.mjs';
import { GameFeedback } from './feedback.mjs';

const $ = id => document.getElementById(id), L = window.Lambda;
const canvas = $('track'), renderer = new TubeRenderer(canvas);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const tutorialKey = 'lambda.electron.tutorial.controls-v2';
if (L.storage.get('lambda.electron.tutorial.electron-30-v2', false)) L.storage.set(tutorialKey, true);
let identity = L.storage.get('lambda.student.v1'), loggedIn = false, boardData = null;
let state = 'home', previousState, game = createGame(), inputs = [], run = null;
let target = 1, accumulator = 0, lastFrame = 0, pulse = 0, hitFlash = 0, countdownTime = 0;
let tutorialStep = 0, tutorialMoved = false, nextTutorialAt = null, busy = false;
const pendingKey = `lambda.electron.pending.${RULES.version}`;
let pending = [], saving = false, submissionGeneration = 0, resultGeneration = 0;
let lastMoveSound = -10;
let pointer = null;
let bestBeforeRun = null;
const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
const feedback = new GameFeedback({ host: window, storage: L.storage, onChange: updateFeedbackControls });

const tone = type => feedback.tone(type);
function updateFeedbackControls() {
  const needsTap = !feedback.muted && feedback.audio && feedback.audio.state !== 'running';
  for (const button of document.querySelectorAll('[data-feedback="sound"]')) {
    button.disabled = !feedback.soundSupported;
    button.textContent = !feedback.soundSupported ? '声音 不支持' : feedback.muted ? '声音 关' : needsTap ? '声音 点按恢复' : '声音 开';
    button.setAttribute('aria-pressed', String(!feedback.muted && feedback.soundSupported));
    button.setAttribute('aria-label', !feedback.soundSupported ? '当前浏览器不支持音效' : needsTap ? '恢复音效' : feedback.muted ? '打开音效' : '关闭音效');
  }
  for (const button of document.querySelectorAll('[data-feedback="vibration"]')) {
    button.disabled = !feedback.vibrationSupported;
    button.textContent = feedback.vibrationSupported ? `振动 ${feedback.vibrationEnabled ? '开' : '关'}` : '振动 不支持';
    button.setAttribute('aria-pressed', String(feedback.vibrationSupported && feedback.vibrationEnabled));
    button.setAttribute('aria-label', !feedback.vibrationSupported ? '当前浏览器不支持振动' : feedback.vibrationEnabled ? '关闭振动' : '打开振动');
  }
}
for (const button of document.querySelectorAll('[data-feedback]')) button.onclick = () => {
  if (button.dataset.feedback === 'sound') {
    if (!feedback.muted && feedback.audio && feedback.audio.state !== 'running') feedback.unlock();
    else feedback.setMuted(!feedback.muted);
  } else {
    feedback.unlock(); feedback.setVibrationEnabled(!feedback.vibrationEnabled);
    if (feedback.vibrationEnabled) feedback.vibrate('hit');
  }
};
updateFeedbackControls();
function view(name) {
  $('home-screen').hidden = name !== 'home'; $('play-screen').hidden = name !== 'play'; $('result-screen').hidden = name !== 'result';
  document.body.dataset.mode = name; pointer = null;
}
function avatar(student) {
  const fallback = document.createElement('span'); fallback.className = 'avatar'; fallback.textContent = student.name?.slice(0, 1) || '−';
  if (!student.avatarUrl) return fallback;
  const image = document.createElement('img'); image.className = 'avatar'; image.alt = ''; image.src = student.avatarUrl;
  image.onerror = () => image.replaceWith(fallback); return image;
}
function renderBoard() {
  $('board').replaceChildren();
  if (!loggedIn || !boardData || !boardData.rows.length) {
    const text = document.createElement('li'); text.className = 'board-empty';
    if (!loggedIn) {
      text.append(document.createTextNode('无需登录即可游玩。'));
      const login = document.createElement('a'); login.href = '/'; login.textContent = '返回开始页'; text.append(login, document.createTextNode('，重新开始挑战。'));
    } else text.textContent = boardData ? '还没有本机纪录，先跑一局吧。' : '暂时无法读取本机纪录，请点刷新。';
    $('board').append(text);
  } else for (const row of boardData.rows) {
    const item = document.createElement('li'); if (row.studentId === identity?.student?.id) item.className = 'self';
    const rank = document.createElement('span'); rank.className = 'rank'; rank.textContent = String(row.rank).padStart(2, '0');
    const name = document.createElement('span'); name.className = 'name'; name.textContent = row.name;
    const score = document.createElement('span'); score.className = 'ohms'; score.append(document.createTextNode(row.resistance.toFixed(3) + ' '));
    const unit = document.createElement('small'); unit.textContent = 'Ω'; score.append(unit); item.append(rank, avatar(row), name, score); $('board').append(item);
  }
  const own = boardData?.me; $('personal').replaceChildren();
  if (own) {
    $('personal').append(document.createTextNode(`本机最佳　`));
    const score = document.createElement('strong'); score.textContent = `${own.resistance.toFixed(3)} Ω`; $('personal').append(score);
    $('best-label').textContent = `个人最佳 ${own.resistance.toFixed(3)} Ω`;
  } else $('personal').textContent = loggedIn ? '完成一局，就能留下自己的成绩。' : '纪录保存在当前浏览器。';
}
async function refreshBoard() {
  if (!identity?.token) { loggedIn = false; renderBoard(); return; }
  try {
    boardData = await L.api('/api/games/electron/leaderboard', { token: identity.token }); loggedIn = true;
    identity.student = boardData.student; $('identity').replaceChildren(avatar(boardData.student), document.createTextNode(boardData.student.name));
    $('connection').textContent = '无需登录 · 纪录保存在当前浏览器'; renderBoard();
  } catch (error) {
    if (error.status === 401) { loggedIn = false; boardData = null; $('identity').textContent = '不保存纪录试玩'; }
    $('connection').textContent = error.status === 401 ? '本机纪录暂时无法读取，可以继续试玩。' : '本机纪录暂时无法读取，可以继续试玩。'; renderBoard();
  }
}
$('refresh-board').onclick = refreshBoard;
function home() {
  feedback.stop();
  state = 'home'; busy = false; view('home'); game = createGame({ seed: randomSeed() });
  $('pause-panel').hidden = true; $('prompt').hidden = true; $('countdown').hidden = true;
  $('direct').hidden = Boolean(L.storage.get(tutorialKey, false)); $('start').disabled = false;
}
function completeTutorial() { L.storage.set(tutorialKey, true); $('direct').hidden = true; }
$('start').onclick = () => { feedback.unlock(); L.storage.get(tutorialKey, false) ? begin() : tutorial(1); };
$('direct').onclick = () => { completeTutorial(); begin(); };
$('how').onclick = () => { feedback.unlock(); tutorial(1); };
$('back-home').onclick = home;
$('show-board').onclick = () => { showResults(null); refreshBoard(); };
$('again').onclick = begin;

function tutorial(stage) {
  state = 'tutorial'; tutorialStep = stage; tutorialMoved = false; nextTutorialAt = null;
  view('play'); $('prompt').hidden = false; $('tutorial-next').hidden = true; $('pause-panel').hidden = true; $('pause').hidden = true; $('countdown').hidden = true;
  $('step-label').textContent = `操作体验 ${stage} / 3 · 不计成绩`;
  const words = {
    1: ['拖动，试着移动电子', '在画面上左右拖动，也可以直接点左侧或右侧跑道。'],
    2: ['先体验一次碰撞', '这次先不躲：碰撞会让速度归零，随后电场重新加速。'],
    3: ['看箭头，再选位置', '电荷即将横摆，旁边还有一个电荷。试着从腾出的空间通过。'],
  }[stage]; $('prompt-title').textContent = words[0]; $('prompt-copy').textContent = words[1];
  const row = stage === 2 ? { id: 0, z: distanceAtTime(1.3), lanes: [1], moving: false, hit: false, passed: false } :
    { id: 0, z: distanceAtTime(3), safe: 1, lanes: [0], from: 1, to: 2, moving: true, warnedAt: null, hit: false, passed: false };
  game = createGame({ rows: stage === 1 ? [] : [row], duration: 999 });
  if (stage === 3) game.x = game.lane = 2;
  target = game.lane; accumulator = 0; $('gesture-hint').classList.remove('faded');
}
function ready() {
  completeTutorial(); tutorialStep = 0; home();
  $('connection').textContent = '操作已经掌握。开始30秒正式挑战吧。'; $('start').focus({ preventScroll: true });
}
$('skip-tutorial').onclick = ready;

async function begin() {
  if (busy || saving) return;
  feedback.unlock();
  busy = true; $('start').disabled = $('again').disabled = true;
  run = null;
  if (loggedIn) {
    try {
      run = await L.api('/api/games/electron/start', { token: identity.token, method: 'POST', body: '{}' });
      if (run.version !== RULES.version) throw new Error('游戏正在更新，请刷新后再开始。');
    }
    catch (error) {
      busy = false; $('start').disabled = $('again').disabled = false;
      const message = `暂时无法保存本机纪录：${error.message}。可重试，或点击“不保存纪录试玩”。`;
      $('connection').textContent = message; $('save-status').textContent = message;
      $('retry-save').hidden = false; $('retry-save').textContent = '不保存纪录试玩 →'; $('retry-save').onclick = () => startCountdown(null);
      if (state === 'home') { $('direct').hidden = false; $('direct').textContent = '不保存纪录试玩 →'; $('direct').onclick = () => startCountdown(null); }
      return;
    }
  }
  busy = false; startCountdown(run);
}
function startCountdown(session) {
  feedback.unlock();
  bestBeforeRun = loggedIn ? boardData?.me?.resistance ?? null : null;
  run = session; game = createGame({ seed: run?.seed ?? randomSeed() }); target = 1; inputs = []; tutorialStep = 0;
  countdownTime = 0; accumulator = 0; state = 'countdown'; view('play');
  $('pause-panel').hidden = $('prompt').hidden = true; $('pause').hidden = true;
  $('countdown').hidden = false; $('countdown').textContent = '3'; $('gesture-hint').classList.remove('faded'); tone('tick');
  $('again').disabled = $('start').disabled = false;
}
const canSteer = () => state === 'playing' || state === 'tutorial' && tutorialStep !== 2;
function aim(value) {
  if (!canSteer()) return;
  target = Math.round(Math.max(0, Math.min(2, value)) * 1000) / 1000;
}
canvas.addEventListener('pointerdown', event => {
  if (!canSteer() || pointer && pointer.id !== event.pointerId) return;
  feedback.unlock();
  event.preventDefault(); canvas.setPointerCapture?.(event.pointerId);
  const touch = event.pointerType === 'touch' || event.pointerType === 'pen' || matchMedia('(pointer: coarse)').matches;
  const rect = canvas.getBoundingClientRect();
  pointer = { id: event.pointerId, x: event.clientX, lastX: event.clientX, lane: target, dragged: false, touch,
    stroke: Math.max(72, Math.min(120, rect.width * .24)) };
});
canvas.addEventListener('pointermove', event => {
  if (!pointer || event.pointerId !== pointer.id || !canSteer()) return;
  event.preventDefault(); const dx = event.clientX - pointer.x;
  if (Math.abs(dx) > (pointer.touch ? 2 : 4)) pointer.dragged = true;
  if (pointer.dragged) {
    if (pointer.touch) {
      aim(target + (event.clientX - pointer.lastX) * 2 / pointer.stroke);
      pointer.lastX = event.clientX;
    }
    else {
      const start = renderer.laneAt(pointer.x), end = renderer.laneAt(event.clientX);
      aim(pointer.lane + end - start);
    }
  }
});
canvas.addEventListener('pointerup', event => {
  if (!pointer || pointer.id !== event.pointerId) return;
  feedback.unlock();
  if (!pointer.dragged) aim(Math.round(renderer.laneAt(event.clientX)));
  pointer = null; canvas.releasePointerCapture?.(event.pointerId);
});
canvas.addEventListener('pointercancel', event => { if (pointer?.id === event.pointerId) pointer = null; });
document.addEventListener('keydown', event => {
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  const direction = ['ArrowLeft', 'a', 'A'].includes(event.key) ? -1 : ['ArrowRight', 'd', 'D'].includes(event.key) ? 1 : 0;
  if (direction && canSteer()) { feedback.unlock(); event.preventDefault(); if (!event.repeat) aim(Math.round(target) + direction); }
  if (event.key === 'Escape' && state === 'playing') pause();
});
function pause() {
  if (!['playing', 'tutorial', 'countdown'].includes(state)) return;
  previousState = state; state = 'paused'; pointer = null; $('pause-panel').hidden = false;
  feedback.stop();
}
$('pause').onclick = pause;
$('resume').onclick = () => { feedback.unlock(); state = previousState; $('pause-panel').hidden = true; lastFrame = 0; accumulator = 0; };
$('abandon').onclick = home;
document.addEventListener('visibilitychange', () => { if (document.hidden) { pause(); feedback.stop(); } });
window.addEventListener('blur', () => { pause(); feedback.stop(); });
window.addEventListener('pagehide', () => feedback.stop());

function showComparison(score, previousBest, saved = false) {
  const el = $('record-comparison'); el.hidden = !score;
  if (!score) return;
  el.classList.remove('record');
  if (!loggedIn) { el.textContent = '完成挑战，留下本机的第一条纪录。'; return; }
  if (previousBest === null || !Number.isFinite(previousBest)) {
    el.textContent = saved ? '第一条个人纪录，已经建立。' : '从这一局，开始你的个人纪录。'; return;
  }
  const delta = previousBest - score.resistance;
  const amount = Math.abs(delta) < .001 ? '不到 0.001 Ω' : `${Math.abs(delta).toFixed(3)} Ω`;
  if (Math.abs(delta) < 1e-10) el.textContent = '追平个人最佳，再少一点碰撞就能突破。';
  else if (delta > 0) { el.textContent = `比原纪录降低${amount}`; el.classList.add('record'); }
  else el.textContent = `距离个人纪录还差${amount}`;
}
function showResults(score) {
  state = 'result'; view('result'); $('result-screen').scrollTop = 0; resultGeneration = submissionGeneration;
  $('score-block').hidden = !score;
  $('result-kicker').textContent = score ? '30秒挑战完成' : '每一次，都可以更好';
  $('result-title').textContent = score ? '这次的电阻' : '来挑战自己的纪录';
  $('save-status').classList.remove('record'); $('retry-save').hidden = true;
  if (score) {
    $('final-resistance').textContent = score.resistance.toFixed(3);
    $('final-distance').textContent = `${Math.round(score.distance)} m`; $('final-collisions').textContent = `${score.collisions} 次`; $('final-streak').textContent = `${score.longest.toFixed(1)} s`;
    $('save-status').textContent = run ? '正在保存成绩…' : '本局为不保存纪录试玩。';
  } else $('save-status').textContent = loggedIn ? '30秒，跑出更低的电阻。' : '开始挑战，刷新本机纪录。';
  showComparison(score, bestBeforeRun);
  renderBoard();
}
function finish() {
  tone('finish'); submissionGeneration++; showResults(result(game));
  if (run) {
    pending.push({ runId: run.runId, inputs: inputs.map(input => [...input]), token: identity.token, generation: submissionGeneration, previousBest: bestBeforeRun });
    L.storage.set(pendingKey, pending); saveResult();
  } else refreshBoard();
}
async function saveResult() {
  if (!pending.length || saving) return;
  const item = pending[0]; let succeeded = false; saving = true; $('again').disabled = true;
  $('retry-save').disabled = true;
  try {
    const saved = await L.api('/api/games/electron/finish', { method: 'POST', token: item.token, body: JSON.stringify({ runId: item.runId, inputs: item.inputs }) });
    pending = pending.filter(entry => entry.runId !== item.runId); succeeded = true;
    if (pending.length) L.storage.set(pendingKey, pending); else L.storage.remove(pendingKey);
    await refreshBoard();
    if (state === 'result' && resultGeneration === item.generation) {
      showComparison(saved.score, Object.hasOwn(saved, 'previousBest') ? saved.previousBest : item.previousBest ?? null, true);
      $('save-status').textContent = saved.improved ? '个人新纪录 · 已保存在当前浏览器' : `已保存在当前浏览器 · 个人最佳 ${boardData?.me?.resistance.toFixed(3) ?? saved.score.resistance.toFixed(3)} Ω`;
      $('save-status').classList.toggle('record', saved.improved); $('retry-save').hidden = true;
      if (saved.improved) { tone('record'); feedback.vibrate('record'); }
    }
  } catch (error) {
    if (state === 'result') { $('save-status').textContent = `保存未成功：${error.message}`; $('retry-save').hidden = false; $('retry-save').textContent = '重试保存成绩 ↻'; $('retry-save').onclick = saveResult; }
    $('connection').textContent = '上一局纪录暂未保存，此浏览器已保留操作记录。';
  } finally {
    saving = false; $('again').disabled = false; $('retry-save').disabled = false;
    if (succeeded && pending.length) saveResult();
  }
}
function updateHud() {
  const formal = tutorialStep === 0, remain = formal ? Math.max(0, RULES.duration - game.time) : RULES.duration;
  $('time').textContent = remain.toFixed(1); $('time-progress').style.transform = `scaleX(${remain / RULES.duration})`;
  const r = formal ? resistance(game.time, game.distance) : null;
  $('resistance').textContent = r !== null && game.time >= .5 ? r.toFixed(3) : '—';
  document.querySelector('.hud-time').classList.toggle('urgent', remain <= 5);
  $('hit-label').classList.toggle('visible', hitFlash > .1);
  const ratio = Math.max(0, Math.min(1, game.speed / RULES.maxSpeed));
  $('speed-state').hidden = state !== 'playing' || ratio < .50;
  $('speed-state').classList.toggle('extreme', ratio >= .86);
  $('speed-label').textContent = ratio >= .86 ? '极限速度' : '高速';
  $('speed-fill').style.transform = `scaleX(${ratio})`;
  feedback.updateWind(ratio, state === 'playing');
}
function tick() {
  if (canSteer() && steer(game, target)) {
    if (state === 'playing') inputs.push([game.tick, game.lane]);
    else {
      tutorialMoved = true;
      if (tutorialStep === 1 && nextTutorialAt === null) { $('prompt-title').textContent = '就是这样，位置由你掌握'; nextTutorialAt = game.time + .8; }
    }
    if (game.time - lastMoveSound > .12) { tone('move'); lastMoveSound = game.time; }
  }
  step(game);
  for (const event of game.events) {
    if (event.type === 'warning') tone('warning');
    if (event.type === 'hit') {
      hitFlash = 1; tone('hit'); feedback.vibrate('hit');
      if (state === 'tutorial' && tutorialStep === 2) {
        $('prompt-title').textContent = '速度归零，又开始加速'; $('prompt-copy').textContent = '少一次碰撞，就保住一次积累。';
        $('tutorial-next').hidden = false; $('tutorial-next').onclick = () => tutorial(3);
      } else if (state === 'tutorial' && tutorialStep === 3) nextTutorialAt = game.time + .8;
    }
    if (event.type === 'pass' && state === 'tutorial' && tutorialStep === 3 && event.clean) {
      if (tutorialMoved) ready(); else nextTutorialAt = game.time + .5;
    }
  }
  if (state === 'tutorial' && nextTutorialAt !== null && game.time >= nextTutorialAt) tutorial(tutorialStep === 1 ? 2 : 3);
  if (state === 'playing' && game.finished) finish();
}
function frame(at) {
  const elapsed = lastFrame ? Math.min((at - lastFrame) / 1000, .15) : 0; lastFrame = at;
  pulse += elapsed; hitFlash = Math.max(0, hitFlash - elapsed * 3);
  if (state === 'countdown') {
    const before = Math.floor(countdownTime); countdownTime += elapsed;
    if (countdownTime >= 3) { state = 'playing'; $('countdown').hidden = true; $('pause').hidden = false; accumulator = 0; lastMoveSound = -10; tone('tick'); }
    else if (Math.floor(countdownTime) !== before) { $('countdown').textContent = String(3 - Math.floor(countdownTime)); tone('tick'); }
  } else if (state === 'playing' || state === 'tutorial') {
    accumulator += elapsed;
    while (accumulator >= 1 / RULES.hz && ['playing', 'tutorial'].includes(state)) { tick(); accumulator -= 1 / RULES.hz; }
    $('gesture-hint').classList.toggle('faded', state === 'playing' && game.time > 4);
  }
  updateHud(); renderer.draw(game, { mode: state === 'home' || state === 'result' ? 'home' : state, pulse, hit: hitFlash, reducedMotion });
  requestAnimationFrame(frame);
}
home(); renderBoard(); refreshBoard(); requestAnimationFrame(frame);
const retained = L.storage.get(pendingKey, []);
if (Array.isArray(retained)) {
  pending = retained.filter(item => item?.token && item.token === identity?.token);
  if (pending.length) saveResult();
}
