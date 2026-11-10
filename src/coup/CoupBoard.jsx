import { useState } from 'react';
import { ACTIONS, CHAR_NAME, COUP_COST, FORCED_COUP, responders } from './engine.js';

const ICON = { duke: '👑', assassin: '🗡️', captain: '⚓', ambassador: '📜', contessa: '🌹' };

function CoupCard({ c, hidden, dim, selected, onClick, small }) {
  const cls = `cpc${hidden ? ' back' : ` ch-${c}`}${dim ? ' dim' : ''}${selected ? ' sel' : ''}${small ? ' small' : ''}`;
  const inner = hidden ? <span className="ic">?</span> : (<><span className="ic">{ICON[c]}</span><span className="nm">{CHAR_NAME[c]}</span></>);
  return onClick
    ? <button type="button" className={cls} onClick={onClick} aria-pressed={!!selected} title={hidden ? 'Hidden influence' : CHAR_NAME[c]}>{inner}</button>
    : <span className={cls} aria-label={hidden ? 'Hidden influence' : CHAR_NAME[c]} title={hidden ? 'Hidden influence' : `${CHAR_NAME[c]}${dim ? ' (revealed)' : ''}`}>{inner}</span>;
}

const ACTION_HELP = {
  income: 'Take 1 coin. Cannot be blocked.',
  aid: 'Take 2 coins. Any Duke can block it.',
  coup: `Pay ${COUP_COST} coins: a player loses an influence. Cannot be blocked.`,
  tax: 'Duke: take 3 coins.',
  assassinate: 'Assassin: pay 3 coins, a player loses an influence. The Contessa can block it.',
  steal: 'Captain: take 2 coins from a player. A Captain or Ambassador can block it.',
  exchange: 'Ambassador: draw 2 cards, then keep as many as you have influence.',
};

export default function CoupBoard({ s, me, mine, act, isOffline, kick }) {
  const [target, setTarget] = useState('');
  const [keep, setKeep] = useState([]);

  const nameOf = (id) => s.players.find((p) => p.id === id)?.name;
  const cur = s.players[s.turnIdx];
  const pd = s.pending;
  const live = s.players.filter((p) => p.alive);
  const alive = !!mine?.alive;
  const myTurn = s.phase === 'play' && alive && cur?.id === me.id && !pd && !s.lose && !s.exchange;
  const targets = live.filter((p) => p.id !== me.id);
  const tgt = targets.find((p) => p.id === target)?.id || targets[0]?.id;
  const mustCoup = mine?.coins >= FORCED_COUP;
  const waiting = pd ? responders(s).filter((id) => !pd.passed.includes(id)) : [];
  const canRespond = !!pd && alive && waiting.includes(me.id);

  const claimText = (p) => {
    const A = ACTIONS[p.action];
    const who = nameOf(p.actor), tg = p.target ? nameOf(p.target) : '';
    if (p.stage === 'challengeBlock') return `${nameOf(p.blocker)} claims the ${CHAR_NAME[p.blockClaim]} to block ${who}'s ${A.name}${tg ? ` on ${tg}` : ''}.`;
    if (p.action === 'aid') return `${who} takes Foreign Aid (+2).`;
    if (p.stage === 'block') return `${who}'s ${A.name}${tg ? ` on ${tg}` : ''} was not challenged.`;
    return `${who} claims the ${CHAR_NAME[p.claim]}: ${A.name}${tg ? ` ${p.action === 'steal' ? 'from' : 'on'} ${tg}` : ''}.`;
  };

  let status;
  if (s.phase === 'ended') status = s.winner ? `${nameOf(s.winner)} wins!` : 'Game over';
  else if (s.lose) status = `${nameOf(s.lose.pid)} must lose an influence`;
  else if (s.exchange) status = `${nameOf(s.exchange.pid)} is exchanging cards`;
  else if (pd) status = pd.stage === 'challenge' ? 'Challenge window' : pd.stage === 'block' ? 'Block window' : 'Challenge the block?';
  else status = myTurn ? 'Your turn' : `${cur?.name}'s turn`;

  const exchangeOptions = s.exchange && s.exchange.pid === me.id ? [...mine.cards, ...s.exchange.drawn] : null;
  const toggleKeep = (i) => setKeep((k) => (k.includes(i) ? k.filter((x) => x !== i) : k.length >= mine.cards.length ? [...k.slice(1), i] : [...k, i]));

  const actionBtn = (key, extra = {}) => {
    const A = ACTIONS[key];
    const needsTarget = A.target;
    const broke = mine.coins < A.cost;
    const blocked = mustCoup && key !== 'coup';
    return (
      <button key={key} className={`btn${key === 'coup' && mustCoup ? ' primary' : ''}`} title={ACTION_HELP[key]}
        disabled={broke || blocked || (needsTarget && !tgt)}
        onClick={() => act({ type: 'act', action: key, target: needsTarget ? tgt : undefined })} {...extra}>
        {A.claim ? `${ICON[A.claim]} ` : ''}{A.name}{A.cost ? ` (${A.cost})` : ''}
      </button>
    );
  };

  return (
    <>
      <p className="status center-text" aria-live="polite">{status}</p>
      {s.notice && <p className="liar-banner" role="status">{s.notice}</p>}

      {kick && (
        <p className="offline-banner" role="status">
          ⏳ {kick.name} seems to be offline. {kick.secs > 0 ? `Removing them in ${kick.secs}s unless they come back.` : 'Removing them now…'}
        </p>
      )}

      <section className="cp-grid" aria-label="Players">
        {s.players.map((p) => {
          const turn = s.phase === 'play' && cur?.id === p.id && p.alive;
          const isMe = p.id === me.id;
          return (
            <div key={p.id} className={`cp-seat${turn ? ' turn' : ''}${!p.alive ? ' dead' : ''}`}>
              <div className="cp-head">
                <strong>{p.alive ? '' : '💀 '}{p.name}{isMe ? ' (you)' : ''}</strong>
                <span className="coins" title="Coins">🪙 {p.coins}</span>
              </div>
              <div className="cp-sub">
                {p.left ? 'left the game' : !p.alive ? 'eliminated' : turn ? 'taking their turn…' : `${p.cards.length} influence${p.cards.length === 1 ? '' : 's'}`}
                {isOffline(p.id) && !p.left ? ' · offline' : ''}
              </div>
              <div className="cp-cards">
                {p.cards.map((c, i) => <CoupCard key={`h${i}`} c={c} hidden={!isMe} small />)}
                {p.lost.map((c, i) => <CoupCard key={`l${i}`} c={c} dim small />)}
              </div>
              {s.hostId === me.id && p.alive && !isMe && isOffline(p.id) && s.phase !== 'ended' && (
                <button className="btn ghost small" onClick={() => act({ type: 'kick', target: p.id })}>Remove</button>
              )}
            </div>
          );
        })}
      </section>

      {s.phase === 'play' && (
        <section className="alert wide">
          {pd && <p className="claim">{claimText(pd)}</p>}

          {s.lose ? (
            s.lose.pid === me.id ? (
              <>
                <p>Choose an influence to lose:</p>
                <div className="cp-cards big">{mine.cards.map((c, i) => <CoupCard key={i} c={c} onClick={() => act({ type: 'lose', card: c })} />)}</div>
              </>
            ) : <p className="hint">Waiting for {nameOf(s.lose.pid)} to choose a card to lose…</p>
          ) : s.exchange ? (
            exchangeOptions ? (
              <>
                <p>Keep {mine.cards.length} card{mine.cards.length === 1 ? '' : 's'} (the rest go back to the deck):</p>
                <div className="cp-cards big">{exchangeOptions.map((c, i) => <CoupCard key={i} c={c} selected={keep.includes(i)} onClick={() => toggleKeep(i)} />)}</div>
                <button className="btn primary" disabled={keep.length !== mine.cards.length}
                  onClick={() => { act({ type: 'exchangeKeep', keep }); setKeep([]); }}>Keep selected</button>
              </>
            ) : <p className="hint">Waiting for {nameOf(s.exchange.pid)} to pick their cards…</p>
          ) : pd && canRespond ? (
            <>
              <div className="color-row">
                {pd.stage === 'challenge' || pd.stage === 'challengeBlock' ? (
                  <button className="btn nope" onClick={() => act({ type: 'challenge' })}>
                    Challenge {nameOf(pd.stage === 'challengeBlock' ? pd.blocker : pd.actor)}
                  </button>
                ) : null}
                {pd.stage === 'block' && ACTIONS[pd.action].block.map((ch) => (
                  <button key={ch} className="btn primary" onClick={() => act({ type: 'block', claim: ch })}>Block with {ICON[ch]} {CHAR_NAME[ch]}</button>
                ))}
                <button className="btn" onClick={() => act({ type: 'pass' })}>Allow</button>
              </div>
              <p className="hint">
                {pd.stage === 'challenge' && `Challenge if you think ${nameOf(pd.actor)} does not have the ${CHAR_NAME[pd.claim]}. Wrong call and you lose an influence.`}
                {pd.stage === 'block' && (ACTIONS[pd.action].blockBy === 'target' ? 'You are the target: you may block (you can bluff).' : 'Anyone may block this, even by bluffing.')}
                {pd.stage === 'challengeBlock' && `Challenge if you think ${nameOf(pd.blocker)} does not have the ${CHAR_NAME[pd.blockClaim]}.`}
              </p>
            </>
          ) : pd ? (
            <p className="hint">
              {alive ? (waiting.length ? `Waiting for ${waiting.map(nameOf).join(', ')}…` : 'Resolving…') : 'You are out. Watch the finish.'}
            </p>
          ) : myTurn ? (
            <>
              {mustCoup && <p className="hint">You have {FORCED_COUP}+ coins, so you must Coup.</p>}
              {targets.length > 0 && (
                <label className="cp-target">Target
                  <select value={tgt || ''} onChange={(e) => setTarget(e.target.value)}>
                    {targets.map((p) => <option key={p.id} value={p.id}>{p.name} (🪙 {p.coins}, {p.cards.length} cards)</option>)}
                  </select>
                </label>
              )}
              <div className="color-row">
                {['income', 'aid', 'tax', 'exchange', 'steal', 'assassinate', 'coup'].map((k) => actionBtn(k))}
              </div>
              <p className="hint">Hover an action for what it does. Character actions (with an icon) can be bluffed, but may be challenged.</p>
            </>
          ) : <p className="hint">{alive ? `Waiting for ${cur?.name}…` : 'You are out. Watch the finish.'}</p>}
          <p className="hint">Court deck: {s.deck.length} cards</p>
        </section>
      )}

      {s.phase === 'ended' && (
        <section className="alert wide">
          <p className="status">🏆 {nameOf(s.winner)} wins!</p>
          {s.hostId === me.id ? <button className="btn primary" onClick={() => act({ type: 'rematch' })}>Play again</button> : <p className="hint">The host can start a rematch.</p>}
        </section>
      )}

      <details className="log">
        <summary>Quick rules</summary>
        <ul className="rules">
          <li>Everyone starts with 2 coins and 2 hidden influence cards. Lose both and you are out. Last player standing wins.</li>
          <li>Income +1. Foreign Aid +2 (a Duke can block). Coup: pay 7, target loses an influence (mandatory at 10+ coins).</li>
          <li>👑 Duke: Tax +3, blocks Foreign Aid. 🗡️ Assassin: pay 3, target loses an influence. ⚓ Captain: steal 2, blocks stealing. 📜 Ambassador: exchange cards, blocks stealing. 🌹 Contessa: blocks assassination.</li>
          <li>You may claim any character, truthfully or not. Anyone can challenge a claim: if the claimer has the card they swap it for a new one and the challenger loses an influence; if not, the claimer loses one.</li>
        </ul>
      </details>
      <details className="log">
        <summary>Game log</summary>
        <ol>{[...s.log].reverse().slice(0, 30).map((l, i) => <li key={i}>{l}</li>)}</ol>
      </details>
    </>
  );
}
