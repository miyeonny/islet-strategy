# ISLET

Play: https://islet-strategy-miyeonny.apt-pond-6694.chatgpt.site

Created by a disclosed AI coding assistant for GitHub user miyeonny. Island art was generated with the built-in image tool. No model API is needed to play.

A turn-based territory game for 2–4 humans or agents. Grow from your home, claim valuable reefs and shrines, fortify a frontier, and raid when your connected territory has local superiority. Eight rounds decide the winner. Every game has a deterministic seed and an auditable action log.

Play solo against built-in bots, create an invite game, share its six-character code, or watch a complete bot match. All rule decisions happen on the server using the same pure engine that powers replay.

## Run locally

Node 20+ is sufficient; no runtime npm dependencies are needed.

```sh
node preview.mjs
```

Open `http://127.0.0.1:4173`. The local preview uses shared in-memory storage, allowing multiple tabs to play together; games reset when the process stops. Production needs a D1 database bound as `DB`. The Sites artifact contains the equivalent schema migration in `drizzle/0000_games.sql` and its journal, applied by the hosting migration workflow before publishing. For another SQLite/D1 host, use `migrations/0001_games.sql`. Missing storage produces a clear API error.

## External agents

The HTTP API exposes state, legal actions, private seat authentication, atomic versioned moves and replay JSON. See [docs/API.md](docs/API.md). Run a complete match with the dependency-free Python example:

```sh
python3 examples/bot.py http://127.0.0.1:4173
```

Use `--code`, `--player`, and `--token` to drive a human seat you own. The sample chooses only server-listed legal actions and refreshes state after concurrent updates. Invite codes permit spectating or claiming an open seat; seat credentials remain private.

## Rules and implementation

- The 5×5 island has seeded symmetric grass and reefs, protected corner homes and five shrines.
- Each turn restores one energy; grow spends tile cost, fortify spends one, raid spends two plus target fortification. Rest restores two extra energy. Energy caps at eight.
- Growth and attacks need a connection to home. A raid needs more adjacent connected friendly tiles than defending neighbors plus fortification. Homes cannot be captured.
- Owned tiles score terrain value; each shrine adds two points. Most points after eight rounds wins; tied players share victory.
- `engine.mjs` is deterministic and immutable. `api.mjs` stores private game envelopes in D1 using compare-and-swap. Games expire after seven days; capacity and request sizes are bounded.

`worker/index.js` serves the frontend and API. The build bundles source into a dependency-free Worker module for Sites. Browsers and agents use the same API.

## Verification

Engine tests include complete seeded bot matches and exact replay across two to four seats. API checks cover authentication, stale versions, concurrent updates, body limits and expiry. Browser QA exercised quick play, live moves, replay, three human seats and a 390px mobile viewport.

```sh
node --test tests/engine.test.mjs
node scripts/build.mjs
node scripts/validate-artifact.mjs
```
