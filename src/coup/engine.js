// Coup rules engine (base game: 15 character cards, 2-6 players).
// Same contract as the other engines: reduce(state, action) -> new state | null; throws Error(message) for illegal moves.
//
// A turn: the active player declares an action. Character actions can be challenged by anyone; some actions can then be
// blocked (and a block can be challenged too). Whoever loses a challenge, or is hit by Coup / Assassinate, reveals an influence.
// Last player with influence wins.
//
// State: players[{id,name,coins,cards:[hidden characters],lost:[revealed characters],alive,left}], deck, turnIdx,
// pending (the action being resolved), lose ({pid,then}: who must reveal a card), exchange ({pid,drawn}: Ambassador in progress).

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const COUP_COST = 7;
export const FORCED_COUP = 10;

export const CHARACTERS = ['duke', 'assassin', 'captain', 'ambassador', 'contessa'];
export const CHAR_NAME = { duke: 'Duke', assassin: 'Assassin', captain: 'Captain', ambassador: 'Ambassador', contessa: 'Contessa' };

// claim: character needed (null = anyone may do it); block: characters that can block it; blockBy: who may block.
export const ACTIONS = {
  income:      { name: 'Income',      claim: null,         cost: 0,         target: false, block: null },
  aid:         { name: 'Foreign Aid', claim: null,         cost: 0,         target: false, block: ['duke'], blockBy: 'any' },
  coup:        { name: 'Coup',        claim: null,         cost: COUP_COST, target: true,  block: null },
  tax:         { name: 'Tax',         claim: 'duke',       cost: 0,         target: false, block: null },
  assassinate: { name: 'Assassinate', claim: 'assassin',   cost: 3,         target: true,  block: ['contessa'], blockBy: 'target' },
  steal:       { name: 'Steal',       claim: 'captain',    cost: 0,         target: true,  block: ['captain', 'ambassador'], blockBy: 'target' },
  exchange:    { name: 'Exchange',    claim: 'ambassador', cost: 0,         target: false, block: null },
};

export const buildDeck = () => CHARACTERS.flatMap((c) => [c, c, c]);

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
    game: 'coup', phase: 'lobby', hostId, winner: null, turnIdx: 0, pending: null, lose: null, exchange: null, deck: [],
    players: [freshPlayer(hostId, hostName)],
    log: [`${hostName} created the game.`],
  };
}
function freshPlayer(id, name) {
  return { id, name, coins: 0, cards: [], lost: [], alive: true };
}

const byId = (s, id) => s.players.find((p) => p.id === id);
const say = (s, m) => { s.log.push(m); if (s.log.length > 100) s.log.shift(); };
const aliveList = (s) => s.players.filter((p) => p.alive);

// Who the game is waiting on (used for the offline-player timer).
export function blockerId(s) {
  if (s.phase !== 'play') return null;
  if (s.lose) return s.lose.pid;
  if (s.exchange) return s.exchange.pid;
  if (s.pending) {
    const r = responders(s).find((id) => !s.pending.passed.includes(id));
    if (r) return r;
  }
  const p = s.players[s.turnIdx];
  return p && p.alive ? p.id : null;
}

// Players who may respond (challenge / block / allow) in the current window.
export function responders(s) {
  const pd = s.pending;
  if (!pd) return [];
  const live = aliveList(s);
  if (pd.stage === 'challenge') return live.filter((p) => p.id !== pd.actor).map((p) => p.id);
  if (pd.stage === 'block') {
    if (ACTIONS[pd.action].blockBy === 'target') { const t = byId(s, pd.target); return t && t.alive ? [t.id] : []; }
    return live.filter((p) => p.id !== pd.actor).map((p) => p.id);
  }
  if (pd.stage === 'challengeBlock') return live.filter((p) => p.id !== pd.blocker).map((p) => p.id);
  return [];
}

function checkWin(s) {
  const live = aliveList(s);
  if (live.length > 1) return false;
  s.phase = 'ended'; s.winner = live[0] ? live[0].id : null;
  s.pending = null; s.lose = null; s.exchange = null;
  if (live[0]) say(s, `🏆 ${live[0].name} is the last player standing and wins!`);
  return true;
}

function endTurn(s) {
  s.pending = null; s.lose = null; s.exchange = null;
  if (checkWin(s)) return;
  const n = s.players.length;
  let i = s.turnIdx;
  do { i = (i + 1) % n; } while (!s.players[i].alive);
  s.turnIdx = i;
}

function reveal(s, p, card) {
  p.cards.splice(p.cards.indexOf(card), 1);
  p.lost.push(card);
  say(s, `💀 ${p.name} loses an influence: ${CHAR_NAME[card]}.`);
  if (p.cards.length === 0) { p.alive = false; p.coins = 0; say(s, `☠️ ${p.name} is out of the game.`); }
}

// `pid` must reveal an influence. Auto-reveals when they have only one; otherwise waits for their choice.
function doLose(s, pid, then) {
  const p = byId(s, pid);
  if (!p || !p.alive) { afterLose(s, then); return; }
  if (p.cards.length === 1) { reveal(s, p, p.cards[0]); afterLose(s, then); return; }
  s.lose = { pid, then };
}

function afterLose(s, then) {
  s.lose = null;
  if (checkWin(s)) return;
  const pd = s.pending;
  switch (then) {
    case 'effect': endTurn(s); return;                       // Coup / Assassinate landed
    case 'actorWon': toBlockOrExecute(s); return;            // the action was challenged but the actor had the card
    case 'actorLost': {                                      // bluff caught: action cancelled, coins paid are returned
      const a = byId(s, pd.actor);
      if (a && a.alive) a.coins += pd.paid || 0;
      endTurn(s); return;
    }
    case 'blockerWon': endTurn(s); return;                   // the block was real: action cancelled
    case 'blockerLost': execute(s); return;                  // the block was a bluff: action goes through
  }
}

function replaceCard(s, p, card) {
  p.cards.splice(p.cards.indexOf(card), 1);
  s.deck.push(card);
  s.deck = shuffle(s.deck);
  p.cards.push(s.deck.shift());
}

// Resolve a challenge against `claimerId`'s claim to hold `character`. `challenger` loses an influence if the claim was true.
function resolveChallenge(s, challenger, claimerId, character, thenTrue, thenFalse) {
  const claimer = byId(s, claimerId);
  if (claimer.cards.includes(character)) {
    say(s, `🔍 ${challenger.name} challenges ${claimer.name}, who shows a ${CHAR_NAME[character]}! ${claimer.name} shuffles it back and draws a new card.`);
    replaceCard(s, claimer, character);
    doLose(s, challenger.id, thenTrue);
  } else {
    say(s, `🔍 ${challenger.name} challenges ${claimer.name}, who was bluffing (no ${CHAR_NAME[character]})!`);
    s.notice = pickLine(LIAR_LINES, claimer.name, CHAR_NAME[character]);
    doLose(s, claimer.id, thenFalse);
  }
}

const LIAR_LINES = [
  (n, c) => `🤥 Busted! ${n} has no ${c}. Pants on fire!`,
  (n, c) => `🤥 ${n} was caught lying. The ${c} was imaginary.`,
  (n, c) => `🤥 Nice try, ${n}. Not a ${c} in sight!`,
  (n, c) => `🤥 ${n} bluffed the ${c} and got caught red-handed.`,
];
const pickLine = (lines, ...args) => lines[Math.floor(Math.random() * lines.length)](...args);

function toBlockOrExecute(s) {
  const pd = s.pending, A = ACTIONS[pd.action];
  const actor = byId(s, pd.actor);
  if (!actor || !actor.alive) { endTurn(s); return; }
  if (A.target && !byId(s, pd.target).alive) { say(s, `${A.name} fizzles: the target is already out.`); endTurn(s); return; }
  if (A.block) {
    pd.stage = 'block'; pd.passed = [];
    if (responders(s).length) return; // wait for a block (or for everyone to allow)
  }
  execute(s);
}

function execute(s) {
  const pd = s.pending, actor = byId(s, pd.actor), tgt = pd.target ? byId(s, pd.target) : null;
  if (!actor || !actor.alive) { endTurn(s); return; }
  switch (pd.action) {
    case 'aid': actor.coins += 2; say(s, `${actor.name} takes Foreign Aid (+2).`); endTurn(s); return;
    case 'tax': actor.coins += 3; say(s, `👑 ${actor.name} collects Tax (+3).`); endTurn(s); return;
    case 'steal': {
      if (!tgt.alive) { endTurn(s); return; }
      const amt = Math.min(2, tgt.coins);
      tgt.coins -= amt; actor.coins += amt;
      say(s, `⚓ ${actor.name} steals ${amt} coin${amt === 1 ? '' : 's'} from ${tgt.name}.`); endTurn(s); return;
    }
    case 'assassinate':
      if (!tgt.alive) { endTurn(s); return; }
      say(s, `🗡️ The assassination of ${tgt.name} goes through.`);
      doLose(s, tgt.id, 'effect'); return;
    case 'exchange': {
      const drawn = [s.deck.shift(), s.deck.shift()].filter(Boolean);
      pd.stage = 'exchange'; s.exchange = { pid: actor.id, drawn };
      say(s, `📜 ${actor.name} draws two cards to exchange.`); return;
    }
  }
}

// Called when everyone in the current window has passed.
function windowDone(s) {
  const pd = s.pending;
  if (pd.stage === 'challenge') { toBlockOrExecute(s); return; }
  if (pd.stage === 'block') { execute(s); return; }
  if (pd.stage === 'challengeBlock') {
    say(s, `🛡️ ${byId(s, pd.blocker).name}'s block stands: ${ACTIONS[pd.action].name} is cancelled.`);
    endTurn(s);
  }
}
function checkWindow(s) {
  const pd = s.pending;
  if (!pd || !['challenge', 'block', 'challengeBlock'].includes(pd.stage)) return;
  if (responders(s).every((id) => pd.passed.includes(id))) windowDone(s);
}

function removeFromLobby(s, id) {
  const p = byId(s, id);
  if (!p) return;
  s.players = s.players.filter((x) => x.id !== id);
  if (s.hostId === id && s.players.length) s.hostId = s.players[0].id;
  say(s, `${p.name} left.`);
}

function removePlayer(s, t) {
  const wasTurn = s.players[s.turnIdx] && s.players[s.turnIdx].id === t.id;
  t.left = true; t.alive = false; t.coins = 0;
  s.deck = shuffle([...s.deck, ...t.cards]); t.cards = [];
  say(s, `👋 ${t.name} left the game.`);
  if (s.hostId === t.id) { const h = s.players.find((x) => !x.left); if (h) s.hostId = h.id; }
  if (checkWin(s) || s.phase !== 'play') return;
  const pd = s.pending;
  const involved = wasTurn || (pd && (pd.actor === t.id || pd.target === t.id || pd.blocker === t.id))
    || (s.lose && s.lose.pid === t.id) || (s.exchange && s.exchange.pid === t.id);
  if (involved) {
    // the action can't be resolved without them: cancel it (paid coins go back to the actor) and move on
    if (s.exchange) s.deck = shuffle([...s.deck, ...s.exchange.drawn]);
    const a = pd && byId(s, pd.actor);
    if (pd && a && a.alive && pd.paid) a.coins += pd.paid;
    endTurn(s);
  } else checkWindow(s);
}

function startGame(s) {
  s.players = s.players.filter((p) => !p.left);
  s.deck = shuffle(buildDeck());
  for (const p of s.players) { p.cards = [s.deck.shift(), s.deck.shift()]; p.lost = []; p.coins = 2; p.alive = true; }
  s.turnIdx = Math.floor(Math.random() * s.players.length);
  if (s.players.length === 2) s.players[s.turnIdx].coins = 1; // official 2-player rule: the starting player begins with 1 coin
  s.pending = null; s.lose = null; s.exchange = null; s.winner = null; s.notice = null; s.phase = 'play';
  say(s, `Game on! ${s.players[s.turnIdx].name} goes first.`);
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
      startGame(s); return s;
    }
    case 'leave': {
      const p = byId(s, a.player);
      if (!p) return null;
      if (s.phase === 'lobby') { removeFromLobby(s, p.id); return s; }
      if (s.phase === 'ended' || p.left) return null;
      removePlayer(s, p); return s;
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
      startGame(s); return s;
    }
  }

  if (s.phase !== 'play') return null;
  const me = byId(s, a.player);
  if (!me || me.left) throw new Error('You are not in this game.');
  if (!me.alive) throw new Error('You are out of the game.');
  const pd = s.pending;

  switch (a.type) {
    case 'act': {
      if (s.players[s.turnIdx].id !== me.id) throw new Error("It's not your turn.");
      if (pd || s.lose || s.exchange) throw new Error('Not available right now.');
      const A = ACTIONS[a.action];
      if (!A) throw new Error('Unknown action.');
      s.notice = null; // the "caught lying" banner lasts until the next turn starts
      if (me.coins >= FORCED_COUP && a.action !== 'coup') throw new Error(`You have ${FORCED_COUP}+ coins: you must Coup.`);
      if (me.coins < A.cost) throw new Error(`${A.name} costs ${A.cost} coins.`);
      let tgt = null;
      if (A.target) {
        tgt = byId(s, a.target);
        if (!tgt || !tgt.alive || tgt.id === me.id) throw new Error('Pick another player still in the game.');
      }
      me.coins -= A.cost;
      if (a.action === 'income') { me.coins += 1; say(s, `${me.name} takes Income (+1).`); endTurn(s); return s; }
      if (a.action === 'coup') {
        say(s, `💥 ${me.name} pays ${COUP_COST} and stages a Coup against ${tgt.name}.`);
        s.pending = { actor: me.id, action: 'coup', target: tgt.id, claim: null, stage: 'effect', passed: [], paid: 0 };
        doLose(s, tgt.id, 'effect');
        return s;
      }
      s.pending = { actor: me.id, action: a.action, target: tgt ? tgt.id : null, claim: A.claim, stage: 'challenge', passed: [], paid: A.cost, blocker: null, blockClaim: null };
      if (a.action === 'aid') say(s, `${me.name} tries to take Foreign Aid (+2).`);
      else if (a.action === 'tax') say(s, `👑 ${me.name} claims the Duke to collect Tax.`);
      else if (a.action === 'steal') say(s, `⚓ ${me.name} claims the Captain to steal from ${tgt.name}.`);
      else if (a.action === 'assassinate') say(s, `🗡️ ${me.name} pays 3 and claims the Assassin to kill ${tgt.name}'s influence.`);
      else say(s, `📜 ${me.name} claims the Ambassador to exchange cards.`);
      if (!A.claim) toBlockOrExecute(s); // Foreign Aid can't be challenged, only blocked
      return s;
    }
    case 'pass': {
      if (!pd || !responders(s).includes(me.id) || pd.passed.includes(me.id)) return null;
      pd.passed.push(me.id);
      checkWindow(s);
      return s;
    }
    case 'challenge': {
      if (!pd || (pd.stage !== 'challenge' && pd.stage !== 'challengeBlock')) throw new Error('Nothing to challenge right now.');
      if (!responders(s).includes(me.id)) throw new Error('You cannot challenge this.');
      if (pd.passed.includes(me.id)) throw new Error('You already allowed it.');
      if (pd.stage === 'challenge') resolveChallenge(s, me, pd.actor, pd.claim, 'actorWon', 'actorLost');
      else resolveChallenge(s, me, pd.blocker, pd.blockClaim, 'blockerWon', 'blockerLost');
      return s;
    }
    case 'block': {
      if (!pd || pd.stage !== 'block') throw new Error('Nothing to block right now.');
      if (!responders(s).includes(me.id) || pd.passed.includes(me.id)) throw new Error('You cannot block this.');
      if (!ACTIONS[pd.action].block.includes(a.claim)) throw new Error('That character cannot block this action.');
      pd.blocker = me.id; pd.blockClaim = a.claim; pd.stage = 'challengeBlock'; pd.passed = [];
      say(s, `🛡️ ${me.name} claims the ${CHAR_NAME[a.claim]} to block ${ACTIONS[pd.action].name}.`);
      checkWindow(s);
      return s;
    }
    case 'lose': {
      if (!s.lose || s.lose.pid !== me.id) throw new Error('You are not choosing a card.');
      if (!me.cards.includes(a.card)) throw new Error('You do not have that card.');
      const then = s.lose.then;
      reveal(s, me, a.card);
      afterLose(s, then);
      return s;
    }
    case 'exchangeKeep': {
      if (!s.exchange || s.exchange.pid !== me.id) throw new Error('You are not exchanging cards.');
      const options = [...me.cards, ...s.exchange.drawn];
      const keep = Array.isArray(a.keep) ? a.keep : [];
      if (new Set(keep).size !== keep.length || keep.length !== me.cards.length || keep.some((i) => !Number.isInteger(i) || i < 0 || i >= options.length)) {
        throw new Error(`Keep exactly ${me.cards.length} card${me.cards.length === 1 ? '' : 's'}.`);
      }
      const kept = keep.map((i) => options[i]);
      const back = options.filter((_, i) => !keep.includes(i));
      me.cards = kept;
      s.deck = shuffle([...s.deck, ...back]);
      say(s, `📜 ${me.name} finishes the exchange.`);
      endTurn(s);
      return s;
    }
  }
  return null;
}
