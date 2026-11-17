// Pure game engine. reduce(state, action) -> new state, or null if the action is a no-op.
// Throws Error(message) for illegal moves (the message is shown to the player).
import { CARDS, SINGLE_PLAY } from './cards.js';

export const NOPE_MS = 7000; // length of the Nope window, counted locally by each client
export const MAX_PLAYERS = 10;
// 1 deck (56 cards) for 2-5 players, 2 combined decks for 6-10 (the rulebook allows combining decks).
export const decksFor = (n) => (n <= 5 ? 1 : 2);

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
    game: 'ek', phase: 'lobby', hostId, fast: false, winner: null,
    players: [{ id: hostId, name: hostName, hand: [], alive: true }],
    log: [`${hostName} created the game.`],
  };
}

const alivePlayers = (s) => s.players.filter((p) => p.alive);
const byId = (s, id) => s.players.find((p) => p.id === id);
const current = (s) => s.players[s.turnIdx];
const say = (s, msg) => { s.log.push(msg); if (s.log.length > 80) s.log.shift(); };

function nextAlive(s, from) {
  let i = from;
  do { i = (i + 1) % s.players.length; } while (!s.players[i].alive);
  return i;
}

function dealNewGame(s) {
  const n = s.players.length;
  const decks = decksFor(n);
  let deck = [];
  for (const [type, c] of Object.entries(CARDS)) {
    if (type === 'exploding' || type === 'defuse') continue;
    deck.push(...Array(c.count * decks).fill(type));
  }
  deck = shuffle(deck);
  s.players.forEach((p) => {
    p.alive = true;
    p.hand = ['defuse'];
    for (let i = 0; i < 7; i++) p.hand.push(deck.pop());
  });
  // 6 Defuses per deck: 1 each, then shuffle back 2 extras per deck (if that many are left over)
  deck.push(...Array(Math.min(2 * decks, 6 * decks - n)).fill('defuse'));
  deck = shuffle(deck);
  if (s.fast) deck = deck.slice(Math.floor(deck.length / 3)); // "Faster game variant"
  deck.push(...Array(n - 1).fill('exploding'));
  s.draw = shuffle(deck);
  s.discard = [];
  s.turnIdx = Math.floor(Math.random() * n);
  s.turnsLeft = 1; s.attacked = false;
  s.pending = null; s.favor = null; s.peek = null; s.winner = null;
  s.phase = 'turn';
  s.log = [`Game on! ${current(s).name} goes first.`];
}

function endTurnStep(s) {
  s.peek = null;
  s.turnsLeft -= 1;
  if (s.turnsLeft <= 0) { s.turnIdx = nextAlive(s, s.turnIdx); s.turnsLeft = 1; s.attacked = false; }
}

function takeCards(p, types) {
  for (const t of types) {
    const i = p.hand.indexOf(t);
    if (i < 0) throw new Error(`You don't have ${CARDS[t].name}.`);
    p.hand.splice(i, 1);
  }
}

function die(s, p) {
  p.alive = false;
  p.hand = []; // cards stay out of play (face down in front of the player)
  say(s, `💥 ${p.name} exploded!`);
  const left = alivePlayers(s);
  if (left.length === 1) {
    s.phase = 'ended'; s.winner = left[0].id; s.peek = null;
    say(s, `🏆 ${left[0].name} wins!`);
  } else {
    s.turnIdx = nextAlive(s, s.turnIdx); s.turnsLeft = 1; s.attacked = false; s.phase = 'turn'; s.peek = null;
  }
}

function drawCard(s) {
  const p = current(s);
  const card = s.draw.shift();
  if (card === 'exploding') {
    say(s, `💣 ${p.name} drew an Exploding Kitten!`);
    if (p.hand.includes('defuse')) s.phase = 'defuse';
    else die(s, p);
  } else {
    p.hand.push(card);
    say(s, `${p.name} drew a card.`);
    endTurnStep(s);
  }
}

function assertMyTurn(s, id) {
  if (s.phase !== 'turn') throw new Error('Not available right now.');
  if (s.pending) throw new Error('Wait for the Nope window to finish.');
  if (current(s).id !== id) throw new Error("It's not your turn.");
}

function checkTarget(s, me, targetId) {
  const t = byId(s, targetId);
  if (!t || !t.alive || t.id === me.id) throw new Error('Pick another player still in the game.');
  if (t.hand.length === 0) throw new Error(`${t.name} has no cards.`);
  return t;
}

// The player the game is currently waiting on (null while a Nope window runs: it resolves itself).
export function blockerId(s) {
  if (s.phase === 'turn') return s.pending ? null : current(s).id;
  if (s.phase === 'defuse' || s.phase === 'reinsert') return current(s).id;
  if (s.phase === 'favor') return s.favor.from;
  return null;
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
  fresh.fast = s.fast;
  fresh.players = keep.map((p) => ({ id: p.id, name: p.name, hand: [], alive: true }));
  fresh.log = ['Back in the lobby.'];
  return fresh;
}

// Take a player out mid-game (left, or went offline). Their cards are discarded.
function removePlayer(s, t) {
  const wasCurrent = current(s).id === t.id;
  t.alive = false; t.left = true;
  t.hand = [];
  say(s, `👋 ${t.name} left the game.`);
  if (s.pending && s.pending.by === t.id) s.pending = null;
  if (s.favor && (s.favor.from === t.id || s.favor.to === t.id)) {
    s.favor = null;
    if (s.phase === 'favor') s.phase = 'turn';
  }
  if (s.peek && s.peek.playerId === t.id) s.peek = null;
  if (s.hostId === t.id) { const h = s.players.find((x) => x.alive); if (h) s.hostId = h.id; }
  const left = alivePlayers(s);
  if (left.length <= 1) {
    s.phase = 'ended'; s.pending = null; s.favor = null; s.peek = null;
    s.winner = left[0] ? left[0].id : null;
    if (left[0]) say(s, `🏆 ${left[0].name} wins!`);
    return;
  }
  if (wasCurrent) {
    s.turnIdx = nextAlive(s, s.turnIdx); s.turnsLeft = 1; s.attacked = false; s.phase = 'turn'; s.peek = null;
  }
}

export function reduce(state, a) {
  const s = clone(state);

  switch (a.type) {
    // ---------- lobby ----------
    case 'join': {
      if (s.phase !== 'lobby') throw new Error('The game has already started.');
      if (byId(s, a.player)) return null;
      if (s.players.length >= MAX_PLAYERS) throw new Error(`This game is full (max ${MAX_PLAYERS}).`);
      s.players.push({ id: a.player, name: a.name, hand: [], alive: true });
      say(s, `${a.name} joined.`);
      return s;
    }
    case 'setFast': {
      if (s.phase !== 'lobby' || a.player !== s.hostId) return null;
      s.fast = !!a.value; return s;
    }
    case 'start': {
      if (a.player !== s.hostId) throw new Error('Only the host can start.');
      if (s.phase !== 'lobby') return null;
      if (s.players.length < 2) throw new Error('Need at least 2 players.');
      dealNewGame(s); return s;
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
      // anyone may remove the player the game is stuck on; only the host may remove others
      if (blockerId(s) !== tgt.id && caller.id !== s.hostId) throw new Error('Only the host can remove players.');
      removePlayer(s, tgt); return s;
    }
    case 'rematch': {
      if (a.player !== s.hostId || s.phase !== 'ended') return null;
      s.players = s.players.filter((p) => !p.left);
      s.phase = 'lobby'; s.winner = null; s.draw = []; s.discard = [];
      s.players.forEach((p) => { p.hand = []; p.alive = true; });
      s.log = ['Back in the lobby.']; return s;
    }
  }

  if (s.phase === 'lobby' || s.phase === 'ended') return null;
  const me = byId(s, a.player);
  if (a.type !== 'resolve' && (!me || !me.alive)) throw new Error('You are out of this round.');

  switch (a.type) {
    // ---------- your turn ----------
    case 'draw': {
      assertMyTurn(s, me.id);
      drawCard(s); return s;
    }
    case 'play': {
      assertMyTurn(s, me.id);
      if (!SINGLE_PLAY.includes(a.card)) throw new Error("That card can't be played on its own.");
      if (a.card === 'favor') checkTarget(s, me, a.target);
      takeCards(me, [a.card]);
      s.discard.push(a.card); s.peek = null;
      s.pending = { by: me.id, kind: 'card', card: a.card, target: a.target || null,
        nopes: 0, seq: 1, top: me.id, id: Math.random().toString(36).slice(2, 9) };
      say(s, `${me.name} played ${CARDS[a.card].name}${a.target ? ` on ${byId(s, a.target).name}` : ''}.`);
      return s;
    }
    case 'combo': {
      assertMyTurn(s, me.id);
      const n = a.count;
      if (![2, 3].includes(n)) throw new Error('Combos need 2 or 3 matching cards.');
      if (a.card === 'exploding') throw new Error('Nope.');
      if (n === 3 && !CARDS[a.named]) throw new Error('Name a card to ask for.');
      const t = checkTarget(s, me, a.target);
      takeCards(me, Array(n).fill(a.card));
      s.discard.push(...Array(n).fill(a.card)); s.peek = null;
      s.pending = { by: me.id, kind: 'combo', card: a.card, count: n, target: t.id,
        named: n === 3 ? a.named : null, nopes: 0, seq: 1, top: me.id, id: Math.random().toString(36).slice(2, 9) };
      say(s, `${me.name} played ${n} × ${CARDS[a.card].name} targeting ${t.name}.`);
      return s;
    }

    // ---------- Nope window ----------
    case 'nope': {
      if (!s.pending) throw new Error('Nothing to Nope right now.');
      if (s.pending.top === me.id) throw new Error("You can't Nope your own card. Wait for someone else.");
      takeCards(me, ['nope']);
      s.discard.push('nope');
      s.pending.nopes += 1; s.pending.seq += 1; s.pending.top = me.id;
      say(s, `🚫 ${me.name} played Nope!`);
      return s;
    }
    case 'resolve': {
      const p = s.pending;
      if (!p || p.seq !== a.seq) return null; // stale timer
      s.pending = null;
      const by = byId(s, p.by);
      const label = p.kind === 'combo' ? `${p.count} × ${CARDS[p.card].name}` : CARDS[p.card].name;
      if (p.nopes % 2 === 1) { say(s, `${by.name}'s ${label} was Noped.`); return s; }

      if (p.kind === 'combo') {
        const t = byId(s, p.target);
        if (!t.alive || t.hand.length === 0) { say(s, `${t.name} has nothing to steal.`); return s; }
        if (p.count === 2) {
          const i = Math.floor(Math.random() * t.hand.length);
          const [c] = t.hand.splice(i, 1); by.hand.push(c);
          say(s, `${by.name} stole a random card from ${t.name}.`);
        } else {
          const i = t.hand.indexOf(p.named);
          if (i >= 0) { t.hand.splice(i, 1); by.hand.push(p.named); say(s, `${by.name} asked for ${CARDS[p.named].name} — and got it from ${t.name}!`); }
          else say(s, `${by.name} asked ${t.name} for ${CARDS[p.named].name} — they don't have it.`);
        }
        return s;
      }

      switch (p.card) {
        case 'attack': {
          // Stacking rule: an already-attacked player passes on their remaining turns + 2; otherwise just 2.
          s.turnsLeft = (s.attacked ? s.turnsLeft : 0) + 2; s.attacked = true;
          s.turnIdx = nextAlive(s, s.turnIdx); s.peek = null;
          say(s, `${current(s).name} must take ${s.turnsLeft} turns.`);
          break;
        }
        case 'skip': say(s, `${by.name} skipped.`); endTurnStep(s); break;
        case 'shuffle': s.draw = shuffle(s.draw); say(s, 'The Draw Pile was shuffled.'); break;
        case 'future': s.peek = { playerId: by.id, cards: s.draw.slice(0, 3) }; break;
        case 'favor': {
          const t = byId(s, p.target);
          if (t.alive && t.hand.length) { s.phase = 'favor'; s.favor = { from: t.id, to: by.id }; say(s, `${t.name} must give ${by.name} a card.`); }
          break;
        }
      }
      return s;
    }

    // ---------- Favor / Defuse ----------
    case 'favorGive': {
      if (s.phase !== 'favor' || s.favor.from !== me.id) throw new Error('Not your decision.');
      takeCards(me, [a.card]);
      byId(s, s.favor.to).hand.push(a.card);
      say(s, `${me.name} gave a card to ${byId(s, s.favor.to).name}.`);
      s.favor = null; s.phase = 'turn'; return s;
    }
    case 'defuse': {
      if (s.phase !== 'defuse' || current(s).id !== me.id) throw new Error('Not your decision.');
      takeCards(me, ['defuse']); s.discard.push('defuse');
      s.phase = 'reinsert';
      say(s, `🧯 ${me.name} defused the kitten!`);
      return s;
    }
    case 'reinsert': {
      if (s.phase !== 'reinsert' || current(s).id !== me.id) throw new Error('Not your decision.');
      const pos = Math.max(0, Math.min(s.draw.length, a.pos | 0));
      s.draw.splice(pos, 0, 'exploding');
      say(s, `${me.name} hid the kitten in the Draw Pile.`);
      s.phase = 'turn'; endTurnStep(s); return s;
    }
  }
  return null;
}
