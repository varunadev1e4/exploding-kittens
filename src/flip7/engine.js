// Flip 7 rules engine (rules: The Op Games rulebook ed. 3.1 + official FAQ).
// Same contract as the other engines: reduce(state, action) -> new state | null; throws Error(message) for illegal moves.
//
// Cards: numbers 0..12 (as integers; there are n copies of n, one 0), modifiers 'p2' 'p4' 'p6' 'p8' 'p10' 'x2',
// actions 'freeze' 'flip3' 'second'. 94 cards total.

export const MIN_PLAYERS = 2;   // the rulebook says 3+, but it plays fine with 2
export const MAX_PLAYERS = 18;
export const TARGET = 200;
export const FLIP7_BONUS = 15;

export const isNum = (c) => typeof c === 'number';
export const isMod = (c) => c === 'x2' || (typeof c === 'string' && /^p\d+$/.test(c));
export const ACTION_NAME = { freeze: 'Freeze', flip3: 'Flip Three', second: 'Second Chance' };

export function buildDeck() {
  const d = [0];
  for (let n = 1; n <= 12; n++) d.push(...Array(n).fill(n));            // 79 number cards
  d.push('p2', 'p4', 'p6', 'p8', 'p10', 'x2');                            // 6 modifiers
  for (const a of ['freeze', 'flip3', 'second']) d.push(a, a, a);        // 9 actions
  return d;
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
    game: 'flip7', phase: 'lobby', hostId, round: 0, scores: {}, winner: null, target: TARGET,
    players: [freshPlayer(hostId, hostName)],
    log: [`${hostName} created the game.`],
  };
}
function freshPlayer(id, name) {
  return { id, name, row: [], mods: [], acts: [], status: 'active' };
}

const byId = (s, id) => s.players.find((p) => p.id === id);
const isActive = (p) => !!p && !p.left && p.status === 'active';
const say = (s, m) => { s.log.push(m); if (s.log.length > 100) s.log.shift(); };
const activeCount = (s) => s.players.filter(isActive).length;

export function cardName(c) {
  if (isNum(c)) return String(c);
  if (c === 'x2') return '×2';
  if (isMod(c)) return `+${c.slice(1)}`;
  return ACTION_NAME[c];
}

// Points a player would bank right now (0 if busted). Order: numbers, then ×2, then +N, then the Flip 7 bonus.
export function roundScore(p) {
  if (p.status === 'busted') return 0;
  const sum = p.row.reduce((a, b) => a + b, 0);
  let pts = p.mods.includes('x2') ? sum * 2 : sum;
  for (const m of p.mods) if (m !== 'x2') pts += Number(m.slice(1));
  if (p.row.length === 7) pts += FLIP7_BONUS;
  return pts;
}

// The player the game is waiting on (used for the offline-player timer).
export function blockerId(s) {
  if (s.phase !== 'play') return null;
  if (s.choose) return s.choose.by;
  const p = s.players[s.turnIdx];
  return isActive(p) ? p.id : null;
}

function nextActiveIdx(s, from) { // next active player after index `from`, or -1
  const n = s.players.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    if (isActive(s.players[i])) return i;
  }
  return -1;
}

function drawCard(s) {
  if (s.draw.length === 0) { s.draw = shuffle(s.discard); s.discard = []; say(s, 'The deck ran out and the discard pile was shuffled.'); }
  return s.draw.shift();
}

// ---- targeting ----
function askTarget(s, p, card) {
  const eligible = s.players
    .filter((x) => isActive(x) && (card !== 'second' || (x.id !== p.id && !x.acts.includes('second'))))
    .map((x) => x.id);
  if (eligible.length === 0) { s.discard.push(card); say(s, `${ACTION_NAME[card]} was discarded.`); return; }
  if (eligible.length === 1) { applyAction(s, p, card, eligible[0]); return; } // e.g. last active player must play it on themself
  s.choose = { by: p.id, card, eligible };
}

function applyAction(s, by, card, targetId) {
  const t = byId(s, targetId);
  t.acts.push(card);
  if (card === 'freeze') { t.status = 'frozen'; say(s, `❄️ ${by.name} froze ${t === by ? 'themself' : t.name}. ${t.name} banks ${roundScore(t)}.`); }
  else if (card === 'flip3') { s.stack.push({ pid: t.id, left: 3, deferred: [] }); say(s, `🌀 ${by.name} gave Flip Three to ${t === by ? 'themself' : t.name}.`); }
  else { say(s, `💛 ${t.name} holds a Second Chance${by !== t ? ` (from ${by.name})` : ''}.`); }
}

// Draw one card into player p's line. `frame` is set while p is resolving a Flip Three (actions are then deferred).
function drawInto(s, p, frame) {
  const c = drawCard(s);
  if (c === undefined) { endRound(s, null); return 'empty'; }
  if (isNum(c)) {
    if (p.row.includes(c)) {
      const i = p.acts.indexOf('second');
      if (i >= 0) { p.acts.splice(i, 1); s.discard.push('second', c); say(s, `💛 ${p.name} drew a duplicate ${c} and used their Second Chance.`); return 'saved'; }
      p.row.push(c); p.status = 'busted';
      say(s, `💥 ${p.name} drew a duplicate ${c} and busted!`);
      return 'bust';
    }
    p.row.push(c);
    say(s, `${p.name} flipped ${c}.`);
    if (p.row.length === 7) { say(s, `🎉 ${p.name} flipped 7 unique numbers!`); endRound(s, p.id); return 'flip7'; }
    return 'ok';
  }
  if (isMod(c)) { p.mods.push(c); say(s, `${p.name} got ${cardName(c)}.`); return 'ok'; }
  if (c === 'second') {
    if (!p.acts.includes('second')) { p.acts.push('second'); say(s, `💛 ${p.name} got a Second Chance.`); return 'ok'; }
    askTarget(s, p, 'second'); return 'ok'; // already holding one: give it to another active player
  }
  if (frame) { frame.deferred.push(c); say(s, `${p.name} drew ${ACTION_NAME[c]} (it will be played after the three cards).`); return 'ok'; }
  say(s, `${p.name} drew ${ACTION_NAME[c]}.`);
  askTarget(s, p, c); return 'ok';
}

// Runs everything that needs no player input, until input is needed or the round ends.
function pump(s) {
  for (let guard = 0; s.phase === 'play' && guard < 5000; guard++) {
    if (s.choose) return;
    if (s.stack.length) {
      const f = s.stack[s.stack.length - 1];
      const p = byId(s, f.pid);
      if (!isActive(p)) { s.discard.push(...f.deferred); s.stack.pop(); continue; } // busted / frozen / left: the rest is lost
      if (f.left > 0) {
        f.left -= 1;
        const out = drawInto(s, p, f);
        if (s.phase !== 'play') return;
        if (out === 'bust') { s.discard.push(...f.deferred); s.stack.pop(); }
        continue;
      }
      if (f.deferred.length) { askTarget(s, p, f.deferred.shift()); continue; }
      s.stack.pop(); continue;
    }
    if (s.stage === 'dealing') {
      if (s.dealQueue.length) {
        const p = byId(s, s.dealQueue.shift());
        if (isActive(p)) drawInto(s, p, null);
        continue;
      }
      s.stage = 'turns';
      const di = s.players.findIndex((p) => p.id === s.dealerId);
      s.turnIdx = nextActiveIdx(s, di);
      if (s.turnIdx < 0) { endRound(s, null); return; }
      continue;
    }
    if (s.passFrom !== null) {
      const from = s.players.findIndex((p) => p.id === s.passFrom);
      s.passFrom = null;
      s.turnIdx = nextActiveIdx(s, from);
    }
    if (activeCount(s) === 0 || s.turnIdx < 0) { endRound(s, null); return; }
    if (!isActive(s.players[s.turnIdx])) { s.turnIdx = nextActiveIdx(s, s.turnIdx); continue; }
    return; // waiting for Hit / Stay
  }
}

// Cards still "in flight" (waiting for a target, or deferred by a Flip Three) go to the discard pile.
function clearPending(s) {
  if (s.choose) s.discard.push(s.choose.card);
  for (const f of s.stack) s.discard.push(...f.deferred);
  s.choose = null; s.stack = [];
}

function endRound(s, flip7By) {
  const rows = s.players.filter((p) => !p.left).map((p) => {
    const total = roundScore(p);
    s.scores[p.id] = (s.scores[p.id] || 0) + total;
    return { id: p.id, status: p.status, row: [...p.row], mods: [...p.mods], total, flip7: p.id === flip7By };
  });
  s.summary = { flip7By, rows };
  clearPending(s);
  s.stage = null; s.dealQueue = []; s.passFrom = null;
  const live = s.players.filter((p) => !p.left);
  const best = Math.max(...live.map((p) => s.scores[p.id] || 0));
  if (best >= s.target) {
    const top = live.filter((p) => (s.scores[p.id] || 0) === best);
    if (top.length === 1) {
      s.phase = 'ended'; s.winner = top[0].id;
      say(s, `🏆 ${top[0].name} wins with ${best} points!`);
      return;
    }
    say(s, `Tie at ${best}: another round decides it.`); // official FAQ
  }
  s.phase = 'roundEnd';
}

function dealRound(s, dealerId) {
  for (const p of s.players) { s.discard.push(...p.row, ...p.mods, ...p.acts); p.row = []; p.mods = []; p.acts = []; p.status = 'active'; }
  s.players = s.players.filter((p) => !p.left); // collect everyone's cards first, then drop players who left
  const di = Math.max(0, s.players.findIndex((p) => p.id === dealerId));
  s.dealerId = s.players[di].id;
  const n = s.players.length;
  s.dealQueue = Array.from({ length: n }, (_, k) => s.players[(di + 1 + k) % n].id); // left of dealer first, dealer last
  s.stack = []; s.choose = null; s.passFrom = null; s.summary = null; s.stage = 'dealing'; s.phase = 'play';
  say(s, `Round ${s.round}. ${s.players[di].name} deals.`);
  pump(s);
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
  fresh.players = keep.map((p) => freshPlayer(p.id, p.name));
  fresh.log = ['Back in the lobby.'];
  return fresh;
}

function removePlayer(s, t) {
  t.left = true; t.status = 'busted';
  say(s, `👋 ${t.name} left the game.`);
  if (s.hostId === t.id) { const h = s.players.find((x) => !x.left); if (h) s.hostId = h.id; }
  const left = s.players.filter((p) => !p.left);
  if (left.length < 2) { s.phase = 'ended'; s.winner = left[0] ? left[0].id : null; clearPending(s); if (left[0]) say(s, `🏆 ${left[0].name} is the last player left.`); return; }
  if (s.phase !== 'play') return;
  if (s.choose) {
    if (s.choose.by === t.id) { s.discard.push(s.choose.card); s.choose = null; }
    else {
      s.choose.eligible = s.choose.eligible.filter((id) => id !== t.id);
      if (s.choose.eligible.length === 0) { s.discard.push(s.choose.card); s.choose = null; }
    }
  }
  if (s.stage === 'turns' && s.passFrom === null && s.players[s.turnIdx] && s.players[s.turnIdx].id === t.id) s.passFrom = t.id;
  pump(s);
}

export function reduce(state, a) {
  const s = clone(state);

  switch (a.type) {
    case 'join': {
      if (s.phase !== 'lobby') throw new Error('The game has already started.');
      if (byId(s, a.player)) return null;
      if (s.players.length >= MAX_PLAYERS) throw new Error(`This game is full (max ${MAX_PLAYERS}).`);
      s.players.push(freshPlayer(a.player, a.name));
      say(s, `${a.name} joined.`);
      return s;
    }
    case 'start': {
      if (a.player !== s.hostId) throw new Error('Only the host can start.');
      if (s.phase !== 'lobby') return null;
      if (s.players.length < MIN_PLAYERS) throw new Error(`Need at least ${MIN_PLAYERS} players.`);
      s.scores = {}; s.round = 1; s.winner = null;
      s.draw = shuffle(buildDeck()); s.discard = [];
      dealRound(s, s.players[Math.floor(Math.random() * s.players.length)].id);
      return s;
    }
    case 'leave': {
      const p = byId(s, a.player);
      if (!p) return null;
      if (s.phase === 'lobby') { removeFromLobby(s, p.id); return s; }
      // the host leaving sends everyone back to the lobby (the next player becomes host)
      if (p.id === s.hostId) { const next = backToLobby(s); removeFromLobby(next, p.id); return next; }
      if (s.phase === 'ended' || p.left) return null;
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
      if (s.phase === 'ended' || tgt.left) return null;
      if (blockerId(s) !== tgt.id && caller.id !== s.hostId) throw new Error('Only the host can remove players.');
      removePlayer(s, tgt); return s;
    }
    case 'rematch': {
      if (a.player !== s.hostId || s.phase !== 'ended') return null;
      s.players = s.players.filter((p) => !p.left);
      if (s.players.length < MIN_PLAYERS) throw new Error(`Need at least ${MIN_PLAYERS} players.`);
      s.scores = {}; s.round = 1; s.winner = null;
      s.draw = shuffle(buildDeck()); s.discard = [];
      s.players.forEach((p) => { p.row = []; p.mods = []; p.acts = []; });
      dealRound(s, s.players[Math.floor(Math.random() * s.players.length)].id);
      return s;
    }
  }

  if (s.phase === 'lobby' || s.phase === 'ended') return null;
  const me = byId(s, a.player);
  if (!me || me.left) throw new Error('You are not in this game.');

  switch (a.type) {
    case 'hit':
    case 'stay': {
      if (s.phase !== 'play' || s.choose || s.stage !== 'turns') throw new Error('Not available right now.');
      if (s.players[s.turnIdx].id !== me.id || !isActive(me)) throw new Error("It's not your turn.");
      if (a.type === 'hit') {
        drawInto(s, me, null);
        if (s.phase === 'play') s.passFrom = me.id;
      } else {
        if (me.row.length + me.mods.length + me.acts.length === 0) throw new Error('You need a card in front of you before you can stay.');
        me.status = 'stayed';
        say(s, `✋ ${me.name} stays and banks ${roundScore(me)}.`);
        s.passFrom = me.id;
      }
      pump(s);
      return s;
    }
    case 'target': {
      const c = s.choose;
      if (!c || c.by !== me.id) throw new Error('Not your decision.');
      if (!c.eligible.includes(a.target)) throw new Error('Pick one of the highlighted players.');
      s.choose = null;
      applyAction(s, me, c.card, a.target);
      pump(s);
      return s;
    }
    case 'next': { // start the next round (any player may press it)
      if (s.phase !== 'roundEnd') return null;
      s.round += 1;
      const di = s.players.findIndex((p) => p.id === s.dealerId);
      let k = di;
      do { k = (k + 1) % s.players.length; } while (s.players[k].left);
      dealRound(s, s.players[k].id);
      return s;
    }
  }
  return null;
}
