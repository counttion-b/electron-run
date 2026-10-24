import { RULES, replay } from './engine.mjs';

// This build has no account, classroom connection, or remote score service.
export function createLocalBridge(host) {
  const prefix = 'electron-run-online:';
  const player = { id: 'this-browser', name: '本机纪录', avatarUrl: null };
  const localIdentity = { token: 'browser-only', student: player };
  const storage = {
    get(key, fallback = null) {
      if (key === 'lambda.student.v1') return { ...localIdentity, student: { ...player } };
      try { const raw = host.localStorage.getItem(prefix + key); return raw === null ? fallback : JSON.parse(raw); }
      catch { return fallback; }
    },
    set(key, value) {
      if (key === 'lambda.student.v1') return false;
      try { host.localStorage.setItem(prefix + key, JSON.stringify(value)); return true; } catch { return false; }
    },
    remove(key) { try { host.localStorage.removeItem(prefix + key); } catch { /* Optional browser storage. */ } },
  };
  const bestKey = `best:${RULES.version}`, runsKey = `runs:${RULES.version}`;
  const save = (key, value) => {
    if (!storage.set(key, value)) throw new Error('当前浏览器无法保存纪录，可以选择不保存纪录试玩。');
  };
  async function api(path, options = {}) {
    const best = storage.get(bestKey);
    if (path.endsWith('/leaderboard')) {
      const row = best ? { ...best.score, studentId: player.id, name: '本机最佳', avatarUrl: null, rank: 1 } : null;
      return { version: RULES.version, duration: RULES.duration, student: { ...player }, rows: row ? [row] : [], total: row ? 1 : 0, me: row };
    }
    const runs = storage.get(runsKey, {});
    if (path.endsWith('/start')) {
      const runId = host.crypto.randomUUID(), seed = host.crypto.getRandomValues(new Uint32Array(1))[0];
      runs[runId] = { seed, version: RULES.version }; save(runsKey, runs);
      return { runId, seed, version: RULES.version, duration: RULES.duration };
    }
    if (path.endsWith('/finish')) {
      const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
      const run = runs[body?.runId];
      if (!run || run.version !== RULES.version) throw new Error('这局操作记录已失效，请重新开始。');
      if (run.response) return run.response;
      const score = replay(body.inputs, run.seed), previousBest = best?.score?.resistance ?? null;
      const improved = previousBest === null || score.resistance < previousBest;
      const response = { score, improved, previousBest, delta: previousBest === null ? null : previousBest - score.resistance };
      if (improved) save(bestKey, { score, savedAt: new Date().toISOString() });
      runs[body.runId] = { ...run, response }; save(runsKey, runs);
      return response;
    }
    throw new Error('本机试玩不提供此功能。');
  }
  return { storage, api };
}

if (typeof window !== 'undefined' && window.document) {
  window.Lambda = createLocalBridge(window);
  await import('./game.mjs');
}
