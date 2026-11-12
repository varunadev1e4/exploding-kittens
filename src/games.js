// Registry of games. Each one provides a pure rules engine; the shared Room handles lobby, presence and
// disconnects for every game. To add a game: write an engine (reduce/newLobby/blockerId), a Board component,
// then register both here and in Room.jsx's BOARDS map.
import * as ek from './engine.js';
import * as uno from './uno/engine.js';
import * as cat from './cat/engine.js';
import * as flip7 from './flip7/engine.js';
import * as coup from './coup/engine.js';
import * as cardia from './cardia/engine.js';

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
  cardia: {
    id: 'cardia', title: 'Duel for Cardia', emoji: '🏰', max: cardia.MAX_PLAYERS,
    newLobby: cardia.newLobby, reduce: cardia.reduce, blockerId: cardia.blockerId,
    lobbyNote: (n) => `${n}/${cardia.MAX_PLAYERS} players (exactly 2) · first to ${cardia.TARGET} signets wins the duel`,
    options: [],
  },
};

export const gameOf = (state) => GAMES[state?.game || 'ek'];
export const DEFAULT_GAME = 'ek';

// ---------------------------------------------------------------------------------------------------------------
// Room layer on top of the engines: spectators. A game that has a player cap (or has already started) still lets
// people into the room: they wait in state.spectators ({id,name,forced?}) and can watch. forced = the host moved
// them there on purpose, so they are never moved back into a free seat automatically.
// ---------------------------------------------------------------------------------------------------------------
const specsOf = (s) => s.spectators || [];
const copy = (o) => JSON.parse(JSON.stringify(o));
const noteTo = (s, m) => { s.log.push(m); if (s.log.length > 100) s.log.shift(); };

// Seat waiting spectators in free seats (lobby only), in the order they arrived. Skips ones the host benched.
function fill(state) {
  const g = gameOf(state);
  let s = state;
  for (const sp of specsOf(state)) {
    if (s.players.length >= g.max) break;
    if (sp.forced) continue;
    const next = g.reduce(s, { type: 'join', player: sp.id, name: sp.name });
    if (!next) continue;
    next.spectators = specsOf(s).filter((x) => x.id !== sp.id);
    s = next;
  }
  return s;
}

// Every action goes through here: spectator handling first, then the game's own rules.
export function reduceRoom(state, a) {
  const g = gameOf(state);
  const specs = specsOf(state);
  const isSpec = (id) => specs.some((x) => x.id === id);
  const isPlayer = (id) => state.players.some((p) => p.id === id);
  const withSpecs = (list, msg) => { const s = copy(state); s.spectators = list; if (msg) noteTo(s, msg); return s; };

  switch (a.type) {
    case 'join':
      if (isSpec(a.player) || isPlayer(a.player)) return null;
      if (state.phase === 'lobby' && state.players.length < g.max) break;       // a free seat: the engine seats them
      return withSpecs([...specs, { id: a.player, name: a.name }], `${a.name} is watching.`);
    case 'leave':
      if (isSpec(a.player)) return withSpecs(specs.filter((x) => x.id !== a.player));
      break;
    case 'kick':
      if (isSpec(a.target)) {
        if (a.player !== state.hostId && !isPlayer(a.player)) return null;
        return withSpecs(specs.filter((x) => x.id !== a.target));
      }
      break;
    case 'setRole': { // host decides who plays and who watches, before the game starts
      if (a.player !== state.hostId || state.phase !== 'lobby') return null;
      if (a.target === state.hostId) throw new Error('The host has to play.');
      if (a.role === 'watch') {
        const p = state.players.find((x) => x.id === a.target);
        const next = p && g.reduce(state, { type: 'kick', player: a.player, target: a.target });
        if (!next) return null;
        next.spectators = [...specs, { id: p.id, name: p.name, forced: true }];
        return next;
      }
      if (a.role === 'play') {
        const sp = specs.find((x) => x.id === a.target);
        if (!sp) return null;
        if (state.players.length >= g.max) throw new Error(`${g.title} takes at most ${g.max} players.`);
        const next = g.reduce(state, { type: 'join', player: sp.id, name: sp.name });
        if (!next) return null;
        next.spectators = specs.filter((x) => x.id !== sp.id);
        return next;
      }
      return null;
    }
    default:
  }

  const next = g.reduce(state, a);
  if (!next) return null;
  if (!next.spectators) next.spectators = specs;   // a fresh lobby built by the engine doesn't know about them
  return next.phase === 'lobby' ? fill(next) : next;
}

// Host picks a different game in the lobby: rebuild the lobby for that game with the same people.
// Players beyond the new game's cap become spectators; waiting spectators take any seats that open up.
export function switchGame(state, gameId, playerId) {
  const g = GAMES[gameId];
  if (!g || state.phase !== 'lobby' || state.hostId !== playerId || gameOf(state).id === gameId) return null;
  const host = state.players.find((p) => p.id === state.hostId);
  let s = g.newLobby(host.id, host.name);
  const specs = [...specsOf(state)];
  for (const p of state.players) {
    if (p.id === host.id) continue;
    if (s.players.length < g.max) s = g.reduce(s, { type: 'join', player: p.id, name: p.name });
    else specs.push({ id: p.id, name: p.name });
  }
  s.spectators = specs;
  s.log = [`${host.name} chose ${g.title}.`];
  return fill(s);
}
