# ISLET HTTP API

All routes use JSON; POST bodies are limited to 16 KiB. There is no account, wallet, arbitrary code execution or external fetch route.

Try the same-origin browser agent at `/agent-demo`; its source is `/bot.mjs` (repository: `examples/bot.mjs`). Import `runBot` and call `await runBot({base: location.origin})` to create and play a two-player game. Pass `code` to claim an open human seat, or `code`, `playerId` and `token` to drive a seat you own. `onUpdate(event)` receives public state and actions. The deterministic sample uses standard browser fetch, stops after at most 50 requests, and limits each request to ten seconds.

The public browser workflow is verified. Python's standard-library client was rejected by the public host with HTTP 403 / Cloudflare 1010 in this environment; it reports that response and stops. Other external clients' compatibility is unverified. The local Python example is verified against `preview.mjs`.

`POST /api/games` accepts `{ "name": "Ada", "players": 2, "bots": 1 }`. Defaults: two players and one bot. Bots occupy the last seats. Zero bots creates an invite game; bots equal to players runs a complete bot match. HTTP 201 returns the standard response plus `hostToken`, `seats`/`credentials` (issued human credentials), and host `playerId`/`token` when there is a human host. Only the host seat token is issued at creation. Keep tokens private.

`GET /api/games/ABC234` returns `{code, version, state, legalMoves, waitingForPlayers, seatStatus, expiresAt}`. `state` contains all public board tiles, players, energy, scores, log and winners. `seatStatus` contains `{playerId,name,bot,claimed}` without tokens. The top-level `version` is the storage revision for concurrency; `state.version` counts engine turns and may differ. While waiting for humans, top-level `legalMoves` is empty and moves cannot be submitted.

`POST /api/games/ABC234/join` with `{ "name": "Lin" }` claims one open human seat before play starts. Returns the standard response plus `playerId` and `token`. An invite code permits claiming an open seat or spectating; tokens cannot be recovered through public routes.

`POST /api/games/ABC234/moves` accepts:

```json
{
  "playerId": 0,
  "token": "YOUR_PRIVATE_SEAT_TOKEN",
  "version": 2,
  "move": { "type": "grow", "x": 1, "y": 0 }
}
```

Choose from the latest response's top-level `legalMoves`. `grow`, `fortify` and `raid` use integer coordinates 0–4; `rest` has only `type`. The authoritative server validates every action. Bots advance automatically after creation, the final human join and each human move, stopping at the next human turn. Responses never reveal tokens.

`POST /api/games/ABC234/bots` accepts `{ "hostToken": "…", "version": 2 }` and advances pending built-in bot turns. It cannot act for human seats. Normal clients do not need it.

`GET /api/games/ABC234/replay` returns `{rulesVersion, code, seed, players, moves, state}` without credentials. Reproduce it using `replay(seed, players, moves)` from `engine.mjs`.

Errors use `{ "error": { "code": "version_conflict", "message": "…" } }`. HTTP 400: malformed input; 403: invalid credentials; 404: unknown/expired game; 409: stale state or turn/seat conflict; 413: oversized body; 422: illegal action; 503: unavailable storage/capacity. On 409 fetch fresh state and reconsider the action. D1 compare-and-swap makes concurrent writes atomic. Games last at most 32 engine actions, expire after seven days and have a 1,000 active game cap. Expired rows are pruned on creation.

Production needs D1 bound as `DB`, with `migrations/0001_games.sql` applied through the host's migration workflow. The API never creates tables on requests and returns 503 if storage/schema is missing. `preview.mjs` uses explicitly local in-memory storage that resets on restart.
