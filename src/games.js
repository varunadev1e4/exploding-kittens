// Registry of games. Each one provides a pure rules engine; the shared Room handles lobby, presence and
// disconnects for every game. To add a game: write an engine (reduce/newLobby/blockerId), a Board component,
// then register both here and in Room.jsx's BOARDS map.
import * as ek from './engine.js';
import * as uno from './uno/engine.js';
import * as cat from './cat/engine.js';
import * as flip7 from './flip7/engine.js';
import * as coup from './coup/engine.js';

export const GAMES = {
  ek: {
    id: 'ek', title: 'Exploding Kittens', emoji: '💣', max: ek.MAX_PLAYERS,
    newLobby: ek.newLobby, reduce: ek.reduce, blockerId: ek.blockerId,
    lobbyNote: (n) => `${n}/${ek.MAX_PLAYERS} players · ${ek.decksFor(n) === 1 ? 'one deck (6 or more players combine two decks)' : 'two decks combined'}`,
    options: [{
      label: 'Faster game (removes a third of the deck, recommended for 2–3 players)',
      get: (s) => s.fast, set: (v) => ({ type: 'setFast', value: v }),
    }],
  },
  uno: {
    id: 'uno', title: 'Uno', emoji: '🎴', max: uno.MAX_PLAYERS,
    newLobby: uno.newLobby, reduce: uno.reduce, blockerId: uno.blockerId,
    lobbyNote: (n) => `${n}/${uno.MAX_PLAYERS} players · first to ${uno.TARGET} points wins the match`,
    options: [],
  },
  cat: {
    id: 'cat', title: 'Cat in the Box', emoji: '📦', max: cat.MAX_PLAYERS,
    newLobby: cat.newLobby, reduce: cat.reduce, blockerId: cat.blockerId,
    lobbyNote: (n) => `${n}/${cat.MAX_PLAYERS} players (2–5) · ${Math.max(n, 2)} rounds, everyone starts once`,
    options: [],
  },
  flip7: {
    id: 'flip7', title: 'Flip 7', emoji: '🔢', max: flip7.MAX_PLAYERS,
    newLobby: flip7.newLobby, reduce: flip7.reduce, blockerId: flip7.blockerId,
    lobbyNote: (n) => `${n}/${flip7.MAX_PLAYERS} players · first to ${flip7.TARGET} points (the rulebook says 3+ players, 2 also works)`,
    options: [],
  },
  coup: {
    id: 'coup', title: 'Coup', emoji: '👑', max: coup.MAX_PLAYERS,
    newLobby: coup.newLobby, reduce: coup.reduce, blockerId: coup.blockerId,
    lobbyNote: (n) => `${n}/${coup.MAX_PLAYERS} players · bluff, challenge and be the last player with influence`,
    options: [],
  },
};

export const gameOf = (state) => GAMES[state?.game || 'ek'];
