/** Browser-standard fetch agent. No SDK, model call, evaluation or user-agent changes. */
export async function runBot({ base = globalThis.location?.origin, code, playerId, token, onUpdate = () => {} } = {}) {
  if (!base) throw new Error('Provide the game origin as base.');
  const origin = new URL(base);
  if (!['http:', 'https:'].includes(origin.protocol)) throw new Error('Use an HTTP(S) game origin.');
  if ((playerId === undefined) !== (token === undefined)) throw new Error('Provide both playerId and token for an existing seat.');
  if (token !== undefined && !code) throw new Error('Existing seat credentials require a game code.');
  let requests = 0;
  async function request(path, body) {
    if (++requests > 50) throw new Error('Stopped at the 50-request limit. The game may still be active.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(new URL(path, origin), {
        ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
        signal: controller.signal,
      });
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch { throw new Error(`HTTP ${response.status}: ${text.replace(/\s+/g, ' ').slice(0, 240) || 'Non-JSON response'}`); }
      if (!response.ok) {
        if (response.status === 409) return null;
        throw new Error(`HTTP ${response.status}: ${data.error?.message || 'Request failed'}`);
      }
      return data;
    } finally { clearTimeout(timer); }
  }
  function report(type, game, move) {
    onUpdate({ type, code: game.code, version: game.version, state: game.state,
      waitingForPlayers: game.waitingForPlayers, ...(move ? { move } : {}) });
  }
  function choose(game) {
    let best;
    let bestScore = -Infinity;
    for (const move of game.legalMoves) {
      const tile = move.type === 'rest' ? null : game.state.board[move.y * 5 + move.x];
      const score = move.type === 'rest' ? -1 : move.type === 'fortify' ? 0
        : (tile.value + (tile.shrine ? 2 : 0)) * (move.type === 'raid' ? 2 : 1);
      if (score > bestScore) { best = move; bestScore = score; }
    }
    if (!best) throw new Error('The server supplied no legal move for this turn.');
    return best;
  }
  let game;
  if (!code) {
    game = await request('/api/games', { name: 'JavaScript agent', players: 2, bots: 1 });
    code = game.code; playerId = game.playerId; token = game.token;
  } else {
    code = String(code).trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(code)) throw new Error('Use a six-character game code.');
    if (token === undefined) {
      game = await request(`/api/games/${code}/join`, {name:'Agent '+Math.random().toString(36).slice(2,8).toUpperCase()});
      if (!game) throw new Error('No open human seat could be claimed.');
      playerId = game.playerId; token = game.token;
    } else game = await request(`/api/games/${code}`);
  }
  report('ready', game);
  for (let iteration = 0; iteration < 50; iteration++) {
    if (game.state.status === 'finished') { report('finished', game); return game; }
    if (!game.waitingForPlayers && game.state.currentPlayer === playerId) {
      const move = choose(game);
      const next = await request(`/api/games/${code}/moves`, { playerId, token, version: game.version, move });
      if (next) { game = next; report('move', game, move); continue; }
    } else {
      report('waiting', game);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    game = await request(`/api/games/${code}`);
  }
  throw new Error('Stopped after the bounded turn window. The game may still be active.');
}
