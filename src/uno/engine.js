// Uno rules engine (official rules). Same contract as the Exploding Kittens engine:
// reduce(state, action) -> new state | null (no-op); throws Error(message) for illegal moves.
//
// Cards are short strings: colour letter + value, e.g. 'R5', 'GS' (Skip), 'BV' (Reverse), 'YD' (Draw Two);
// 'W' = Wild, 'F' = Wild Draw Four. 108 cards total.

export const MAX_PLAYERS = 10;
export const TARGET = 500;
export const COLORS = ['R', 'Y', 'G', 'B'];
export const COLOR_NAME = { R: 'Red', Y: 'Yellow', G: 'Green', B: 'Blue' };

export const isWild = (c) => c === 'W' || c === 'F';
export const colorOf = (c) => (isWild(c) ? null : c[0]);
export const valueOf = (c) => (isWild(c) ? c : c.slice(1));
export const points = (c) => (isWild(c) ? 50 : /^\d$/.test(valueOf(c)) ? Number(valueOf(c)) : 20);

export function buildDeck() {
  const d = [];
  for (const col of COLORS) {
    d.push(`${col}0`);
    for (let n = 1; n <= 9; n++) d.push(`${col}${n}`, `${col}${n}`);
    for (const a of ['S', 'V', 'D']) d.push(`${col}${a}`, `${col}${a}`);
  }
  for (let i = 0; i < 4; i++) d.push('W', 'F');
  return d; // 4 * (1 + 18 + 6) + 8 = 108
}

const clone = (o) => JSON.parse(JSON.stringify(o));
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function newLobby(hostId, hostName) {
  return {
    game: 'uno', phase: 'lobby', hostId, winner: null, matchWinner: null, scores: {}, target: TARGET,
    players: [{ id: hostId, name: hostName, hand: [], alive: true }],
    log: [`${hostName} created the game.`],
  };
}

const byId = (s, id) => s.players.find((p) => p.id === id);
const current = (s) => s.players[s.turnIdx];
const alive = (s) => s.players.filter((p) => p.alive);
const say = (s, m) => { s.log.push(m); if (s.log.length > 80) s.log.shift(); };

// move `steps` alive seats from index `from` in the current direction
function step(s, from, steps = 1) {
  const n = s.players.length;
  let i = from;
  for (let k = 0; k < steps; k++) {
    do { i = (i + s.dir + n) % n; } while (!s.players[i].alive);
  }
  return i;
}

function drawCards(s, p, count) {
  for (let i = 0; i < count; i++) {
    if (s.draw.length === 0) {
      const top = s.discard.pop();
      s.draw = shuffle(s.discard); s.discard = [top];
      if (s.draw.length === 0) break; // nothing left anywhere
    }
    p.hand.push(s.draw.shift());
  }
}

export function isPlayable(s, c) {
  if (isWild(c)) return true;
  const top = s.discard[s.discard.length - 1];
  return colorOf(c) === s.color || valueOf(c) === valueOf(top);
}

// The player the game is waiting on (used for the offline-player timer).
export function blockerId(s) {
  if (s.phase === 'turn' || s.phase === 'startColor') return current(s).id;
  if (s.phase === 'challenge') return s.challenge.victim;
  return null;
}

function dealRound(s) {
  s.players = s.players.filter((p) => !p.left);
  const n = s.players.length;
  let deck = shuffle(buildDeck());
  s.players.forEach((p) => { p.alive = true; p.hand = deck.splice(0, 7); });
  let top;
  do { top = deck.shift(); if (top === 'F') { deck.push(top); deck = shuffle(deck); } } while (top === 'F');
  s.draw = deck; s.discard = [top];
  s.dir = 1; s.drawn = null; s.catchable = null; s.challenge = null; s.winner = null;
  s.color = isWild(top) ? null : colorOf(top);
  s.phase = 'turn';
  const dealer = Math.floor(Math.random() * n);
  s.turnIdx = step(s, dealer, 1);
  s.log = [`New round! ${s.players[dealer].name} dealt.`];
  switch (valueOf(top)) {
    case 'S': say(s, `${current(s).name} is skipped.`); s.turnIdx = step(s, s.turnIdx, 1); break;
    case 'V': say(s, 'Play starts in reverse.'); s.dir = -1; s.turnIdx = dealer; break;
    case 'D': { const p = current(s); drawCards(s, p, 2); say(s, `${p.name} draws 2 and is skipped.`); s.turnIdx = step(s, s.turnIdx, 1); break; }
    case 'W': s.phase = 'startColor'; say(s, `${current(s).name} picks the starting colour.`); break;
    default:
  }
}

function endRound(s, winner) {
  const pts = s.players.filter((p) => p.id !== winner.id).reduce((a, p) => a + p.hand.reduce((x, c) => x + points(c), 0), 0);
  s.scores[winner.id] = (s.scores[winner.id] || 0) + pts;
  s.phase = 'ended'; s.winner = winner.id; s.drawn = null; s.catchable = null; s.challenge = null;
  say(s, `🏆 ${winner.name} wins the round and scores ${pts} points.`);
  if (s.scores[winner.id] >= s.target) { s.matchWinner = winner.id; say(s, `🎉 ${winner.name} wins the match with ${s.scores[winner.id]} points!`); }
}

function removeFromLobby(s, id) {
  const p = byId(s, id);
  if (!p) return;
  s.players = s.players.filter((x) => x.id !== id);
  if (s.hostId === id && s.players.length) s.hostId = s.players[0].id;
  say(s, `${p.name} left.`);
}

// Reset the room to a fresh lobby: same host and players (anyone who already left the game is dropped).
function backToLobby(s) {
  const keep = s.players.filter((p) => !p.left);
  const host = keep.find((p) => p.id === s.hostId) || keep[0];
  const fresh = newLobby(host.id, host.name);
  fresh.players = keep.map((p) => ({ id: p.id, name: p.name, hand: [], alive: true }));
  fresh.log = ['Back in the lobby.'];
  return fresh;
}

function removePlayer(s, t) {
  const idx = s.players.indexOf(t);
  const wasCurrent = s.turnIdx === idx;
  t.alive = false; t.left = true;
  s.draw.push(...t.hand); s.draw = shuffle(s.draw); t.hand = [];
  say(s, `👋 ${t.name} left the game.`);
  if (s.catchable === t.id) s.catchable = null;
  if (s.hostId === t.id) { const h = s.players.find((x) => x.alive); if (h) s.hostId = h.id; }
  const left = alive(s);
  if (left.length <= 1) {
    s.phase = 'ended'; s.winner = left[0] ? left[0].id : null; s.challenge = null; s.drawn = null; s.catchable = null;
    if (left[0]) say(s, `🏆 ${left[0].name} is the last player left.`);
    return;
  }
  if (s.challenge && (s.challenge.by === t.id || s.challenge.victim === t.id)) {
    const v = s.players.findIndex((x) => x.id === s.challenge.victim);
    s.challenge = null; s.phase = 'turn';
    s.turnIdx = s.players[v].alive ? v : step(s, v, 1);
    return;
  }
  if (wasCurrent) {
    s.drawn = null;
    if (s.phase === 'startColor') { s.color = COLORS[Math.floor(Math.random() * 4)]; s.phase = 'turn'; }
    s.turnIdx = step(s, idx, 1);
  }
}

export function reduce(state, a) {
  const s = clone(state);

  switch (a.type) {
    case 'join': {
      if (s.phase !== 'lobby') throw new Error('The game has already started.');
      if (byId(s, a.player)) return null;
      if (s.players.length >= MAX_PLAYERS) throw new Error(`This game is full (max ${MAX_PLAYERS}).`);
      s.players.push({ id: a.player, name: a.name, hand: [], alive: true });
      say(s, `${a.name} joined.`);
      return s;
    }
    case 'start': {
      if (a.player !== s.hostId) throw new Error('Only the host can start.');
      if (s.phase !== 'lobby') return null;
      if (s.players.length < 2) throw new Error('Need at least 2 players.');
      dealRound(s); return s;
    }
    case 'leave': {
      const p = byId(s, a.player);
      if (!p) return null;
      if (s.phase === 'lobby') { removeFromLobby(s, p.id); return s; }
      // the host leaving sends everyone back to the lobby (the next player becomes host)
      if (p.id === s.hostId) { const next = backToLobby(s); removeFromLobby(next, p.id); return next; }
      if (s.phase === 'ended' || !p.alive) return null;
      removePlayer(s, p); return s;
    }
    case 'toLobby': { // host ends the game and brings everyone back to the lobby
      if (a.player !== s.hostId) throw new Error('Only the host can do that.');
      if (s.phase === 'lobby') return null;
      return backToLobby(s);
    }
    case 'kick': {
      const caller = byId(s, a.player), tgt = byId(s, a.target);
      if (!caller || !tgt || tgt.id === caller.id) return null;
      if (s.phase === 'lobby') { removeFromLobby(s, tgt.id); return s; }
      if (s.phase === 'ended' || !tgt.alive) return null;
      if (blockerId(s) !== tgt.id && caller.id !== s.hostId) throw new Error('Only the host can remove players.');
      removePlayer(s, tgt); return s;
    }
    case 'rematch': { // next round (or a new match once someone has reached the target)
      if (a.player !== s.hostId || s.phase !== 'ended') return null;
      s.players = s.players.filter((p) => !p.left);
      if (s.players.length < 2) throw new Error('Need at least 2 players.');
      if (s.matchWinner) { s.scores = {}; s.matchWinner = null; }
      dealRound(s); return s;
    }
  }

  if (s.phase === 'lobby' || s.phase === 'ended') return null;
  const me = byId(s, a.player);
  if (!me || !me.alive) throw new Error('You are out of this round.');

  switch (a.type) {
    case 'chooseColor': {
      if (s.phase !== 'startColor' || current(s).id !== me.id) throw new Error('Not your decision.');
      if (!COLORS.includes(a.color)) throw new Error('Choose a colour.');
      s.color = a.color; s.phase = 'turn';
      say(s, `${me.name} chose ${COLOR_NAME[a.color]}.`); return s;
    }

    case 'play': {
      if (s.phase !== 'turn' || current(s).id !== me.id) throw new Error("It's not your turn.");
      const c = a.card;
      if (!me.hand.includes(c)) throw new Error("You don't have that card.");
      if (s.drawn && c !== s.drawn) throw new Error('You can only play the card you just drew.');
      if (!isPlayable(s, c)) throw new Error("That card doesn't match the colour or number.");
      if (isWild(c) && !COLORS.includes(a.color)) throw new Error('Choose a colour for the wild card.');

      me.hand.splice(me.hand.indexOf(c), 1);
      s.discard.push(c);
      const prevColor = s.color;
      s.color = isWild(c) ? a.color : colorOf(c);
      s.drawn = null; s.catchable = null;
      const v = valueOf(c);
      const nextIdx = step(s, s.turnIdx, 1);
      const next = s.players[nextIdx];
      say(s, `${me.name} played ${isWild(c) ? (c === 'F' ? 'Wild Draw Four' : 'Wild') : `${COLOR_NAME[colorOf(c)]} ${v === 'S' ? 'Skip' : v === 'V' ? 'Reverse' : v === 'D' ? 'Draw Two' : v}`}${isWild(c) ? ` (${COLOR_NAME[a.color]})` : ''}.`);

      if (me.hand.length === 0) { // round over; pending draw penalties still count towards the score
        if (v === 'D') drawCards(s, next, 2);
        if (v === 'F') drawCards(s, next, 4);
        endRound(s, me); return s;
      }
      if (me.hand.length === 1) {
        if (a.uno) say(s, `${me.name}: UNO!`);
        else s.catchable = me.id;
      }

      switch (v) {
        case 'S': say(s, `${next.name} is skipped.`); s.turnIdx = step(s, s.turnIdx, 2); break;
        case 'V':
          if (alive(s).length === 2) { say(s, 'Reverse acts as a Skip with 2 players.'); } // same player goes again
          else { s.dir = -s.dir; s.turnIdx = step(s, s.turnIdx, 1); }
          break;
        case 'D': drawCards(s, next, 2); say(s, `${next.name} draws 2 and is skipped.`); s.turnIdx = step(s, nextIdx, 1); break;
        case 'F':
          s.phase = 'challenge';
          s.challenge = { by: me.id, victim: next.id, illegal: me.hand.some((h) => colorOf(h) === prevColor), prevColor };
          say(s, `${next.name} may challenge the Wild Draw Four.`);
          break;
        default: s.turnIdx = nextIdx;
      }
      return s;
    }

    case 'draw': { // official rule: draw ONE card; if it can be played you may play it, otherwise your turn ends
      if (s.phase !== 'turn' || current(s).id !== me.id) throw new Error("It's not your turn.");
      if (s.drawn) throw new Error('You already drew. Play that card or pass.');
      s.catchable = null;
      drawCards(s, me, 1);
      const card = me.hand[me.hand.length - 1];
      if (card && isPlayable(s, card)) { s.drawn = card; say(s, `${me.name} drew a card and may play it.`); }
      else { say(s, `${me.name} drew a card.`); s.turnIdx = step(s, s.turnIdx, 1); }
      return s;
    }
    case 'pass': {
      if (s.phase !== 'turn' || current(s).id !== me.id || !s.drawn) throw new Error('You can only pass after drawing.');
      s.drawn = null; s.turnIdx = step(s, s.turnIdx, 1);
      say(s, `${me.name} kept the card.`); return s;
    }

    case 'accept':
    case 'challenge': {
      const ch = s.challenge;
      if (s.phase !== 'challenge' || ch.victim !== me.id) throw new Error('Not your decision.');
      const by = byId(s, ch.by);
      const vIdx = s.players.indexOf(me);
      s.challenge = null; s.phase = 'turn'; s.catchable = null;
      if (a.type === 'accept') {
        drawCards(s, me, 4); say(s, `${me.name} drew 4 and is skipped.`);
        s.turnIdx = step(s, vIdx, 1);
      } else if (ch.illegal) {
        drawCards(s, by, 4);
        say(s, `✅ Challenge succeeded! ${by.name} had a ${COLOR_NAME[ch.prevColor]} card and draws 4. ${me.name} plays on.`);
        s.turnIdx = vIdx;
      } else {
        drawCards(s, me, 6);
        say(s, `❌ Challenge failed. ${by.name} had no ${COLOR_NAME[ch.prevColor]} card, so ${me.name} draws 6 and is skipped.`);
        s.turnIdx = step(s, vIdx, 1);
      }
      return s;
    }

    case 'uno': { // declare UNO (clears the catch window if you were quick enough)
      if (s.catchable !== me.id) return null;
      s.catchable = null; say(s, `${me.name}: UNO!`); return s;
    }
    case 'catch': { // caught someone with one card who didn't say UNO
      const t = byId(s, a.target);
      if (!t || t.id === me.id || s.catchable !== t.id) return null;
      s.catchable = null; drawCards(s, t, 2);
      say(s, `🚨 ${me.name} caught ${t.name} forgetting UNO! ${t.name} draws 2.`);
      return s;
    }
  }
  return null;
}
