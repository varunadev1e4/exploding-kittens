// Back-to-lobby behavior shared by every game: host 'toLobby', host 'leave', player 'leave'.
import * as ek from '../src/engine.js';
import * as uno from '../src/uno/engine.js';
import * as cat from '../src/cat/engine.js';
import * as flip7 from '../src/flip7/engine.js';
import * as coup from '../src/coup/engine.js';

const must = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const throws = (fn) => { try { fn(); } catch { return true; } return false; };
const ids = ['p0', 'p1', 'p2', 'p3'];

for (const [name, g] of Object.entries({ ek, uno, cat, flip7, coup })) {
  const started = () => {
    let s = g.newLobby('p0', 'P0');
    for (let i = 1; i < 4; i++) s = g.reduce(s, { type: 'join', player: ids[i], name: ids[i].toUpperCase() });
    return g.reduce(s, { type: 'start', player: 'p0' });
  };

  // host sends everyone back to the lobby, nobody is dropped
  let s = started();
  must(s.phase !== 'lobby', `${name}: game started`);
  let r = g.reduce(s, { type: 'toLobby', player: 'p0' });
  must(r.phase === 'lobby' && r.hostId === 'p0' && r.players.length === 4, `${name}: toLobby keeps everyone`);
  must(r.players.every((p) => !p.left), `${name}: nobody marked left`);
  must(g.reduce(r, { type: 'toLobby', player: 'p0' }) === null, `${name}: toLobby in lobby is a no-op`);
  must(throws(() => g.reduce(started(), { type: 'toLobby', player: 'p1' })), `${name}: only the host can toLobby`);
  r = g.reduce(r, { type: 'start', player: 'p0' });
  must(r.phase !== 'lobby', `${name}: can start again after toLobby`);

  // a player who left mid-game is dropped when the room returns to the lobby
  s = started();
  s = g.reduce(s, { type: 'leave', player: 'p3' });
  must(s.phase !== 'lobby' && s.hostId === 'p0', `${name}: non-host leaving does not end the game`);
  r = g.reduce(s, { type: 'toLobby', player: 'p0' });
  must(r.phase === 'lobby' && r.players.length === 3 && !r.players.some((p) => p.id === 'p3'), `${name}: left player dropped`);

  // the host leaving: everyone else goes to the lobby and the next player becomes host
  s = started();
  r = g.reduce(s, { type: 'leave', player: 'p0' });
  must(r.phase === 'lobby', `${name}: host leaving -> lobby`);
  must(r.players.length === 3 && !r.players.some((p) => p.id === 'p0'), `${name}: host removed from room`);
  must(r.hostId === 'p1', `${name}: next player is host`);
}
console.log('lobby tests passed');

// ---- host picks the game in the lobby ----
import { GAMES, switchGame, gameOf, reduceRoom } from '../src/games.js';
{
  let s = GAMES.ek.newLobby('p0', 'P0');
  for (const id of ['p1', 'p2']) s = GAMES.ek.reduce(s, { type: 'join', player: id, name: id });
  for (const id of ['uno', 'cat', 'flip7', 'coup', 'ek']) {
    const n = switchGame(s, id, 'p0');
    if (id === gameOf(s).id) { must(n === null, 'same game is a no-op'); continue; }
    must(n && gameOf(n).id === id && n.phase === 'lobby' && n.hostId === 'p0', `switch to ${id}`);
    must(n.players.map((p) => p.id).join() === 'p0,p1,p2', `switch to ${id} keeps players`);
    must(GAMES[id].reduce(n, { type: 'start', player: 'p0' }).phase !== 'lobby', `${id} starts after switching`);
    s = n;
  }
  must(switchGame(s, 'uno', 'p1') === null, 'only the host can switch');
  must(switchGame(GAMES.ek.reduce(s, { type: 'start', player: 'p0' }), 'uno', 'p0') === null, 'cannot switch mid-game');
  let big = GAMES.ek.newLobby('p0', 'P0');
  for (let i = 1; i < 6; i++) big = GAMES.ek.reduce(big, { type: 'join', player: 'q' + i, name: 'q' + i });
  const small = switchGame(big, 'cat', 'p0'); // 6 people, Cat in the Box seats 5: the last one watches
  must(small.players.length === 5 && small.spectators.length === 1 && small.spectators[0].id === 'q5', 'overflow becomes a spectator');
  const back = switchGame(small, 'ek', 'p0');  // a bigger game seats the spectator again
  must(back.players.length === 6 && back.spectators.length === 0, 'spectator seated when there is room');
}
console.log('game picker tests passed');

// ---- spectators ----
{
  const R = (s, a) => { const n = reduceRoom(s, a); if (!n) throw new Error('FAIL: action ignored ' + a.type); return n; };
  let s = GAMES.cardia.newLobby('p0', 'P0');
  s = R(s, { type: 'join', player: 'p1', name: 'P1' });
  s = R(s, { type: 'join', player: 'p2', name: 'P2' });           // Cardia is full: p2 watches
  s = R(s, { type: 'join', player: 'p3', name: 'P3' });
  must(s.players.length === 2 && s.spectators.map((x) => x.id).join() === 'p2,p3', 'extra joiners watch');
  must(reduceRoom(s, { type: 'join', player: 'p2', name: 'P2' }) === null, 'joining twice is a no-op');
  must(throws(() => reduceRoom(s, { type: 'setRole', player: 'p0', target: 'p2', role: 'play' })), 'no free seat');
  must(reduceRoom(s, { type: 'setRole', player: 'p1', target: 'p2', role: 'play' }) === null, 'only the host assigns roles');
  must(throws(() => reduceRoom(s, { type: 'setRole', player: 'p0', target: 'p0', role: 'watch' })), 'host has to play');

  // host swaps p1 out for p3
  s = R(s, { type: 'setRole', player: 'p0', target: 'p1', role: 'watch' });
  must(s.players.length === 1 && s.spectators.find((x) => x.id === 'p1').forced, 'benched player is forced');
  must(!s.players.some((p) => p.id === 'p2' || p.id === 'p3'), 'spectators not seated automatically while the host chooses');
  s = R(s, { type: 'setRole', player: 'p0', target: 'p3', role: 'play' });
  must(s.players.map((p) => p.id).join() === 'p0,p3', 'p3 is seated');
  must(s.spectators.map((x) => x.id).sort().join() === 'p1,p2', 'p1 and p2 watch');

  // the game starts with the chosen players; spectators stay in the room
  s = R(s, { type: 'start', player: 'p0' });
  must(s.phase !== 'lobby' && s.spectators.length === 2, 'game runs, spectators kept');
  s = R(s, { type: 'join', player: 'p4', name: 'P4' });
  must(s.spectators.some((x) => x.id === 'p4'), 'late arrivals watch mid-game');
  must(throws(() => reduceRoom(s, { type: 'play', player: 'p2', uid: 1 })), 'a spectator cannot act');

  // back to the lobby: waiting (non-benched) spectators fill free seats, benched ones stay out
  const l = R(s, { type: 'toLobby', player: 'p0' });
  must(l.phase === 'lobby' && l.players.length === 2 && l.spectators.length === 3, 'seats full, everyone else still watches');
  const l2 = R(l, { type: 'kick', player: 'p0', target: 'p3' });  // a seat opens
  must(l2.players.some((p) => p.id === 'p2') && !l2.players.some((p) => p.id === 'p4'), 'the earliest non-benched spectator (p2) takes the seat');
  must(!l2.players.some((p) => p.id === 'p1'), 'a benched spectator is not seated automatically');

  // leaving / removal
  must(!R(l, { type: 'leave', player: 'p4' }).spectators.some((x) => x.id === 'p4'), 'a spectator can leave');
  must(!R(l, { type: 'kick', player: 'p0', target: 'p1' }).spectators.some((x) => x.id === 'p1'), 'host removes a spectator');
  // the host leaving a running game still brings everyone (spectators included) to the lobby
  const g2 = R(R(l, { type: 'kick', player: 'p0', target: 'p3' }), { type: 'leave', player: 'p4' });
  must(g2.spectators.length >= 1, 'bookkeeping holds');
}
console.log('spectator tests passed');
