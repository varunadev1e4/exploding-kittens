# Card Night: Exploding Kittens, Uno, Cat in the Box, Flip 7, Coup and Duel for Cardia

Small realtime web versions of **Exploding Kittens** (2–10 players), **Uno** (2–10) **Cat in the Box** (2–5), **Flip 7** (2–18), **Coup** (2–6) and **Duel for Cardia** (exactly 2), using the published rulebooks.
React + Vite front end, Supabase (Postgres + Realtime) for shared game state, Vercel for hosting.

## 1. Supabase
1. Create a project at https://supabase.com.
2. SQL Editor → paste `supabase/schema.sql` → Run.
3. Project Settings → API: copy the **Project URL** and the **anon public** key.

## 2. Run locally
```bash
npm install
cp .env.example .env     # paste the URL and anon key
npm run dev
```
Open the printed URL in two browser windows (use a private window for the second player, since your identity is stored in localStorage).

## 3. Deploy to Vercel
1. Push this folder to a GitHub repo.
2. Vercel → Add New Project → import the repo (Vite is auto-detected).
3. Add environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then Deploy.
4. Share the site link. One person clicks **Create a game** and sends the invite link (`https://your-app.vercel.app/#ABCD`) to friends.

## How it works
- `src/engine.js` is a pure rules engine (`reduce(state, action)`), tested by `npm test` (500 simulated games).
- The whole game lives in one `games` row (`state` JSON + `version`). Every move is a compare-and-swap update
  (`where version = old`), so two simultaneous moves (e.g. two people hitting Nope) never overwrite each other.
- Supabase Realtime pushes each change to all players; a 4s poll is a fallback.

## Disconnects
Supabase Realtime Presence shows who is online. If the player the game is waiting on goes offline, everyone sees a
countdown and that player is removed after 60s (15s if they were already gone for a while). Reconnecting in time cancels it.
Removed players' cards are discarded and play continues; if only one player remains they win. In the lobby, offline players
are dropped after 30s. The **Leave** button removes you immediately, and the host can remove any offline player with **Remove**.
Tune `GAME_WAIT`, `SHORT_WAIT`, `LOBBY_WAIT` at the top of `src/Game.jsx`.

## Bigger games
2–5 players use one deck. 6–10 players combine two decks (the rulebook allows combining decks): every card count doubles,
each player still gets 1 Defuse + 7 cards, 2 spare Defuses per deck go back into the pile, and there are always
(players − 1) Exploding Kittens. Change `MAX_PLAYERS` / `decksFor` in `src/engine.js` to tune this.

## Uno
Official rules: 108 cards, 7 each, match colour/number/symbol, Skip, Reverse (acts as Skip with 2 players), Draw Two
(next player draws 2 and is skipped), Wild, and Wild Draw Four **with the challenge rule** (challenge: if the player held a card
of the current colour they draw 4, otherwise you draw 6). Drawing: draw one card, play it if you can or keep it. Say UNO when you
play your second-to-last card (tick "Say UNO with this play"); if you forget, anyone can press **Catch!** and you draw 2
(you can still press **UNO!** first if you're quick). Rounds are scored (number cards face value, Skip/Reverse/Draw Two 20,
Wild/Draw Four 50); first to 500 wins the match and the host can start the next round or a new match.
Players who leave or disconnect have their cards shuffled back into the draw pile.

## Cat in the Box
Quantum trick-taking (rules from the Pegasus/Bezier rulebook). Cards are numbers only; you declare ("observe") a colour when you
play a card, and each colour+number can be observed once per round. Setup per player count: 5p = cards 1–9 (9 each), 4p = 1–8,
3p = 1–6, 2p = 1–5 (10 each; 3 revealed middle cards block board spaces). Each round: set one card aside, predict tricks
(1/2/3 for 4–5 players, 1/3/4 for 3 players, none for 2), play tricks until everyone has one card left. The leader can't lead red
(trump) until red has been observed; playing a colour other than the led colour removes the led colour from you for the round;
red beats everything, else highest of the led colour wins. No legal card = **paradox**: round ends, −1 per trick won, no bonus.
Scoring: 1 per trick, plus a bonus equal to your largest orthogonally connected group of tokens on the research board if your
prediction was exact (2 players: if you won 4 or fewer tricks). A game is as many rounds as players; the start player rotates.
Row order on the board (Red, Blue, Yellow, Green) only affects which tokens count as adjacent; change `ROWS` in `src/cat/engine.js`
if your physical board differs. A player leaving mid-round voids that round and it restarts with the remaining players.

## Flip 7
Rules from The Op Games rulebook (ed. 3.1) and official FAQ. 94 cards: number cards 0–12 (n copies of n, one 0), +2/+4/+6/+8/+10 and ×2
modifiers, and 3 each of Freeze, Flip Three and Second Chance. Hit or Stay; a duplicate number busts you (0 points); 7 different numbers
ends the round for everyone with +15. Freeze banks a player's points and takes them out. Flip Three: three cards one at a time, stopping
on a bust or Flip 7; Freeze/Flip Three drawn during it are played afterwards. Second Chance cancels one duplicate (not a Freeze); a second
copy goes to another active player (or is discarded). Score = numbers, ×2 on numbers only, then +N, then the 15 bonus. The deck is not
reshuffled between rounds (only when it runs out); the dealer passes left. First to 200 at the end of a round wins; ties above 200 play on.
Interpretations: a Second Chance you draw while holding none is kept automatically; the rulebook says 3+ players but 2 is allowed here;
the "card counter" shows the unseen number cards (public information, since all other cards are face up).

## Coup
Base game, 2–6 players, 15 cards (3 each of Duke, Assassin, Captain, Ambassador, Contessa). Everyone starts with 2 coins and 2 hidden
influence; lose both and you are out, last player standing wins. Actions: Income (+1), Foreign Aid (+2, any Duke can block), Coup (pay 7,
unblockable, mandatory at 10+ coins), Tax (Duke, +3), Assassinate (Assassin, pay 3; the Contessa blocks), Steal (Captain, take 2; Captain or
Ambassador blocks) and Exchange (Ambassador, draw 2 and keep as many cards as you have influence). Claims can be bluffs: anyone can challenge
a claim (action or block); a truthful claimer swaps the shown card for a new one and the challenger loses an influence, a bluffer loses one.
Flow: challenge window, then block window (only the target for Assassinate/Steal, anyone for Foreign Aid), then the block can be challenged.
Coins paid for a challenged Assassination are refunded if the bluff is caught, but lost if it is blocked. In a 2-player game the starting
player begins with 1 coin (official rule). Like the other games, hidden cards live in the shared game state, so this is built for friends, not
for cheaters. A player leaving mid-action cancels that action.

## Duel for Cardia
Exactly 2 players, Deck I only (16 cards each, no locations). Each round both players secretly pick a card; the higher influence wins a signet and
the lower card's owner activates its ability (some ask for a choice). Modifiers and ongoing tokens can change past encounters, so signets are
always recounted from the table. First to 5 signets wins; a Djinn that wins by ability ends the game at once. Fortune Teller makes the opponent
play face up first. The wording of Void Mage, Surgeon, Palace Guard and Treasurer is a best guess (marked with a warning in the card info).
If a player leaves, the other wins.

## Adding another game
Write an engine (`newLobby`, `reduce`, `blockerId`) and a Board component, register them in `src/games.js` and the `BOARDS` map in
`src/Room.jsx`. Lobby, invite links, realtime sync and disconnect handling are shared automatically.

## Rules implemented (Exploding Kittens)
Exploding Kittens, Defuse (secret reinsert), Attack (with stacking), Skip, Favor, Shuffle, See the Future,
Nope (any living player, any time, even out of turn; chainable; 7s window that restarts on each Nope and is timed locally by each player so device clocks do not matter), 5 Cat card types, two-of-a-kind (random steal) and
three-of-a-kind (name a card), faster-game variant for small games, correct setup for 2–5 players.
Pairs/triples work with any matching card title, as in the "Special Combos" section.

## Known limitations (fine for friends)
- Hands are hidden in the UI but stored in the shared row, so a determined player could read them via browser dev tools.
  To make it cheat-proof, move `reduce` into a Supabase Edge Function / RPC and store hands in a separate table with RLS.
- Anyone with a game code can join while the lobby is open. Games are never deleted; clear old rows occasionally.
- If someone closes their tab mid-game, the others must wait for them to return (their seat is kept via localStorage).
