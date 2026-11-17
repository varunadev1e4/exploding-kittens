// Duel for Cardia rules engine (Deck I, no locations, exactly 2 players).
// Same contract as the other engines: reduce(state, action) -> new state | null; throws Error(message) for illegal moves.
//
// Each round both players secretly pick a card from hand. The higher influence wins a signet; the LOWER card's owner
// activates its ability (some need a choice: phase 'ability'). First to 5 signets wins. Modifiers and ongoing tokens can
// change past encounters at any time, so signets are always recomputed from the encounters on the table.
//
// State: players[{id,name,alive,left}], and per-side arrays indexed like players: hands, decks, disc (discard), pend
// (influence bonus waiting for the next card played), face (must play face up first next round), pick (uid chosen this round).
// enc: encounters [[cardOfSide0, cardOfSide1], ...]. ab: ability waiting for a choice {side,i,uid,abId,picks}.

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 2;
export const TARGET = 5;

export const FAC = { R: 'Rebellion', A: 'Academy', G: 'Guild', D: 'Dynasty' };
export const facOf = (id) => ({ 1: 'R', 2: 'A', 3: 'G', 0: 'D' })[id % 4];

// u: the rulebook doesn't print this ability's text, so the wording is a best guess.
export const CARDS = {
  1: { n: 'Hired Blade', t: 'I', x: 'Discard this card and the opposing card.' },
  2: { n: 'Void Mage', t: 'I', u: 1, x: 'Remove all modifiers and ongoing tokens from any one played card.' },
  3: { n: 'Surgeon', t: 'I', u: 1, x: 'Add −5 influence to the opposing card.' },
  4: { n: 'Mediator', t: 'O', x: 'This encounter is a tie.' },
  5: { n: 'Saboteur', t: 'I', x: 'Your opponent discards the top 2 cards of their deck.' },
  6: { n: 'Fortune Teller', t: 'I', x: 'In the next encounter, your opponent plays their card face up before you choose yours.' },
  7: { n: 'Palace Guard', t: 'I', u: 1, x: 'Add +5 influence to the next card you play.' },
  8: { n: 'Judge', t: 'O', x: 'You win all tied encounters (including upcoming ones).' },
  9: { n: 'Ambusher', t: 'I', x: 'Choose a faction. Your opponent discards all cards of that faction from their hand.' },
  10: { n: 'Puppeteer', t: 'I', x: 'Discard the opposing card. Your opponent replaces it with a random card from their hand; that card’s influence decides this encounter.' },
  11: { n: 'Clockmaker', t: 'I', x: 'Add +3 influence to your card in the previous encounter and to the next card you play.' },
  12: { n: 'Treasurer', t: 'O', u: 1, x: 'Place an additional signet on any played card.' },
  13: { n: 'Swamp Guardian', t: 'I', x: 'Draw 1 card.' },
  14: { n: 'Magistra', t: 'I', x: 'Copy and activate the ability of one of your played cards with at least as much influence as this card.' },
  15: { n: 'Inventor', t: 'I', x: 'Add +3 influence to any one card and −3 influence to any other card.' },
  16: { n: 'Djinn', t: 'I', x: 'You immediately win the game.' },
};

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
    game: 'cardia', phase: 'lobby', hostId, winner: null, reason: '',
    players: [freshPlayer(hostId, hostName)],
    log: [`${hostName} created the game.`],
  };
}
const freshPlayer = (id, name) => ({ id, name, alive: true });

const byId = (s, id) => s.players.find((p) => p.id === id);
const sideOf = (s, id) => s.players.findIndex((p) => p.id === id);
const say = (s, m) => { s.log.push(m); if (s.log.length > 100) s.log.shift(); };
const pn = (s, side) => s.players[side].name;

/* ---------- card / board helpers (work on any state object) ---------- */
export const inf = (c) => c.base + c.mod;
const eff = (c) => c.ab || c.id;
const tokOn = (c, id) => !!c && c.tok && eff(c) === id;

export function allPlayed(s) {
  const r = [];
  s.enc.forEach((e, i) => [0, 1].forEach((side) => { if (e[side]) r.push({ c: e[side], i, s: side }); }));
  return r;
}
export function findCard(s, uid) {
  return allPlayed(s).find((p) => p.c.uid === uid) || null;
}
const nm = (c) => `${CARDS[c.id].n} (${inf(c)})`;
const own = (s, c) => `${pn(s, c.owner)}’s`;

export function evalEnc(s, i) {
  const e = s.enc[i], a = e[0], b = e[1];
  if (!a || !b) return { win: -1, lose: -1, sig: [0, 0] };
  const ia = inf(a), ib = inf(b);
  let win = ia > ib ? 0 : (ib > ia ? 1 : -1);
  if (tokOn(a, 4) || tokOn(b, 4)) win = -1;
  const sig = [0, 0];
  let lose = -1;
  if (win >= 0) { sig[win] = 1; lose = 1 - win; }
  else {
    if (tokOn(a, 8)) sig[0] = 1;
    if (tokOn(b, 8)) sig[1] = 1;
  }
  return { win, lose, sig };
}
const bonusFor = (s, uid) => allPlayed(s).filter((p) => tokOn(p.c, 12) && p.c.tgt === uid).length;
export function totals(s) {
  const t = [0, 0];
  s.enc.forEach((e, i) => { const r = evalEnc(s, i); t[0] += r.sig[0]; t[1] += r.sig[1]; });
  allPlayed(s).forEach((p) => {
    if (tokOn(p.c, 12) && p.c.tgt != null) { const f = findCard(s, p.c.tgt); if (f) t[f.s]++; }
  });
  return t;
}
export const cardSignets = (s, i, side) => {
  const e = s.enc[i];
  return evalEnc(s, i).sig[side] + (e[side] ? bonusFor(s, e[side].uid) : 0);
};

const clearCard = (c) => { c.mod = 0; c.tok = false; c.ab = null; c.tgt = null; };
function discardPlayed(s, c) {
  const f = findCard(s, c.uid);
  if (!f) return;
  s.enc[f.i][f.s] = null; clearCard(c); s.disc[c.owner].push(c);
}
const compact = (s) => { s.enc = s.enc.filter((e) => e[0] || e[1]); };
function draw(s, side, n) {
  for (let k = 0; k < n; k++) if (s.decks[side].length) s.hands[side].push(s.decks[side].shift());
}

function finish(s, winnerSide, reason) {
  s.phase = 'ended'; s.ab = null; s.pick = [null, null];
  s.winner = winnerSide === 'draw' ? 'draw' : s.players[winnerSide].id;
  s.reason = reason;
  say(s, winnerSide === 'draw' ? `Draw: ${reason}` : `🏆 ${pn(s, winnerSide)} wins! ${reason}`);
}

/* ---------- abilities ---------- */
const anyPlayed = (s) => allPlayed(s).map((p) => p.c.uid);
const AB = {
  1: { apply(s, x) { const e = s.enc[x.i]; [0, 1].forEach((k) => { if (e[k]) discardPlayed(s, e[k]); }); compact(s); say(s, 'Both cards are discarded.'); } },
  2: { steps: [{ ask: 'Void Mage: remove all modifiers and tokens from which card?', opts: anyPlayed }],
    apply(s, x, p) { const f = findCard(s, p[0]); if (f) { clearCard(f.c); say(s, `Cleared ${nm(f.c)}.`); } } },
  3: { apply(s, x) { const o = s.enc[x.i][1 - x.side]; if (o) { o.mod -= 5; say(s, `−5 on ${own(s, o)} ${nm(o)}.`); } } },
  4: { ongoing: true },
  5: { apply(s, x) { const o = 1 - x.side; for (let k = 0; k < 2; k++) if (s.decks[o].length) s.disc[o].push(s.decks[o].shift()); say(s, `Top 2 cards of ${pn(s, o)}’s deck are discarded.`); } },
  6: { apply(s, x) { s.face[1 - x.side] = true; say(s, `${pn(s, 1 - x.side)} must play face up first in the next encounter.`); } },
  7: { apply(s, x) { s.pend[x.side] += 5; say(s, `${pn(s, x.side)}’s next card gets +5.`); } },
  8: { ongoing: true },
  9: { steps: [{ ask: 'Ambusher: choose a faction. Your opponent discards those cards from hand.', opts: () => ['R', 'A', 'G', 'D'] }],
    apply(s, x, p) {
      const o = 1 - x.side, f = p[0];
      if (!f) return;
      const keep = []; let gone = 0;
      s.hands[o].forEach((c) => { if (facOf(c.id) === f) { s.disc[o].push(c); gone++; } else keep.push(c); });
      s.hands[o] = keep; say(s, `${FAC[f]} chosen: ${gone} card${gone === 1 ? '' : 's'} discarded from ${pn(s, o)}’s hand.`);
    } },
  10: { apply(s, x) {
    const o = 1 - x.side, e = s.enc[x.i], op = e[o];
    if (op) { discardPlayed(s, op); e[o] = null; }
    if (!s.hands[o].length) { say(s, 'No card to replace it.'); finish(s, x.side, `${pn(s, o)} has no card to replace the discarded one.`); return; }
    const k = Math.floor(Math.random() * s.hands[o].length), nc = s.hands[o].splice(k, 1)[0];
    e[o] = nc; say(s, `${pn(s, o)} replaces it with ${nm(nc)}.`);
  } },
  11: { apply(s, x) {
    const prev = x.i > 0 ? s.enc[x.i - 1][x.side] : null;
    if (prev) { prev.mod += 3; say(s, `+3 on ${nm(prev)} in the previous encounter.`); }
    s.pend[x.side] += 3; say(s, `${pn(s, x.side)}’s next card gets +3.`);
  } },
  12: { ongoing: true, steps: [{ ask: 'Treasurer: which card gets the extra signet?', opts: anyPlayed }],
    apply(s, x, p) {
      const f = findCard(s, x.uid);
      if (f && p[0] != null) { f.c.tgt = p[0]; const t = findCard(s, p[0]); if (t) say(s, `Extra signet on ${own(s, t.c)} ${nm(t.c)}.`); }
    } },
  13: { apply(s, x) { draw(s, x.side, 1); say(s, `${pn(s, x.side)} draws 1 card.`); } },
  14: { steps: [{ ask: 'Magistra: copy the ability of which of your cards?',
    opts(s, x) {
      const me = findCard(s, x.uid);
      if (!me) return [];
      return allPlayed(s).filter((p) => p.s === x.side && p.c.uid !== x.uid && inf(p.c) >= inf(me.c) && eff(p.c) !== 14).map((p) => p.c.uid);
    } }],
  apply(s, x, p) { const f = findCard(s, p[0]); if (!f) return null; say(s, `Copies ${CARDS[eff(f.c)].n}.`); return { copy: eff(f.c) }; } },
  15: { steps: [{ ask: 'Inventor: which card gets +3?', opts: anyPlayed },
    { ask: 'Inventor: which other card gets −3?', opts: (s, x, p) => anyPlayed(s).filter((u) => u !== p[0]) }],
  apply(s, x, p) {
    const a = findCard(s, p[0]), b = findCard(s, p[1]);
    if (a) { a.c.mod += 3; say(s, `+3 on ${own(s, a.c)} ${nm(a.c)}.`); }
    if (b) { b.c.mod -= 3; say(s, `−3 on ${own(s, b.c)} ${nm(b.c)}.`); }
  } },
  16: { apply(s, x) { say(s, 'The Djinn answers the call.'); finish(s, x.side, 'The Djinn’s ability.'); } },
};

const describe = (s, uid) => {
  const f = findCard(s, uid);
  if (!f) return '?';
  return `${pn(s, f.s)}’s ${inf(f.c)} ${CARDS[f.c.id].n} · encounter ${f.i + 1}${f.c.tok ? ' (∞)' : ''}`;
};

// What the player who owns the pending ability must choose now (null when nothing is waiting).
export function abPrompt(s) {
  if (s.phase !== 'ability' || !s.ab) return null;
  const { side, i, uid, abId, picks } = s.ab;
  const step = AB[abId].steps[picks.length];
  const opts = step.opts(s, { side, i, uid }, picks);
  return { side, ask: step.ask, opts: opts.map((o) => (typeof o === 'number' ? { v: o, label: describe(s, o) } : { v: o, label: FAC[o] })) };
}

function begin(s, x, abId) {
  const A = AB[abId], f = findCard(s, x.uid);
  if (A.ongoing && f) { f.c.tok = true; if (abId !== f.c.id) f.c.ab = abId; }
  s.ab = { side: x.side, i: x.i, uid: x.uid, abId, picks: [] };
  s.phase = 'ability';
}

// Run the pending ability as far as it can go; stops when it needs a choice from the player.
function advance(s) {
  while (s.ab && s.phase !== 'ended') {
    const { side, i, uid, abId, picks } = s.ab, A = AB[abId], x = { side, i, uid }, steps = A.steps || [];
    if (picks.length < steps.length) {
      if (steps[picks.length].opts(s, x, picks).length) return; // wait for the player's pick
      s.ab = null; break;                                        // nothing to choose from: the ability fizzles
    }
    const r = A.apply ? A.apply(s, x, picks) : null;
    s.ab = null;
    if (r && r.copy && s.phase !== 'ended') begin(s, x, r.copy);
  }
  if (s.phase !== 'ended') finishRound(s);
}

function endNoPlay(s) {
  const h0 = s.hands[0].length, h1 = s.hands[1].length, t = totals(s);
  if (!h0 && !h1) {
    if (t[0] > t[1]) finish(s, 0, `Neither player can play; ${pn(s, 0)} holds more signets.`);
    else if (t[1] > t[0]) finish(s, 1, `Neither player can play; ${pn(s, 1)} holds more signets.`);
    else finish(s, 'draw', 'Neither player can play and the signets are tied.');
  } else if (!h0) finish(s, 1, `${pn(s, 0)} has no card to play.`);
  else finish(s, 0, `${pn(s, 1)} has no card to play.`);
}

function beginRound(s) {
  s.round += 1;
  s.ab = null; s.pick = [null, null];
  if (!s.hands[0].length || !s.hands[1].length) { endNoPlay(s); return; }
  s.phase = 'choose';
}

function finishRound(s) {
  if (s.phase === 'ended') return;
  const t = totals(s);
  if (t[0] >= TARGET || t[1] >= TARGET) {
    if (t[0] > t[1]) { finish(s, 0, `${pn(s, 0)} reached ${t[0]} signets.`); return; }
    if (t[1] > t[0]) { finish(s, 1, `${pn(s, 1)} reached ${t[1]} signets.`); return; }
    say(s, `Both sides have ${t[0]} signets. Play on until one side leads.`);
  }
  draw(s, 0, 1); draw(s, 1, 1);
  beginRound(s);
}

// Both cards are chosen: reveal them, record the encounter, and let the loser's ability run.
function reveal(s) {
  const take = (side) => {
    const k = s.hands[side].findIndex((c) => c.uid === s.pick[side]);
    return s.hands[side].splice(k, 1)[0];
  };
  const c0 = take(0), c1 = take(1);
  s.enc.push([c0, c1]);
  const i = s.enc.length - 1;
  c0.mod += s.pend[0]; c1.mod += s.pend[1];
  s.pend = [0, 0]; s.face = [false, false]; s.pick = [null, null];
  say(s, `Reveal: ${pn(s, 0)}’s ${nm(c0)} vs ${pn(s, 1)}’s ${nm(c1)}.`);
  const r = evalEnc(s, i);
  if (r.lose >= 0) {
    const c = s.enc[i][r.lose];
    say(s, `${pn(s, r.lose)} loses the encounter. ${CARDS[c.id].n}: ${CARDS[c.id].x}`);
    begin(s, { side: r.lose, i, uid: c.uid }, c.id);
    advance(s);
  } else {
    if (r.win < 0) say(s, 'The encounter is a tie.');
    finishRound(s);
  }
}

/* ---------- setup / leaving ---------- */
function startGame(s) {
  s.players = s.players.filter((p) => !p.left);
  s.enc = []; s.hands = [[], []]; s.decks = [[], []]; s.disc = [[], []];
  s.pend = [0, 0]; s.face = [false, false]; s.pick = [null, null]; s.ab = null;
  s.winner = null; s.reason = ''; s.uid = 1; s.round = 0;
  for (let side = 0; side < 2; side++) {
    const cards = [];
    for (let id = 1; id <= 16; id++) cards.push({ uid: s.uid++, id, base: id, mod: 0, tok: false, ab: null, tgt: null, owner: side });
    s.decks[side] = shuffle(cards);
    draw(s, side, 5);
  }
  s.players.forEach((p) => { p.alive = true; });
  s.log = ['New duel. You each hold 5 cards. First to 5 signets wins.'];
  beginRound(s);
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

// A player left or went offline: with only two players, the other one wins.
function removePlayer(s, t) {
  t.left = true; t.alive = false;
  say(s, `👋 ${t.name} left the game.`);
  if (s.hostId === t.id) { const h = s.players.find((x) => !x.left); if (h) s.hostId = h.id; }
  const other = s.players.findIndex((p) => !p.left);
  finish(s, other, `${t.name} left the game.`);
}

// Who the game is waiting on (used for the offline-player timer).
export function blockerId(s) {
  if (s.phase === 'ability') return s.players[s.ab.side].id;
  if (s.phase !== 'choose') return null;
  const first = firstToPlay(s);
  if (first >= 0 && s.pick[first] == null) return s.players[first].id;
  const k = s.pick.findIndex((p) => p == null);
  return k >= 0 ? s.players[k].id : null;
}

// Fortune Teller: the side that must play face up goes first (the other sees the card before choosing). -1 = blind.
export function firstToPlay(s) {
  if (s.face[0] === s.face[1]) return -1;
  return s.face[0] ? 0 : 1;
}

export function reduce(state, a) {
  const s = clone(state);

  switch (a.type) {
    case 'join': {
      if (s.phase !== 'lobby') throw new Error('The game has already started.');
      if (byId(s, a.player)) return null;
      if (s.players.length >= MAX_PLAYERS) throw new Error('This game is full (2 players).');
      s.players.push(freshPlayer(a.player, a.name));
      say(s, `${a.name} joined.`);
      return s;
    }
    case 'start': {
      if (a.player !== s.hostId) throw new Error('Only the host can start.');
      if (s.phase !== 'lobby') return null;
      if (s.players.length < MIN_PLAYERS) throw new Error('Need exactly 2 players.');
      startGame(s); return s;
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
      if (s.players.length < MIN_PLAYERS) throw new Error('Need exactly 2 players.');
      startGame(s); return s;
    }
  }

  if (s.phase !== 'choose' && s.phase !== 'ability') return null;
  const me = sideOf(s, a.player);
  if (me < 0 || s.players[me].left) throw new Error('You are not in this game.');

  switch (a.type) {
    case 'play': {
      if (s.phase !== 'choose') throw new Error('Not available right now.');
      if (s.pick[me] != null) throw new Error('You already chose a card.');
      const first = firstToPlay(s);
      if (first >= 0 && first !== me && s.pick[first] == null) throw new Error(`${pn(s, first)} plays face up first.`);
      if (!s.hands[me].some((c) => c.uid === a.uid)) throw new Error("That card isn't in your hand.");
      s.pick[me] = a.uid;
      if (s.pick[0] != null && s.pick[1] != null) reveal(s);
      return s;
    }
    case 'pick': { // a choice for the ability that is being resolved
      if (s.phase !== 'ability') throw new Error('Not available right now.');
      if (s.ab.side !== me) throw new Error('Not your choice.');
      const pr = abPrompt(s);
      if (!pr.opts.some((o) => o.v === a.value)) throw new Error('Pick one of the options.');
      s.ab.picks.push(a.value);
      advance(s);
      return s;
    }
  }
  return null;
}
