import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, legalMoves, applyMove, botMove, publicState, replay } from '../engine.mjs';

const seats = count => Array.from({ length: count }, (_, id) => ({ name: `Player ${id + 1}`, bot: true }));
const tileAt = (game, x, y) => game.board[y * 5 + x];
const copy = value => JSON.parse(JSON.stringify(value));
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const item of Object.values(value)) freeze(item);
  }
  return value;
}
function atOwnTurn(game, playerId) {
  while (game.status === 'playing' && game.currentPlayer !== playerId) game = applyMove(game, { type: 'rest' });
  return game;
}
function fixture() {
  const game = createGame({ players: seats(2), seed: 'raid-fixture' });
  const attacker = game.currentPlayer;
  const defender = 1 - attacker;
  for (const tile of game.board) Object.assign(tile, { owner: null, fort: 0, home: false });
  Object.assign(tileAt(game, 0, 0), { owner: attacker, home: true });
  Object.assign(tileAt(game, 4, 4), { owner: defender, home: true });
  for (const [x, y] of [[1, 0], [1, 1], [1, 2], [2, 1]]) tileAt(game, x, y).owner = attacker;
  for (const [x, y] of [[2, 2], [3, 2], [4, 2], [4, 3]]) tileAt(game, x, y).owner = defender;
  game.players[attacker].energy = 8;
  return { game, attacker, defender };
}

test('validates seats, names, bot flags, and seed without coercion', () => {
  for (const count of [0, 1, 5]) assert.throws(() => createGame({ players: seats(count) }), /2 to 4/);
  for (const name of ['', ' ', 'x'.repeat(29), 'a\nb', 'a\u0000b']) {
    assert.throws(() => createGame({ players: [{ name }, { name: 'Other' }] }), /names/);
  }
  assert.throws(() => createGame({ players: [{ name: 'ALICE' }, { name: ' alice ' }] }), /unique/);
  assert.throws(() => createGame({ players: [{ name: 'A', bot: 'true' }, { name: 'B' }] }), /boolean/);
  assert.throws(() => createGame({ players: seats(2), seed: {} }), /Seed/);
  assert.throws(() => createGame({ players: seats(2), seed: Infinity }), /Seed/);
  const game = createGame({ players: [{ name: ' A ' }, { name: 'B' }], seed: 7 });
  assert.equal(game.players[0].name, 'A');
  assert.equal(game.seed, '7');
});

test('terrain is symmetric, two homes are opposite, and first turn already has +1 energy', () => {
  for (const seed of ['alpha', 'beta', 'gamma', 'delta', 'epsilon']) {
    const game = createGame({ players: seats(2), seed });
    assert.equal(game.board.length, 25);
    assert.equal(game.board.filter(tile => tile.shrine).length, 5);
    const homes = game.board.filter(tile => tile.home);
    assert.equal(homes.length, 2);
    assert.equal(homes[0].x + homes[1].x, 4);
    assert.equal(homes[0].y + homes[1].y, 4);
    for (const tile of game.board) {
      assert.equal(tile.terrain, tileAt(game, 4 - tile.y, tile.x).terrain);
      assert.equal(tile.cost, tileAt(game, 4 - tile.x, tile.y).cost);
    }
    for (const player of game.players) assert.equal(player.energy, player.id === game.currentPlayer ? 4 : 3);
    assert.deepEqual(game.scores.map(score => score.score), [1, 1]);
    assert.deepEqual(game, createGame({ players: seats(2), seed }));
  }
});

test('grow pays terrain cost, next turn gains energy, and transition does not mutate input', () => {
  const game = createGame({ players: seats(3), seed: 'growth' });
  const before = copy(game);
  const actor = game.currentPlayer;
  const move = legalMoves(game).find(move => move.type === 'grow');
  const cost = tileAt(game, move.x, move.y).cost;
  freeze(game);
  const next = applyMove(game, move);
  assert.deepEqual(game, before);
  assert.equal(tileAt(next, move.x, move.y).owner, actor);
  assert.equal(next.players[actor].energy, 4 - cost);
  assert.equal(next.players[next.currentPlayer].energy, 4);
  assert.equal(next.version, 1);
  assert.equal(next.turn, 1);
  assert.equal(next.round, 1);
  assert.equal(next.scores[actor].score, 1 + tileAt(next, move.x, move.y).value);
  assert.equal(next.log[0].cost, cost);
  assert.deepEqual(next.moves, [move]);
});

test('illegal moves and malformed payloads fail without changing state', () => {
  const game = createGame({ players: seats(2), seed: 'illegal' });
  const before = copy(game);
  const invalid = [null, [], {}, { type: 'teleport' }, { type: 'grow', x: -1, y: 0 },
    { type: 'grow', x: 1.5, y: 0 }, { type: 'grow', x: '0', y: 0 },
    { type: 'rest', x: 0 }, { type: 'rest', owner: 1 }, { type: 'grow', x: 2, y: 2 }];
  for (const move of invalid) assert.throws(() => applyMove(game, move));
  const enemyHome = game.board.find(tile => tile.home && tile.owner !== game.currentPlayer);
  assert.throws(() => applyMove(game, { type: 'raid', x: enemyHome.x, y: enemyHome.y }), /Illegal/);
  assert.deepEqual(game, before);
});

test('fortification caps at two, costs energy, and never adds score', () => {
  let game = createGame({ players: seats(2), seed: 'fortify' });
  const actor = game.currentPlayer;
  const grow = legalMoves(game).find(move => move.type === 'grow');
  game = atOwnTurn(applyMove(game, grow), actor);
  const score = game.scores[actor].score;
  const fortify = { type: 'fortify', x: grow.x, y: grow.y };
  for (const fort of [1, 2]) {
    const energy = game.players[actor].energy;
    game = applyMove(game, fortify);
    assert.equal(tileAt(game, grow.x, grow.y).fort, fort);
    assert.equal(game.players[actor].energy, energy - 1);
    assert.equal(game.scores[actor].score, score);
    game = atOwnTurn(game, actor);
  }
  assert.throws(() => applyMove(game, fortify), /Illegal/);
  const home = game.board.find(tile => tile.home && tile.owner === actor);
  assert.throws(() => applyMove(game, { type: 'fortify', x: home.x, y: home.y }), /Illegal/);
});

test('raid requires strict flanking superiority and pays the fortification cost', () => {
  const { game, attacker, defender } = fixture();
  const raid = { type: 'raid', x: 2, y: 2 };
  // Two attackers versus one defender permits a raid, but fort 1 makes a tie.
  assert(legalMoves(game).some(move => JSON.stringify(move) === JSON.stringify(raid)));
  tileAt(game, 2, 2).fort = 1;
  assert.throws(() => applyMove(game, raid), /Illegal/);
  // Three connected attackers beat one defender plus fort 1.
  tileAt(game, 1, 3).owner = attacker;
  tileAt(game, 2, 3).owner = attacker;
  const captured = applyMove(game, raid);
  assert.equal(tileAt(captured, 2, 2).owner, attacker);
  assert.equal(tileAt(captured, 2, 2).fort, 0);
  assert.equal(captured.players[attacker].energy, 5);
  assert.equal(captured.log.at(-1).capturedFrom, defender);
  assert.equal(captured.log.at(-1).cost, 3);
  game.players[attacker].energy = 2;
  assert.throws(() => applyMove(game, raid), /Illegal/);
  game.players[attacker].energy = 8;
  tileAt(game, 2, 2).fort = 2;
  assert.throws(() => applyMove(game, raid), /Illegal/);
});

test('disconnected tiles cannot act or support raids; disconnected defenders still support', () => {
  const { game, attacker, defender } = fixture();
  tileAt(game, 1, 0).owner = null;
  // All the attacker tiles other than home are now disconnected.
  assert(!legalMoves(game).some(move => move.type === 'raid'));
  assert(!legalMoves(game).some(move => move.type === 'fortify'));
  assert(!legalMoves(game).some(move => move.type === 'grow' && move.x === 1 && move.y === 3));
  tileAt(game, 1, 0).owner = attacker;
  tileAt(game, 4, 3).owner = null;
  tileAt(game, 2, 2).fort = 1;
  // Defender's one adjacent tile counts even without a path to its home.
  assert.throws(() => applyMove(game, { type: 'raid', x: 2, y: 2 }), /Illegal/);
  const next = applyMove(game, { type: 'rest' });
  assert.equal(next.scores[defender].tiles, game.board.filter(tile => tile.owner === defender).length);
});

test('shrines add two, ownership values score, rest respects the energy cap', () => {
  let game = createGame({ players: seats(2), seed: 'shrine' });
  const actor = game.currentPlayer;
  const home = game.board.find(tile => tile.home && tile.owner === actor);
  // A legal path from the corner to the midpoint of its horizontal edge.
  const x1 = home.x === 0 ? 1 : 3;
  game = applyMove(game, { type: 'grow', x: x1, y: home.y });
  game = atOwnTurn(game, actor);
  game = applyMove(game, { type: 'grow', x: 2, y: home.y });
  const owned = game.board.filter(tile => tile.owner === actor);
  assert.equal(game.scores[actor].shrines, 1);
  assert.equal(game.scores[actor].score, owned.reduce((sum, tile) => sum + tile.value, 0) + 2);
  game.players[game.currentPlayer].energy = 8;
  const resting = game.currentPlayer;
  const next = applyMove(game, { type: 'rest' });
  assert.equal(next.players[resting].energy, 8);
});

test('every player gets exactly eight turns; tied leaders share victory', () => {
  for (const count of [2, 3, 4]) {
    let game = createGame({ players: seats(count), seed: `termination-${count}` });
    for (let turn = 0; turn < count * 8; turn++) {
      assert.equal(game.status, 'playing');
      assert.equal(game.round, Math.floor(turn / count) + 1);
      game = applyMove(game, { type: 'rest' });
    }
    assert.equal(game.status, 'finished');
    assert.equal(game.currentPlayer, null);
    assert.equal(game.version, count * 8);
    assert.equal(game.round, 8);
    assert.deepEqual(game.winners, seats(count).map((_, id) => id));
    assert.deepEqual(legalMoves(game), []);
    assert.equal(botMove(game), null);
    assert.throws(() => applyMove(game, { type: 'rest' }), /finished/);
    for (let id = 0; id < count; id++) assert.equal(game.log.filter(row => row.playerId === id).length, 8);
  }
});

test('full seeded bot matches are legal, bounded and exactly replayable for 2–4 players', () => {
  for (const count of [2, 3, 4]) {
    for (let sample = 0; sample < 20; sample++) {
      const players = seats(count);
      const seed = `bot-${count}-${sample}`;
      let game = createGame({ players, seed });
      while (game.status === 'playing') {
        const before = copy(game);
        const move = botMove(game);
        assert.deepEqual(botMove(game), move);
        assert(legalMoves(game).some(candidate => JSON.stringify(candidate) === JSON.stringify(move)));
        game = applyMove(game, move);
        assert(game.players.every(player => player.energy >= 0 && player.energy <= 8));
        assert.equal(before.turn + 1, game.turn);
      }
      assert.equal(game.turn, count * 8);
      assert.deepEqual(replay(seed, players, game.moves), game);
      const snapshot = publicState(game);
      assert.deepEqual(snapshot.legalMoves, []);
      snapshot.board[0].owner = 999;
      assert.notEqual(game.board[0].owner, 999);
      assert.deepEqual(JSON.parse(JSON.stringify(game)), game);
    }
  }
});

test('public state can be played and corrupt replay fails at the precise move', () => {
  const game = createGame({ players: seats(2), seed: 'public' });
  const state = publicState(game);
  const move = botMove(state);
  assert.deepEqual(applyMove(state, move), applyMove(game, move));
  assert.throws(() => replay('public', seats(2), [move, { type: 'grow', x: 2, y: 2 }]), /move 2/);
  assert.throws(() => replay('public', seats(2), null), /array/);
});
