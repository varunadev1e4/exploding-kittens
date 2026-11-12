// Cat in the Box rules engine (Muneyuki Yokouchi / Pegasus Spiele & Bezier Games rulebook).
// Same contract as the other engines: reduce(state, action) -> new state | null; throws Error(message) for illegal moves.
//
// Cards are plain numbers. A card has NO colour until it is played: the player "observes" (declares) a colour,
// and each colour+number pair can only be observed once per round (the research board).

export const MAX_PLAYERS = 5;
// Research board rows, top to bottom. Red is trump. (Row order only matters for the adjacency bonus.)
export const ROWS = ['R', 'B', 'Y', 'G'];
export const COLOR_NAME = { R: 'Red', B: 'Blue', Y: 'Yellow', G: 'Green' };
export const RANGE = { 2: 5, 3: 6, 4: 8, 5: 9 };                 // cards are numbered 1..RANGE, five of each
export const PREDICTIONS = { 3: [1, 3, 4], 4: [1, 2, 3], 5: [1, 2, 3] }; // none in a 2-player game

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
    game: 'cat', phase: 'lobby', hostId, round: 0, totalRounds: 0, scores: {}, winners: [],
    players: [{ id: hostId, name: hostName, hand: [], alive: true }],
    log: [`${hostName} created the game.`],
  };
}

const byId = (s, id) => s.players.find((p) => p.id === id);
const current = (s) => s.players[s.turnIdx];
const alive = (s) => s.players.filter((p) => !p.left);
const say = (s, m) => { s.log.push(m); if (s.log.length > 80) s.log.shift(); };
const nextIdx = (s, i) => (i + 1) % s.players.length;

// The player the game is waiting on (used for the offline-player timer).
export function blockerId(s) {
  if (s.phase === 'discard') return (s.players.find((p) => !p.left && !p.discarded) || {}).id || null;
  if (s.phase === 'predict' || s.phase === 'trick') return current(s).id;
  return null;
}

// Every (card, colour) the player may legally play right now.
export function legalMoves(s, p) {
  const leader = s.trick.length === 0;
  const redOpen = s.board.R.some((x) => x !== null); // trump has been "broken"
  const gen = (allowRed) => {
    const out = [];
    for (const c of new Set(p.hand)) {
      for (const col of ROWS) {
        if (col === 'R' && !allowRed) continue;
        if (s.board[col][c - 1] === null && p.colors[col]) out.push({ card: c, color: col });
      }
    }
    return out;
  };
  if (!leader) return gen(true);
  const m = gen(redOpen);               // the leader may not lead red unless red is open...
  return m.length ? m : gen(true);      // ...or has no other option
}

export function largestGroup(board, id) {
  const M = board.R.length, seen = new Set();
  let best = 0;
  for (let r = 0; r < ROWS.length; r++) {
    for (let c = 0; c < M; c++) {
      if (board[ROWS[r]][c] !== id || seen.has(`${r},${c}`)) continue;
      let size = 0; const q = [[r, c]]; seen.add(`${r},${c}`);
      while (q.length) {
        const [y, x] = q.pop(); size++;
        for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ny = y + dy, nx = x + dx;
          if (ny < 0 || ny >= ROWS.length || nx < 0 || nx >= M || seen.has(`${ny},${nx}`)) continue;
          if (board[ROWS[ny]][nx] === id) { seen.add(`${ny},${nx}`); q.push([ny, nx]); }
        }
      }
      best = Math.max(best, size);
    }
  }
  return best;
}

function dealRound(s, startId) {
  s.players = s.players.filter((p) => !p.left);
  const n = s.players.length, M = RANGE[n];
  let deck = [];
  for (let num = 1; num <= M; num++) deck.push(...Array(5).fill(num));
  deck = shuffle(deck);
  const per = n === 5 ? 9 : 10;
  s.players.forEach((p) => {
    p.hand = deck.splice(0, per).sort((a, b) => a - b);
    p.discarded = false; p.pred = null; p.tricks = 0;
    p.colors = { R: true, B: true, Y: true, G: true }; // the tokens on your player board
  });
  s.board = {}; ROWS.forEach((r) => { s.board[r] = Array(M).fill(null); });
  if (n === 2) { // 2 players: 5 cards in the middle, 3 of them are revealed and block spaces (green, then yellow, then blue)
    for (const num of deck.slice(0, 3)) {
      const row = ['G', 'Y', 'B'].find((r) => s.board[r][num - 1] === null);
      if (row) s.board[row][num - 1] = 'x';
    }
  }
  s.startId = s.players.some((p) => p.id === startId) ? startId : s.players[0].id;
  s.turnIdx = s.players.findIndex((p) => p.id === s.startId);
  s.trick = []; s.led = null; s.lastTrick = null; s.paradox = null; s.summary = null;
  s.phase = 'discard';
  say(s, `Round ${s.round} of ${s.totalRounds}. ${s.players[s.turnIdx].name} starts.`);
}

function startTrickPhase(s) {
  s.phase = 'trick';
  s.turnIdx = s.players.findIndex((p) => p.id === s.startId);
  s.trick = []; s.led = null;
  settle(s);
}

// A paradox: the player to move has no legal card/colour. It ends the round immediately.
function settle(s) {
  if (s.phase !== 'trick') return;
  const p = current(s);
  if (legalMoves(s, p).length === 0) {
    s.paradox = p.id;
    say(s, `🌀 PARADOX! ${p.name} cannot observe any card (hand: ${p.hand.join(', ')}).`);
    endRound(s);
  }
}

function endRound(s) {
  const n = s.players.length;
  const rows = s.players.map((p) => {
    const caused = s.paradox === p.id;
    const trickPts = caused ? -p.tricks : p.tricks;
    const ok = !caused && (n === 2 ? p.tricks <= 4 : p.pred === p.tricks);
    const bonus = ok ? largestGroup(s.board, p.id) : 0;
    return { id: p.id, tricks: p.tricks, pred: p.pred, caused, trickPts, ok, bonus, total: trickPts + bonus };
  });
  rows.forEach((r) => { s.scores[r.id] = (s.scores[r.id] || 0) + r.total; });
  s.summary = { paradox: s.paradox, rows };
  s.trick = []; s.led = null;
  if (s.round >= s.totalRounds) finishGame(s); else s.phase = 'roundEnd';
}

function finishGame(s) {
  s.phase = 'ended';
  const ids = alive(s).map((p) => p.id);
  const best = Math.max(...ids.map((id) => s.scores[id] || 0));
  let top = ids.filter((id) => (s.scores[id] || 0) === best);
  if (top.length > 1 && s.summary) { // tie-break: highest score in the final round
    const fr = (id) => (s.summary.rows.find((r) => r.id === id) || { total: -99 }).total;
    const b2 = Math.max(...top.map(fr));
    top = top.filter((id) => fr(id) === b2);
  }
  s.winners = top;
  say(s, `🏆 ${top.map((id) => byId(s, id).name).join(' & ')} ${top.length > 1 ? 'share the win' : 'wins the game'}!`);
}

function resolveTrick(s) {
  const reds = s.trick.filter((t) => t.color === 'R');
  const pool = reds.length ? reds : s.trick.filter((t) => t.color === s.led); // trump beats led colour; other colours lose
  const win = pool.reduce((a, b) => (b.card > a.card ? b : a));
  const winner = byId(s, win.player);
  winner.tricks += 1;
  s.lastTrick = { cards: s.trick, winner: winner.id };
  say(s, `${winner.name} won the trick with ${COLOR_NAME[win.color]} ${win.card}.`);
  s.trick = []; s.led = null;
  if (s.players.every((p) => p.hand.length === 1)) { endRound(s); return; }
  s.turnIdx = s.players.indexOf(winner);
  settle(s);
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

// Someone left mid-game. The deck/board are sized for the player count, so a round in progress is voided
// and replayed with the remaining players (scores are kept).
function removePlayer(s, t) {
  t.left = true;
  say(s, `👋 ${t.name} left the game.`);
  if (s.hostId === t.id) { const h = s.players.find((x) => !x.left); if (h) s.hostId = h.id; }
  const left = alive(s);
  if (left.length < 2) {
    s.phase = 'ended'; s.winners = left.map((p) => p.id);
    if (left[0]) say(s, `🏆 ${left[0].name} is the last player left.`);
    return;
  }
  const idx = s.players.findIndex((p) => p.id === s.startId);
  let k = idx; do { k = (k + 1) % s.players.length; } while (s.players[k].left && k !== idx);
  const nextStart = s.players[idx].left ? s.players[k].id : s.startId;
  if (s.phase === 'roundEnd') { s.totalRounds = s.round + left.length; s.startId = nextStart; return; }
  s.totalRounds = s.round - 1 + left.length; // this round restarts, then everyone starts once
  say(s, 'The round was voided and starts again.');
  dealRound(s, nextStart);
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
      s.scores = {}; s.round = 1; s.totalRounds = s.players.length;
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
      if (s.players.length < 2) throw new Error('Need at least 2 players.');
      s.scores = {}; s.round = 1; s.totalRounds = s.players.length; s.winners = [];
      dealRound(s, s.players[Math.floor(Math.random() * s.players.length)].id);
      return s;
    }
  }

  if (s.phase === 'lobby' || s.phase === 'ended') return null;
  const me = byId(s, a.player);
  if (!me || me.left) throw new Error('You are not in this game.');

  switch (a.type) {
    case 'discard': { // each player secretly sets one card aside, simultaneously
      if (s.phase !== 'discard') throw new Error('Not available right now.');
      if (me.discarded) return null;
      const i = me.hand.indexOf(a.card);
      if (i < 0) throw new Error("You don't have that card.");
      me.hand.splice(i, 1); me.discarded = true;
      say(s, `${me.name} set a card aside.`);
      if (s.players.every((p) => p.discarded)) {
        if (s.players.length === 2) startTrickPhase(s);
        else { s.phase = 'predict'; s.turnIdx = s.players.findIndex((p) => p.id === s.startId); }
      }
      return s;
    }
    case 'predict': { // clockwise from the start player
      if (s.phase !== 'predict' || current(s).id !== me.id) throw new Error("It's not your turn to predict.");
      const allowed = PREDICTIONS[s.players.length];
      if (!allowed.includes(a.value)) throw new Error(`You can predict ${allowed.join(', ')}.`);
      me.pred = a.value;
      say(s, `${me.name} predicts ${a.value} trick${a.value === 1 ? '' : 's'}.`);
      if (s.players.every((p) => p.pred !== null)) startTrickPhase(s);
      else s.turnIdx = nextIdx(s, s.turnIdx);
      return s;
    }
    case 'play': {
      if (s.phase !== 'trick' || current(s).id !== me.id) throw new Error("It's not your turn.");
      const ok = legalMoves(s, me).some((m) => m.card === a.card && m.color === a.color);
      if (!ok) throw new Error(`You can't observe a ${COLOR_NAME[a.color] || '?'} ${a.card} right now.`);
      me.hand.splice(me.hand.indexOf(a.card), 1);
      s.board[a.color][a.card - 1] = me.id;
      if (s.trick.length === 0) s.led = a.color;
      else if (a.color !== s.led) me.colors[s.led] = false; // you may no longer declare the led colour this round
      s.trick.push({ player: me.id, card: a.card, color: a.color });
      say(s, `${me.name} observed a ${COLOR_NAME[a.color]} ${a.card}.`);
      if (s.trick.length === s.players.length) resolveTrick(s);
      else { s.turnIdx = nextIdx(s, s.turnIdx); settle(s); }
      return s;
    }
    case 'next': { // continue to the next round (any player may press it)
      if (s.phase !== 'roundEnd') return null;
      s.round += 1;
      const idx = s.players.findIndex((p) => p.id === s.startId);
      let k = idx; do { k = (k + 1) % s.players.length; } while (s.players[k].left);
      dealRound(s, s.players[k].id);
      return s;
    }
  }
  return null;
}
