/** ISLET rules v1. Pure, dependency-free, deterministic and JSON-serializable. */
export const RULES_VERSION = 'islet-1';
export const BOARD_SIZE = 5;
export const MAX_ROUNDS = 8;
export const ENERGY_CAP = 8;

const clone = value => JSON.parse(JSON.stringify(value));
const indexOf = (x, y) => y * BOARD_SIZE + x;
const adjacent = tile => [[tile.x, tile.y - 1], [tile.x + 1, tile.y], [tile.x, tile.y + 1], [tile.x - 1, tile.y]]
  .filter(([x, y]) => x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE)
  .map(([x, y]) => indexOf(x, y));

function hash(text) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}

function randomSource(seed) {
  let value = hash(seed) || 0x6d2b79f5;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 4294967296;
  };
}

function validatePlayers(players) {
  if (!Array.isArray(players) || players.length < 2 || players.length > 4) {
    throw new TypeError('ISLET requires 2 to 4 players.');
  }
  const names = new Set();
  return players.map((player, id) => {
    if (!player || typeof player !== 'object' || Array.isArray(player) || typeof player.name !== 'string') {
      throw new TypeError('Every player needs a name.');
    }
    const name = player.name.trim().normalize('NFC');
    if (!name || [...name].length > 28 || /\p{C}/u.test(name)) {
      throw new TypeError('Player names must contain 1 to 28 printable characters.');
    }
    const key = name.normalize('NFKC').toLowerCase();
    if (names.has(key)) throw new TypeError('Player names must be unique.');
    names.add(key);
    if (player.bot !== undefined && typeof player.bot !== 'boolean') {
      throw new TypeError('The bot flag must be a boolean.');
    }
    return { id, name, bot: player.bot ?? false, energy: 3 };
  });
}

function validateGame(game) {
  if (!game || game.rulesVersion !== RULES_VERSION || !Array.isArray(game.board) || game.board.length !== 25
    || !Array.isArray(game.players) || game.players.length < 2 || game.players.length > 4
    || !Number.isInteger(game.turn) || game.turn < 0) {
    throw new TypeError('Invalid ISLET game state.');
  }
}

function scoreBoard(game) {
  return game.players.map(player => {
    const tiles = game.board.filter(tile => tile.owner === player.id);
    const shrines = tiles.filter(tile => tile.shrine && !tile.home).length;
    return { playerId: player.id, score: tiles.reduce((sum, tile) => sum + tile.value, 0) + shrines * 2, tiles: tiles.length, shrines };
  });
}

/** Home-connected territory can act. Disconnected ownership still scores. */
function connectedTiles(game, playerId) {
  const connected = new Set();
  const queue = game.board.filter(tile => tile.home && tile.owner === playerId).map(tile => indexOf(tile.x, tile.y));
  for (let q = 0; q < queue.length; q++) {
    const index = queue[q];
    if (connected.has(index)) continue;
    connected.add(index);
    for (const next of adjacent(game.board[index])) {
      if (!connected.has(next) && game.board[next].owner === playerId) queue.push(next);
    }
  }
  return connected;
}

function moveCost(game, move) {
  if (move.type === 'rest') return 0;
  const tile = game.board[indexOf(move.x, move.y)];
  return move.type === 'grow' ? tile.cost : move.type === 'raid' ? 2 + tile.fort : 1;
}

function canonicalMove(move) {
  if (!move || typeof move !== 'object' || Array.isArray(move)) throw new TypeError('A move must be an object.');
  if (!['grow', 'fortify', 'raid', 'rest'].includes(move.type)) throw new TypeError('Unknown move type.');
  const keys = move.type === 'rest' ? ['type'] : ['type', 'x', 'y'];
  if (Object.keys(move).some(key => !keys.includes(key))) throw new TypeError('Unexpected move fields.');
  if (move.type === 'rest') return { type: 'rest' };
  if (!Number.isInteger(move.x) || !Number.isInteger(move.y) || move.x < 0 || move.x >= BOARD_SIZE || move.y < 0 || move.y >= BOARD_SIZE) {
    throw new TypeError('Move coordinates must be integers between 0 and 4.');
  }
  return { type: move.type, x: move.x, y: move.y };
}

/** Start turn energy is already included in the returned current player's energy. */
export function createGame({ players, seed = 'islet' } = {}) {
  const seats = validatePlayers(players);
  if (!((typeof seed === 'string' && seed.length >= 1 && seed.length <= 128)
    || (typeof seed === 'number' && Number.isSafeInteger(seed)))) {
    throw new TypeError('Seed must be a nonempty string of at most 128 characters or a safe integer.');
  }
  const normalizedSeed = String(seed);
  const random = randomSource(normalizedSeed);
  const terrainByOrbit = new Map();
  const board = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      // Reflections and quarter rotations have the same terrain.
      const orbit = [Math.min(x, 4 - x), Math.min(y, 4 - y)].sort((a, b) => a - b).join(',');
      if (!terrainByOrbit.has(orbit)) terrainByOrbit.set(orbit, random() < 0.32 ? 'reef' : 'grass');
      const corner = (x === 0 || x === 4) && (y === 0 || y === 4);
      const terrain = corner ? 'grass' : terrainByOrbit.get(orbit);
      const value = terrain === 'reef' ? 2 : 1;
      const shrine = (x === 2 && [0, 2, 4].includes(y)) || (y === 2 && [0, 4].includes(x));
      board.push({ x, y, terrain, cost: value, value, owner: null, fort: 0, home: false, shrine });
    }
  }
  const rotation = Math.floor(random() * 4);
  const seatOffset = Math.floor(random() * seats.length);
  const corners = [[0, 0], [4, 4], [4, 0], [0, 4]];
  seats.forEach((player, seat) => {
    let [x, y] = corners[(seat + seatOffset) % seats.length];
    for (let r = 0; r < rotation; r++) [x, y] = [4 - y, x];
    const tile = board[indexOf(x, y)];
    tile.owner = player.id;
    tile.home = true;
  });
  const startPlayer = Math.floor(random() * seats.length);
  seats[startPlayer].energy = 4;
  const game = {
    rulesVersion: RULES_VERSION, version: 0, seed: normalizedSeed,
    turn: 0, round: 1, maxRounds: MAX_ROUNDS, maxTurns: MAX_ROUNDS * seats.length,
    startPlayer, currentPlayer: startPlayer, status: 'playing',
    players: seats, board, scores: [], winners: [], moves: [], log: [],
  };
  game.scores = scoreBoard(game);
  return game;
}

/** Exhaustive canonical action list, in board order, followed by rest. */
export function legalMoves(game) {
  validateGame(game);
  if (game.status === 'finished') return [];
  const playerId = game.currentPlayer;
  const player = game.players[playerId];
  if (!player || game.status !== 'playing') throw new TypeError('Invalid current player.');
  const connected = connectedTiles(game, playerId);
  const result = [];
  for (let index = 0; index < game.board.length; index++) {
    const tile = game.board[index];
    const neighbors = adjacent(tile);
    const ownAdjacent = neighbors.filter(next => connected.has(next)).length;
    if (tile.owner === null && ownAdjacent > 0 && player.energy >= tile.cost) {
      result.push({ type: 'grow', x: tile.x, y: tile.y });
    } else if (tile.owner === playerId && !tile.home && connected.has(index) && tile.fort < 2 && player.energy >= 1) {
      result.push({ type: 'fortify', x: tile.x, y: tile.y });
    } else if (tile.owner !== null && tile.owner !== playerId && !tile.home && ownAdjacent > 0) {
      const enemyAdjacent = neighbors.filter(next => game.board[next].owner === tile.owner).length;
      if (ownAdjacent > enemyAdjacent + tile.fort && player.energy >= 2 + tile.fort) {
        result.push({ type: 'raid', x: tile.x, y: tile.y });
      }
    }
  }
  result.push({ type: 'rest' });
  return result;
}

/** One action, no mutation, then next player's beginning-of-turn +1 energy. */
export function applyMove(game, move) {
  validateGame(game);
  if (game.status !== 'playing') throw new Error('The game is finished.');
  const action = canonicalMove(move);
  const legal = legalMoves(game).some(candidate => candidate.type === action.type
    && (action.type === 'rest' || (candidate.x === action.x && candidate.y === action.y)));
  if (!legal) throw new Error('Illegal move: check energy, home connection, ownership, or raid superiority.');
  const next = clone(game);
  // publicState may have supplied its derived legalMoves array; never carry a stale copy.
  delete next.legalMoves;
  const actor = next.players[game.currentPlayer];
  const energyBefore = actor.energy;
  const cost = moveCost(game, action);
  let capturedFrom = null;
  if (action.type === 'rest') {
    actor.energy = Math.min(ENERGY_CAP, actor.energy + 2);
  } else {
    actor.energy -= cost;
    const target = next.board[indexOf(action.x, action.y)];
    if (action.type === 'fortify') target.fort++;
    else {
      capturedFrom = target.owner;
      target.owner = actor.id;
      target.fort = 0;
    }
  }
  next.turn++;
  next.version++;
  next.scores = scoreBoard(next);
  next.moves.push(action);
  next.log.push({
    turn: next.turn, round: game.round, playerId: actor.id, playerName: actor.name,
    move: clone(action), cost, energyBefore, energyAfter: actor.energy,
    capturedFrom, scoresBefore: clone(game.scores), scores: clone(next.scores),
  });
  if (next.turn >= next.maxTurns) {
    next.status = 'finished';
    next.currentPlayer = null;
    next.round = MAX_ROUNDS;
    const highest = Math.max(...next.scores.map(score => score.score));
    next.winners = next.scores.filter(score => score.score === highest).map(score => score.playerId);
  } else {
    next.currentPlayer = (next.startPlayer + next.turn) % next.players.length;
    next.round = Math.floor(next.turn / next.players.length) + 1;
    const incoming = next.players[next.currentPlayer];
    incoming.energy = Math.min(ENERGY_CAP, incoming.energy + 1);
  }
  return next;
}

/** Transparent sample heuristic. It only selects a move from legalMoves(). */
export function botMove(game) {
  const moves = legalMoves(game);
  if (moves.length === 0) return null;
  const actor = game.players[game.currentPlayer];
  const turnsRemaining = MAX_ROUNDS - Math.floor(game.turn / game.players.length);
  let best = moves[0];
  let bestScore = -Infinity;
  for (const move of moves) {
    let score = move.type === 'rest' ? (actor.energy < 2 && turnsRemaining > 1 ? 2 : -2) : 0;
    if (move.type !== 'rest') {
      const tile = game.board[indexOf(move.x, move.y)];
      const neighbors = adjacent(tile);
      if (move.type === 'grow' || move.type === 'raid') {
        const value = tile.value + (tile.shrine ? 2 : 0);
        score = value * (move.type === 'raid' ? 2 : 1) + 1;
        score += (4 - Math.abs(2 - tile.x) - Math.abs(2 - tile.y)) * 0.14;
        score += neighbors.filter(i => game.board[i].owner === null).length * (turnsRemaining > 2 ? 0.15 : 0);
        score -= moveCost(game, move) * 0.18;
      } else {
        const threats = neighbors.filter(i => game.board[i].owner !== null && game.board[i].owner !== actor.id).length;
        score = threats > 0 ? 0.4 + threats * 0.2 + (tile.shrine ? 0.4 : 0) : -1;
        if (turnsRemaining === 1) score = -1.5;
      }
    }
    // Small seeded tie-break; never randomness or external state.
    score += (hash(`${game.seed}:${game.turn}:${JSON.stringify(move)}`) % 1000) / 1000000;
    if (score > bestScore) { bestScore = score; best = move; }
  }
  return clone(best);
}

/** Every field is public; return a defensive copy and the exhaustive legal list. */
export function publicState(game) {
  validateGame(game);
  return { ...clone(game), legalMoves: legalMoves(game) };
}

/** Rebuild a game from its normalized seed, initial seats, and canonical moves. */
export function replay(seed, players, moves) {
  if (!Array.isArray(moves)) throw new TypeError('Replay moves must be an array.');
  let game = createGame({ seed, players });
  for (let i = 0; i < moves.length; i++) {
    try { game = applyMove(game, moves[i]); }
    catch (error) { throw new Error(`Invalid replay move ${i + 1}: ${error.message}`); }
  }
  return game;
}
