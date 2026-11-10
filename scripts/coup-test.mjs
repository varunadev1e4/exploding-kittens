import { newLobby, reduce, buildDeck, responders, blockerId, CHARACTERS, ACTIONS } from '../src/coup/engine.js';
const must = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const ids = Array.from({ length: 6 }, (_, i) => 'p' + i);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const throws = (fn) => { try { fn(); } catch { return true; } return false; };
const heldCards = (s) => s.deck.length + s.players.reduce((a, p) => a + p.cards.length + p.lost.length, 0) + (s.exchange ? s.exchange.drawn.length : 0);

must(buildDeck().length === 15 && CHARACTERS.every((c) => buildDeck().filter((x) => x === c).length === 3), '15 cards, 3 of each');

function lobby(n) {
  let s = newLobby('p0', 'P0');
  for (let i = 1; i < n; i++) s = reduce(s, { type: 'join', player: ids[i], name: ids[i] });
  return s;
}

// ---- random simulation, 2..6 players ----
let games = 0, challenges = 0, blocks = 0, coups = 0, exchanges = 0;
for (let g = 0; g < 600; g++) {
  const n = 2 + (g % 5);
  let s = reduce(lobby(n), { type: 'start', player: 'p0' });
  let steps = 0;
  while (s.phase !== 'ended' && steps++ < 20000) {
    must(heldCards(s) === 15, 'card conservation');
    const act = (a) => { const r = reduce(s, a); if (r) s = r; return r; };
    if (Math.random() < 0.002) { const v = s.players.filter((p) => p.alive && p.id !== 'p0'); if (v.length > 1) { act({ type: 'leave', player: pick(v).id }); continue; } }
    if (s.lose) {
      const p = s.players.find((x) => x.id === s.lose.pid);
      must(p.cards.length === 2, 'only asked to choose with 2 cards');
      act({ type: 'lose', player: p.id, card: pick(p.cards) }); continue;
    }
    if (s.exchange) {
      const p = s.players.find((x) => x.id === s.exchange.pid);
      const total = p.cards.length + s.exchange.drawn.length;
      const idx = [...Array(total).keys()].sort(() => Math.random() - 0.5).slice(0, p.cards.length);
      act({ type: 'exchangeKeep', player: p.id, keep: idx }); exchanges++; continue;
    }
    if (s.pending) {
      const pd = s.pending;
      const rs = responders(s).filter((id) => !pd.passed.includes(id));
      must(rs.length > 0, 'a window always has someone to wait for');
      must(blockerId(s) === rs[0], 'blockerId = first pending responder');
      const id = pick(rs);
      const r = Math.random();
      if (pd.stage === 'block' && r < 0.4) { act({ type: 'block', player: id, claim: pick(ACTIONS[pd.action].block) }); blocks++; }
      else if ((pd.stage === 'challenge' || pd.stage === 'challengeBlock') && r < 0.3) { act({ type: 'challenge', player: id }); challenges++; }
      else act({ type: 'pass', player: id });
      continue;
    }
    const p = s.players[s.turnIdx];
    must(p.alive, 'waiting on a living player');
    const targets = s.players.filter((x) => x.alive && x.id !== p.id);
    const t = pick(targets).id;
    let a;
    if (p.coins >= 10) a = 'coup';
    else a = pick(['income', 'aid', 'tax', 'steal', 'exchange', ...(p.coins >= 3 ? ['assassinate'] : []), ...(p.coins >= 7 ? ['coup'] : [])]);
    if (a === 'coup') coups++;
    act({ type: 'act', player: p.id, action: a, target: t });
  }
  must(s.phase === 'ended', 'game finished n=' + n);
  must(s.players.filter((p) => p.alive).length <= 1, 'at most one survivor');
  if (s.players.filter((p) => p.alive).length === 1) must(s.winner === s.players.find((p) => p.alive).id, 'winner is the survivor');
  games++;
}
console.log('coup sim ok:', games, 'games;', challenges, 'challenges;', blocks, 'blocks;', coups, 'coups;', exchanges, 'exchanges');

// ---- targeted rule checks ----
// Clean scriptable position: p0 to move, everyone 2 coins, hands set explicitly.
function mk(n, hands) {
  const s = reduce(lobby(n), { type: 'start', player: 'p0' });
  s.turnIdx = 0;
  s.players.forEach((p, i) => { p.coins = 2; p.cards = [...hands[i]]; p.lost = []; p.alive = true; });
  const used = s.players.flatMap((p) => p.cards);
  const rest = buildDeck(); for (const c of used) rest.splice(rest.indexOf(c), 1);
  s.deck = rest;
  return s;
}
const A = (s, a) => reduce(s, a);

// setup
let s = reduce(lobby(3), { type: 'start', player: 'p0' });
must(s.players.every((p) => p.coins === 2 && p.cards.length === 2) && s.deck.length === 9, '2 coins, 2 cards each');
s = reduce(lobby(2), { type: 'start', player: 'p0' });
must(s.players.map((p) => p.coins).sort().join() === '1,2', '2-player: starting player has 1 coin');
must(throws(() => reduce(lobby(1), { type: 'start', player: 'p0' })), 'needs 2 players');
must(throws(() => { let l = lobby(6); reduce(l, { type: 'join', player: 'x', name: 'x' }); }), 'max 6 players');

// income & foreign aid
s = mk(3, [['duke', 'duke'], ['captain', 'captain'], ['contessa', 'contessa']]);
s = A(s, { type: 'act', player: 'p0', action: 'income' });
must(s.players[0].coins === 3 && s.turnIdx === 1, 'income +1 and passes the turn');
must(throws(() => A(s, { type: 'act', player: 'p0', action: 'income' })), 'not your turn');
s = mk(3, [['captain', 'captain'], ['captain', 'captain'], ['contessa', 'contessa']]);
s = A(s, { type: 'act', player: 'p0', action: 'aid' });
must(s.pending.stage === 'block' && responders(s).length === 2, 'foreign aid goes straight to a block window (no challenge)');
s = A(s, { type: 'pass', player: 'p1' }); s = A(s, { type: 'pass', player: 'p2' });
must(s.players[0].coins === 4 && s.turnIdx === 1, 'foreign aid +2 when nobody blocks');
// foreign aid blocked by duke, block challenged and was a bluff -> aid goes through, bluffer loses card
s = mk(3, [['captain', 'captain'], ['captain', 'contessa'], ['contessa', 'contessa']]);
s = A(s, { type: 'act', player: 'p0', action: 'aid' });
s = A(s, { type: 'block', player: 'p1', claim: 'duke' });
must(s.pending.stage === 'challengeBlock', 'block can be challenged');
must(throws(() => A(s, { type: 'challenge', player: 'p1' })), 'blocker cannot challenge own block');
s = A(s, { type: 'challenge', player: 'p0' });
must(s.lose && s.lose.pid === 'p1', 'bluffing blocker loses influence');
s = A(s, { type: 'lose', player: 'p1', card: 'contessa' });
must(s.players[0].coins === 4 && s.players[1].cards.length === 1 && s.turnIdx === 1, 'aid goes through after a failed block');

// tax challenged: actor truthful -> challenger loses, actor swaps card, tax still pays
s = mk(3, [['duke', 'captain'], ['captain', 'captain'], ['contessa', 'contessa']]);
s = A(s, { type: 'act', player: 'p0', action: 'tax' });
must(s.pending.stage === 'challenge' && responders(s).length === 2, 'tax can be challenged by anyone');
s = A(s, { type: 'challenge', player: 'p1' });
must(s.lose.pid === 'p1', 'wrong challenger loses an influence');
must(s.players[0].cards.length === 2, 'actor drew a replacement');
s = A(s, { type: 'lose', player: 'p1', card: 'captain' });
must(s.players[0].coins === 5 && s.players[1].cards.length === 1 && s.turnIdx === 1, 'tax pays after a failed challenge');
// tax challenged: actor bluffing -> actor loses, no coins
s = mk(3, [['captain', 'captain'], ['captain', 'captain'], ['contessa', 'contessa']]);
s = A(s, { type: 'act', player: 'p0', action: 'tax' });
s = A(s, { type: 'challenge', player: 'p2' });
must(s.lose.pid === 'p0', 'bluffing actor loses influence');
s = A(s, { type: 'lose', player: 'p0', card: 'captain' });
must(s.players[0].coins === 2 && s.players[0].cards.length === 1 && s.turnIdx === 1, 'bluffed tax pays nothing');
// all pass -> tax resolves
s = mk(3, [['captain', 'captain'], ['captain', 'captain'], ['contessa', 'contessa']]);
s = A(s, { type: 'act', player: 'p0', action: 'tax' });
s = A(s, { type: 'pass', player: 'p1' });
must(s.pending && s.players[0].coins === 2, 'waits for every player');
s = A(s, { type: 'pass', player: 'p2' });
must(s.players[0].coins === 5, 'tax +3 once everyone passes');

// coup: costs 7, unblockable, forced at 10
s = mk(3, [['duke', 'duke'], ['captain', 'captain'], ['contessa', 'contessa']]);
must(throws(() => A(s, { type: 'act', player: 'p0', action: 'coup', target: 'p1' })), 'coup needs 7 coins');
s.players[0].coins = 7;
s = A(s, { type: 'act', player: 'p0', action: 'coup', target: 'p1' });
must(s.players[0].coins === 0 && s.lose.pid === 'p1', 'coup costs 7 and target chooses a card');
s = A(s, { type: 'lose', player: 'p1', card: 'captain' });
must(s.players[1].cards.length === 1 && s.turnIdx === 1, 'coup resolves');
s = mk(3, [['duke', 'duke'], ['captain', 'captain'], ['contessa', 'contessa']]);
s.players[0].coins = 10;
must(throws(() => A(s, { type: 'act', player: 'p0', action: 'tax' })), '10+ coins forces a coup');
must(throws(() => A(s, { type: 'act', player: 'p0', action: 'coup', target: 'p0' })), 'cannot coup yourself');

// assassinate: pays 3 up front; challenge success refunds; block (contessa) keeps the money gone
s = mk(3, [['captain', 'captain'], ['duke', 'duke'], ['duke', 'duke']]);
s.players[0].coins = 3;
s = A(s, { type: 'act', player: 'p0', action: 'assassinate', target: 'p1' });
must(s.players[0].coins === 0, 'assassination cost paid up front');
s = A(s, { type: 'challenge', player: 'p2' });
s = A(s, { type: 'lose', player: 'p0', card: 'captain' });
must(s.players[0].coins === 3 && s.players[1].cards.length === 2, 'caught bluffing: coins refunded, target unharmed');
s = mk(3, [['assassin', 'captain'], ['contessa', 'duke'], ['duke', 'duke']]);
s.players[0].coins = 3;
s = A(s, { type: 'act', player: 'p0', action: 'assassinate', target: 'p1' });
s = A(s, { type: 'pass', player: 'p1' }); s = A(s, { type: 'pass', player: 'p2' });
must(s.pending.stage === 'block' && responders(s).join() === 'p1', 'only the target may block an assassination');
must(throws(() => A(s, { type: 'block', player: 'p2', claim: 'contessa' })), 'non-target cannot block');
must(throws(() => A(s, { type: 'block', player: 'p1', claim: 'duke' })), 'only the Contessa blocks an assassination');
s = A(s, { type: 'block', player: 'p1', claim: 'contessa' });
s = A(s, { type: 'pass', player: 'p0' }); s = A(s, { type: 'pass', player: 'p2' });
must(s.players[0].coins === 0 && s.players[1].cards.length === 2 && s.turnIdx === 1, 'blocked assassination: coins are lost, target safe');
// target wrongly challenges a real assassin and then loses a second card
s = mk(3, [['assassin', 'captain'], ['contessa', 'duke'], ['duke', 'duke']]);
s.players[0].coins = 3;
s = A(s, { type: 'act', player: 'p0', action: 'assassinate', target: 'p1' });
s = A(s, { type: 'challenge', player: 'p1' });
s = A(s, { type: 'lose', player: 'p1', card: 'duke' });
must(s.pending && responders(s).join() === 'p1', 'target still gets to block after a failed challenge');
s = A(s, { type: 'pass', player: 'p1' });
must(!s.players[1].alive && s.players[1].lost.length === 2 && s.turnIdx === 2, 'target loses a second influence (last card is revealed automatically)');
// assassination of a player eliminated by their own failed challenge
s = mk(3, [['assassin', 'captain'], ['contessa', 'duke'], ['duke', 'duke']]);
s.players[1].cards = ['contessa']; s.players[1].lost = ['duke'];
s.deck.push('duke'); // keep 15 cards in total
s.players[0].coins = 3;
s = A(s, { type: 'act', player: 'p0', action: 'assassinate', target: 'p1' });
s = A(s, { type: 'challenge', player: 'p1' });
must(!s.players[1].alive && s.turnIdx === 2 && !s.pending, 'challenger down to one card loses it and the assassination fizzles');

// steal: takes up to 2; blockable by captain/ambassador, only by target
s = mk(3, [['captain', 'captain'], ['duke', 'duke'], ['duke', 'duke']]);
s = A(s, { type: 'act', player: 'p0', action: 'steal', target: 'p1' });
s = A(s, { type: 'pass', player: 'p1' }); s = A(s, { type: 'pass', player: 'p2' });
must(responders(s).join() === 'p1', 'steal: only target may block');
s = A(s, { type: 'pass', player: 'p1' });
must(s.players[0].coins === 4 && s.players[1].coins === 0, 'steal takes 2 coins');
s = mk(3, [['captain', 'captain'], ['duke', 'duke'], ['duke', 'duke']]);
s.players[1].coins = 1;
s = A(s, { type: 'act', player: 'p0', action: 'steal', target: 'p1' });
s = A(s, { type: 'pass', player: 'p1' }); s = A(s, { type: 'pass', player: 'p2' }); s = A(s, { type: 'pass', player: 'p1' });
must(s.players[0].coins === 3 && s.players[1].coins === 0, 'steal takes only what they have');
s = mk(3, [['captain', 'captain'], ['ambassador', 'duke'], ['duke', 'duke']]);
s = A(s, { type: 'act', player: 'p0', action: 'steal', target: 'p1' });
s = A(s, { type: 'pass', player: 'p1' }); s = A(s, { type: 'pass', player: 'p2' });
s = A(s, { type: 'block', player: 'p1', claim: 'ambassador' });
s = A(s, { type: 'challenge', player: 'p0' });
must(s.lose.pid === 'p0', 'real ambassador block: challenger loses');
s = A(s, { type: 'lose', player: 'p0', card: 'captain' });
must(s.players[1].coins === 2 && s.turnIdx === 1, 'steal cancelled by a real block');

// exchange: keep as many cards as influence
s = mk(3, [['ambassador', 'captain'], ['duke', 'duke'], ['duke', 'duke']]);
s = A(s, { type: 'act', player: 'p0', action: 'exchange' });
s = A(s, { type: 'pass', player: 'p1' }); s = A(s, { type: 'pass', player: 'p2' });
must(s.exchange && s.exchange.drawn.length === 2 && heldCards(s) === 15, 'exchange draws two');
must(throws(() => A(s, { type: 'exchangeKeep', player: 'p0', keep: [0] })), 'must keep exactly as many as influence');
must(throws(() => A(s, { type: 'exchangeKeep', player: 'p0', keep: [0, 0] })), 'no duplicate picks');
must(throws(() => A(s, { type: 'exchangeKeep', player: 'p1', keep: [0, 1] })), 'only the actor');
const opts = [...s.players[0].cards, ...s.exchange.drawn];
s = A(s, { type: 'exchangeKeep', player: 'p0', keep: [2, 3] });
must(s.players[0].cards.join() === `${opts[2]},${opts[3]}` && heldCards(s) === 15 && s.turnIdx === 1, 'exchange keeps the chosen cards');

// elimination + win
s = mk(2, [['duke', 'duke'], ['captain', 'contessa']]);
s.players[1].cards = ['captain']; s.players[1].lost = ['contessa']; s.deck.push('contessa');
s.players[0].coins = 7;
s = A(s, { type: 'act', player: 'p0', action: 'coup', target: 'p1' });
must(s.phase === 'ended' && s.winner === 'p0', 'last player standing wins');
s = A(s, { type: 'rematch', player: 'p0' });
must(s.phase === 'play' && s.players.every((p) => p.alive && p.cards.length === 2), 'rematch deals a new game');

// leaving mid-game
s = mk(3, [['captain', 'captain'], ['duke', 'duke'], ['duke', 'duke']]);
s = A(s, { type: 'act', player: 'p0', action: 'tax' });
s = A(s, { type: 'leave', player: 'p2' });
must(s.pending && responders(s).join() === 'p1' && heldCards(s) === 15, 'passive responder leaving keeps the window open');
s = A(s, { type: 'pass', player: 'p1' });
must(s.players[0].coins === 5, 'tax resolves once the remaining player passes');
s = mk(3, [['captain', 'captain'], ['duke', 'duke'], ['duke', 'duke']]);
s.players[0].coins = 3;
s = A(s, { type: 'act', player: 'p0', action: 'assassinate', target: 'p1' });
s = A(s, { type: 'leave', player: 'p1' });
must(!s.pending && s.players[0].coins === 3 && s.turnIdx === 2 && heldCards(s) === 15, 'target leaving cancels the action and refunds');
s = A(s, { type: 'leave', player: 'p2' });
must(s.phase === 'ended' && s.winner === 'p0', 'last remaining player wins');

console.log('coup rule checks ok');
