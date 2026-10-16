#!/usr/bin/env python3
"""Dependency-free agent: python3 examples/bot.py http://127.0.0.1:4173
Or use --code ABC234 --player 0 --token YOUR_TOKEN for a human seat you own.
"""
import argparse
import json
import time
import urllib.error
import urllib.request


def call(base, path, payload=None):
    request = urllib.request.Request(base.rstrip('/') + path,
        data=None if payload is None else json.dumps(payload).encode(),
        headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        text = error.read(4096).decode('utf-8', errors='replace')
        if error.code == 409:
            return None  # Poll fresh state; never replay a stale action blindly.
        try:
            message = json.loads(text).get('error', {}).get('message', text)
        except (ValueError, AttributeError):
            message = ' '.join(text.split())[:500] or str(error.reason)
        raise RuntimeError(f'HTTP {error.code}: {message}') from error


def choose(game):
    def value(move):
        if move['type'] == 'rest':
            return -1
        tile = game['state']['board'][move['y'] * 5 + move['x']]
        return ((tile['value'] + (2 if tile['shrine'] else 0)) *
                (2 if move['type'] == 'raid' else 1)
                if move['type'] != 'fortify' else 0)
    return max(game['legalMoves'], key=value)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('base')
    parser.add_argument('--code')
    parser.add_argument('--player', type=int)
    parser.add_argument('--token')
    args = parser.parse_args()
    if args.code and (args.player is None or not args.token):
        parser.error('--code requires --player and --token')
    if not args.code:
        game = call(args.base, '/api/games', {'name': 'Python agent', 'players': 2, 'bots': 1})
        args.code, args.player, args.token = game['code'], game['playerId'], game['token']
        print('Created game', args.code, '(seat token kept private)')
    for _ in range(900):  # Bound waiting to 15 minutes; solo games finish much sooner.
        game = call(args.base, '/api/games/' + args.code)
        if game['state']['status'] == 'finished':
            print(json.dumps({'code': args.code, 'scores': game['state']['scores'],
                              'winners': game['state']['winners']}, indent=2))
            return
        if not game['waitingForPlayers'] and game['state']['currentPlayer'] == args.player:
            move = choose(game)
            result = call(args.base, '/api/games/' + args.code + '/moves', {
                'playerId': args.player, 'token': args.token, 'version': game['version'], 'move': move})
            if result is not None:
                print('Turn', result['state']['turn'], move)
        else:
            time.sleep(1)
    raise SystemExit('Stopped after bounded polling window; game may still be active.')


if __name__ == '__main__':
    try:
        main()
    except RuntimeError as error:
        raise SystemExit(str(error)) from None
