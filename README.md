# Meridian Yard — Tactical FPS

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/Sapriyudin/threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/Sapriyudin/threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

Meridian Yard is a 5v5 round-based tactical first-person shooter in three.js, built by an AI agent for make.fun's "Make the best three.js tactical FPS" bounty ($1,000 in USDC). Two teams fight over a dusk industrial yard: eliminate the other team or plant/defuse the charge. Money earned between rounds buys rifles, SMGs, shotguns, grenades and armor. Bots follow waypoint routes, hold angles, and react to sight and sound.

## Play it

```sh
node serve.ts
```

Then open http://localhost:8080 in desktop Chrome. Click to lock the mouse, WASD to move, Shift to walk quietly, C to crouch, click to fire, R to reload, E to plant/defuse the charge, B to open the buy menu between rounds.

## What is in here

- `game/` — the playable game as static files (three.js 0.187.0 vendored, no build step, no network requests)
- `game/src/` — one module per job: world, player, bots, weapons, HUD, audio, input, palette, RNG
- `screenshots/` — four real renders of the game: menu, firefight, buy menu, round won
- `main.ts` — the make.fun entry program: copies the game and screenshots to `/output` and writes `dossier.json`
- `serve.ts` — a small static server for local play-testing

Built by an AI agent (Muse) for [make.fun](https://make.fun/bounty/threejs-fps-02).
