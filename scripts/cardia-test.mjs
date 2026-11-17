import { newLobby, reduce, blockerId, abPrompt, totals, CARDS } from '../src/cardia/engine.js';
const must = (c, m) => { if (!c) throw new Error('FAIL: ' + m); };
const throws = (fn) => { try { fn(); } catch { return true; } return false; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function fresh() {
  let s = newLobby('A', 'Ann');
  s = reduce(s, { type: 'join', player: 'B', name: 'Bob' });
  return reduce(s, { type: 'start', player: 'A' });
}
const total = (s) => s.hands[0].length + s.hands[1].length + s.decks[0].length + s.decks[1].length
  + s.disc[0].length + s.disc[1].length + s.enc.reduce((n, e) => n + (e[0] ? 1 : 0) + (e[1] ? 1 : 0), 0);
const play = (s, who, id) => { // play the card with this id from hand
  const side = who === 'A' ? 0 : 1;
  const c = s.hands[side].find((x) => x.id === id);
  must(c, `${who} holds card ${id}`);
  return reduce(s, { type: 'play', player: who, uid: c.uid });
};
// Replace both hands (and the decks' tops stay untouched) so a scenario is deterministic.
function rig(h0, h1) {
  const s = fresh();
  const all = [...s.hands[0], ...s.decks[0]], all1 = [...s.hands[1], ...s.decks[1]];
  s.hands[0] = h0.map((id) => all.find((c) => c.id === id)); s.decks[0] = all.filter((c) => !h0.includes(c.id));
  s.hands[1] = h1.map((id) => all1.find((c) => c.id === id)); s.decks[1] = all1.filter((c) => !h1.includes(c.id));
  return s;
}

// ---- lobby rules ----
let l = newLobby('A', 'Ann');
must(throws(() => reduce(l, { type: 'start', player: 'A' })), 'need 2 players');
l = reduce(l, { type: 'join', player: 'B', name: 'Bob' });
must(throws(() => reduce(l, { type: 'join', player: 'C', name: 'Cy' })), 'max 2 players');
must(throws(() => reduce(l, { type: 'start', player: 'B' })), 'only host starts');

// ---- random simulation ----
let games = 0, abilities = 0, ended = { win: 0, draw: 0 }, rounds = 0;
for (let g = 0; g < 1500; g++) {
  let s = fresh(), steps = 0;
  while (s.phase !== 'ended' && steps++ < 2000) {
    must(total(s) === 32, 'card conservation');
    must(blockerId(s), 'someone is always awaited');
    if (s.phase === 'choose') {
      const first = s.face[0] === s.face[1] ? -1 : (s.face[0] ? 0 : 1);
      const order = first >= 0 ? [first, 1 - first] : [0, 1].sort(() => Math.random() - 0.5);
      for (const side of order) {
        if (s.pick[side] != null) continue;
        if (first >= 0 && side !== first && s.pick[first] == null) must(false, 'first player picks before the other');
        s = reduce(s, { type: 'play', player: s.players[side].id, uid: pick(s.hands[side]).uid });
      }
      rounds++;
    } else if (s.phase === 'ability') {
      const pr = abPrompt(s);
      must(pr && pr.opts.length, 'ability prompt has options');
      must(blockerId(s) === s.players[pr.side].id, 'ability owner is awaited');
      abilities++;
      s = reduce(s, { type: 'pick', player: s.players[pr.side].id, value: pick(pr.opts).v });
    }
  }
  must(s.phase === 'ended' && s.winner, 'game ends with a result');
  must(total(s) === 32, 'cards conserved at the end');
  if (s.winner === 'draw') ended.draw++; else ended.win++;
  games++;
}
console.log(`cardia sim ok: ${games} games, ${rounds} rounds, ${abilities} ability picks, ${ended.win} wins / ${ended.draw} draws`);

// ---- targeted rules ----
{ // Hired Blade loses: both cards are discarded, no signet for anyone
  let s = rig([16, 2, 3, 5, 7], [1, 2, 3, 5, 7]);
  s = play(s, 'A', 16); s = play(s, 'B', 1);
  must(s.phase === 'choose' && s.enc.length === 0 && totals(s).join() === '0,0', 'Hired Blade clears the encounter');
}
{ // Fortune Teller: loser's opponent must play face up first next round
  let s = rig([6, 2, 3, 5, 7], [10, 2, 3, 5, 7]);
  s = play(s, 'A', 6); s = play(s, 'B', 10);          // A loses with Fortune Teller -> B must play face up first
  must(s.phase === 'choose' && s.face[1] && !s.face[0], 'Fortune Teller sets face-up for the opponent');
  must(throws(() => reduce(s, { type: 'play', player: 'A', uid: s.hands[0][0].uid })), 'A waits for B');
  must(blockerId(s) === 'B', 'B is awaited first');
  s = reduce(s, { type: 'play', player: 'B', uid: s.hands[1][0].uid });
  must(s.pick[1] != null && blockerId(s) === 'A', 'now A answers');
}
{ // Surgeon: -5 on the opposing card flips nothing now but shows in the log
  let s = rig([3, 2, 4, 5, 7], [9, 2, 4, 5, 7]);
  s = play(s, 'A', 3); s = play(s, 'B', 9);
  must(s.enc[0][1].mod === -5, 'Surgeon gives -5 to the opposing card');
  must(totals(s).join() === '0,1', 'B (9-5=4) still beats A (3)');
}
{ // Mediator turns the encounter into a tie
  let s = rig([4, 2, 3, 5, 7], [9, 2, 3, 5, 7]);
  s = play(s, 'A', 4); s = play(s, 'B', 9);
  must(totals(s).join() === '0,0', 'Mediator: tie, nobody gets the signet');
}
{ // Djinn (via Magistra-free path): Surgeon cannot hit... use Inventor to make Djinn lose, then it wins
  let s = rig([16, 15, 2, 3, 5], [15, 2, 3, 5, 7]);
  s = play(s, 'A', 16); s = play(s, 'B', 15);          // A's 16 beats 15: B (Inventor) activates
  must(s.phase === 'ability' && abPrompt(s).side === 1, 'B must choose for Inventor');
  const pr = abPrompt(s);
  const a16 = pr.opts.find((o) => o.label.includes('Djinn')).v, mine = pr.opts.find((o) => o.label.includes('Inventor')).v;
  must(throws(() => reduce(s, { type: 'pick', player: 'A', value: a16 })), 'only the ability owner picks');
  must(throws(() => reduce(s, { type: 'pick', player: 'B', value: 9999 })), 'invalid option rejected');
  s = reduce(s, { type: 'pick', player: 'B', value: mine });     // +3 on Inventor
  s = reduce(s, { type: 'pick', player: 'B', value: a16 });      // -3 on the Djinn: 13 vs 18
  must(s.enc[0][0].mod === -3 && s.enc[0][1].mod === 3, 'Inventor modifiers applied');
  must(totals(s).join() === '0,1', 'signet flips to B after the modifiers');
}
{ // leaving: the other player wins
  let s = fresh();
  const r = reduce(s, { type: 'leave', player: 'B' });
  must(r.phase === 'ended' && r.winner === 'A', 'opponent wins when a player leaves');
  must(throws(() => reduce(r, { type: 'rematch', player: 'A' })), 'cannot rematch alone');
  const t = reduce(s, { type: 'toLobby', player: 'A' });
  must(t.phase === 'lobby' && t.players.length === 2, 'host can end the game');
}
console.log('cardia rules ok');
