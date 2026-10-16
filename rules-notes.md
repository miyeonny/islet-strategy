# ISLET rules version 1

The state and actions contain only JSON values. Player IDs are their zero-based seat indices. `version` and `turn` both start at zero and increase after every accepted action. The API can compare the submitted version before calling `applyMove`. Illegal actions throw and leave the original state unchanged.

The 5×5 map uses terrain symmetric under rotations and reflections. Grass costs 1 energy and scores 1; reefs cost 2 and score 2. Each player owns one indestructible corner home, worth 1 point. Two players always start at opposite corners. The seed determines terrain, corner rotation, seat placement and first player. With three players the missing fourth home makes the occupied corners inherently asymmetric; the seed rotates the placement and assigns seats. No procedural map or turn order claims competitive balance.

There are five shrines: the center and the midpoint of each edge, identified by `tile.shrine`. Each owned shrine adds 2 points. Fortification provides defense only and adds no points. All owned tiles score, including disconnected territory.

All players begin with 3 energy, capped at 8. The player about to act receives +1 at the start of their turn, including the first turn. Therefore `createGame` gives the first player 4 energy and all others 3. Returned states already include the next player's start-of-turn energy.

Each player gets eight turns and takes one action per turn:

- **Grow:** pay a neutral tile's terrain cost to claim it. It must border your home-connected territory orthogonally.
- **Fortify:** pay 1 to increase a home-connected, owned, non-home tile's fortification, to a maximum of 2.
- **Raid:** pay `2 + target.fort` to capture an enemy non-home tile. Count your orthogonally adjacent home-connected tiles and the defender's orthogonally adjacent owned tiles. A raid requires your count to be strictly greater than `defender count + target.fort`. Defender neighbors count even if disconnected. Thus a lone border cannot break an equally supported tile; a flank can. A captured tile's fortification resets to 0.
- **Rest:** recover 2 energy, up to the cap.

Home-connected territory is the orthogonally connected component containing your home. Isolated tiles cannot grow, fortify or support a raid until reconnected. They still score and still count as a defender's adjacent support. Homes cannot be fortified, raided or destroyed.

After the final action, the highest score wins and every tied leader is a shared winner. There are no eliminations, hidden resources, time-based rules, external randomness or network dependencies. `legalMoves` lists every action available to the current player, then rest; a finished game returns an empty list. `botMove` is a deterministic sample heuristic restricted to that list. The move log records actor, action, cost, energy and before/after scores. Replaying seed, initial player names/bot flags and `moves` reproduces the full state.
