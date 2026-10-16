import { createGame, legalMoves, applyMove, botMove, publicState } from './engine.mjs';

const BODY_LIMIT = 16 * 1024;
const TTL = 7 * 24 * 60 * 60 * 1000;
const GAME_CAP = 1000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
class APIError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  } });
}
function randomHex(bytes = 24) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
}
function gameCode() {
  return [...crypto.getRandomValues(new Uint8Array(6))].map(n => CODE_ALPHABET[n % 32]).join('');
}
async function bodyJSON(request) {
  const length = request.headers.get('content-length');
  if (length && Number(length) > BODY_LIMIT) throw new APIError(413, 'body_too_large', 'JSON body exceeds 16 KiB.');
  const reader = request.body?.getReader();
  let size = 0;
  const chunks = [];
  if (reader) while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > BODY_LIMIT) { await reader.cancel(); throw new APIError(413, 'body_too_large', 'JSON body exceeds 16 KiB.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new APIError(400, 'invalid_json', 'Send a JSON object.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new APIError(400, 'invalid_json', 'Send a JSON object.');
  return body;
}
function cleanName(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') throw new APIError(400, 'invalid_name', 'Name must contain 1–28 printable characters.');
  const name = value.trim().normalize('NFC');
  if (!name || [...name].length > 28 || /\p{C}/u.test(name)) throw new APIError(400, 'invalid_name', 'Name must contain 1–28 printable characters.');
  return name;
}
function uniqueName(name, players, skipId = null) {
  const key = name.normalize('NFKC').toLowerCase();
  if (players.some(p => p.id !== skipId && p.name.normalize('NFKC').toLowerCase() === key)) throw new APIError(409, 'name_taken', 'Choose a different player name.');
  return name;
}
function waiting(data) { return data.seats.some(seat => !seat.bot && !seat.claimed); }
function advanceBots(data) {
  if (waiting(data)) return;
  for (let i = 0; i < 32 && data.game.status === 'playing' && data.game.players[data.game.currentPlayer].bot; i++) {
    data.game = applyMove(data.game, botMove(data.game));
  }
}
function view(code, row, data) {
  return { code, version: row.version, state: publicState(data.game),
    legalMoves: waiting(data) ? [] : legalMoves(data.game), waitingForPlayers: waiting(data),
    seatStatus: data.seats.map(seat => ({ playerId: seat.playerId,
      name: data.game.players[seat.playerId].name, bot: seat.bot, claimed: seat.claimed })),
    expiresAt: new Date(row.created_at + TTL).toISOString() };
}
async function readGame(db, code) {
  const row = await db.prepare('SELECT data, version, created_at FROM games WHERE code = ?').bind(code).first();
  if (!row || row.created_at + TTL <= Date.now()) throw new APIError(404, 'game_not_found', 'Game does not exist or has expired.');
  return { row, data: JSON.parse(row.data) };
}
async function saveGame(db, code, row, data) {
  const result = await db.prepare('UPDATE games SET data = ?, version = ? WHERE code = ? AND version = ?')
    .bind(JSON.stringify(data), row.version + 1, code, row.version).run();
  if (result.meta?.changes !== 1) throw new APIError(409, 'version_conflict', 'Game changed. Fetch its latest state before retrying.');
  return { ...row, version: row.version + 1 };
}
function requireVersion(body, row) {
  if (!Number.isInteger(body.version)) throw new APIError(400, 'version_required', 'Send the top-level game version.');
  if (body.version !== row.version) throw new APIError(409, 'version_conflict', 'Game changed. Fetch its latest state before retrying.');
}

/** D1-backed HTTP API; null delegates frontend routes to the caller. */
export async function fetchAPI(request, env) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/')) return null;
  try {
    if (!env?.DB?.prepare) throw new APIError(503, 'storage_unavailable', 'Shared game storage is unavailable.');
    const match = /^\/api\/games(?:\/([A-Za-z2-9]{6})(?:\/(join|moves|bots|replay))?)?\/?$/.exec(path);
    if (!match) throw new APIError(404, 'route_not_found', 'Unknown API route.');
    const db = env.DB;
    const code = match[1]?.toUpperCase();
    const action = match[2];
    if (!code) {
      if (request.method !== 'POST') throw new APIError(405, 'method_not_allowed', 'Create a game with POST.');
      const body = await bodyJSON(request);
      const count = body.players ?? 2;
      const bots = body.bots ?? count - 1;
      if (![2, 3, 4].includes(count) || !Number.isInteger(bots) || bots < 0 || bots > count) throw new APIError(400, 'invalid_players', 'Use 2–4 players and 0–players bots.');
      const humanCount = count - bots;
      const hostName = cleanName(body.name, 'You');
      const players = Array.from({ length: count }, (_, id) => ({
        name: id === 0 && humanCount ? hostName : id < humanCount ? `Player ${id + 1}` : `Bot ${id + 1}`,
        bot: id >= humanCount }));
      for (let i = 1; i < players.length; i++) {
        while (players.slice(0, i).some(p => p.name.normalize('NFKC').toLowerCase() === players[i].name.normalize('NFKC').toLowerCase())) players[i].name += '·';
      }
      const seed = randomHex(12);
      const data = { seed, initialPlayers: players, hostToken: randomHex(),
        seats: players.map((p, playerId) => ({ playerId, bot: p.bot, claimed: p.bot || playerId === 0, token: p.bot ? null : randomHex() })),
        game: createGame({ players, seed }) };
      advanceBots(data);
      const created_at = Date.now();
      await db.prepare('DELETE FROM games WHERE created_at < ?').bind(created_at - TTL).run();
      const total = await db.prepare('SELECT COUNT(*) AS total FROM games').first();
      if (Number(total?.total) >= GAME_CAP) throw new APIError(503, 'game_capacity', 'Game capacity reached. Try again after older games expire.');
      let newCode;
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = gameCode();
        try {
          const result = await db.prepare('INSERT INTO games (code, data, version, created_at) SELECT ?, ?, 0, ? WHERE (SELECT COUNT(*) FROM games) < ?')
            .bind(candidate, JSON.stringify(data), created_at, GAME_CAP).run();
          if (result.meta?.changes !== 1) throw new APIError(503, 'game_capacity', 'Game capacity reached.');
          newCode = candidate; break;
        } catch (error) {
          if (error instanceof APIError) throw error;
          if (!/unique|constraint/i.test(String(error?.message))) throw error;
        }
      }
      if (!newCode) throw new APIError(503, 'create_failed', 'Could not create a game. Try again.');
      const credentials = data.seats.filter(s => !s.bot && s.claimed).map(s => ({ playerId: s.playerId, token: s.token }));
      return json({ ...view(newCode, { version: 0, created_at }, data), hostToken: data.hostToken,
        seats: credentials, credentials, ...(credentials[0] || {}) }, 201);
    }
    const { row, data } = await readGame(db, code);
    if (request.method === 'GET' && !action) return json(view(code, row, data));
    if (request.method === 'GET' && action === 'replay') return json({ rulesVersion: data.game.rulesVersion, code, seed: data.seed,
      players: data.initialPlayers, moves: data.game.moves, state: publicState(data.game) });
    if (request.method !== 'POST' || !['join', 'moves', 'bots'].includes(action)) throw new APIError(405, 'method_not_allowed', 'Method not allowed on this route.');
    const body = await bodyJSON(request);
    if (action === 'join') {
      if (data.game.turn !== 0 || data.game.status !== 'playing') throw new APIError(409, 'game_started', 'This game has already started.');
      const seat = data.seats.find(s => !s.bot && !s.claimed);
      if (!seat) throw new APIError(409, 'game_full', 'No open human seat remains.');
      const name = uniqueName(cleanName(body.name, `Player ${seat.playerId + 1}`), data.game.players, seat.playerId);
      seat.claimed = true;
      data.game.players[seat.playerId].name = name;
      data.initialPlayers[seat.playerId].name = name;
      advanceBots(data);
      const nextRow = await saveGame(db, code, row, data);
      return json({ ...view(code, nextRow, data), playerId: seat.playerId, token: seat.token });
    }
    if (action === 'moves') {
      const seat = data.seats.find(s => s.playerId === body.playerId && !s.bot && s.claimed);
      if (!seat || typeof body.token !== 'string' || body.token !== seat.token) throw new APIError(403, 'invalid_seat', 'Valid player credentials are required.');
      requireVersion(body, row);
      if (waiting(data)) throw new APIError(409, 'waiting_for_players', 'Wait for the remaining human players to join.');
      if (data.game.status !== 'playing') throw new APIError(409, 'game_finished', 'This game is finished.');
      if (data.game.currentPlayer !== seat.playerId) throw new APIError(409, 'not_your_turn', 'Wait for your turn.');
      try { data.game = applyMove(data.game, body.move); }
      catch { throw new APIError(422, 'illegal_move', 'Choose a move from legalMoves.'); }
    } else {
      if (typeof body.hostToken !== 'string' || body.hostToken !== data.hostToken) throw new APIError(403, 'invalid_host', 'Valid host credentials are required.');
      requireVersion(body, row);
    }
    advanceBots(data);
    const nextRow = await saveGame(db, code, row, data);
    return json(view(code, nextRow, data));
  } catch (error) {
    if (error instanceof APIError) return json({ error: { code: error.code, message: error.message } }, error.status);
    return json({ error: { code: 'storage_unavailable', message: 'Game storage is temporarily unavailable.' } }, 503);
  }
}
