import { useEffect, useRef, useState } from 'react';
import { CARDS, FAC, TARGET, abPrompt, cardSignets, facOf, findCard, firstToPlay, inf, totals } from './engine.js';

function CdCard({ c, big, sel, sig = 0, back, ghost, onClick }) {
  if (ghost) return <div className={`cd-card ghost${big ? ' big' : ''}`} style={{ visibility: ghost === 'hide' ? 'hidden' : 'visible' }} />;
  if (back) return <div className={`cd-card back${big ? ' big' : ''}`} aria-label="Card chosen, hidden"><span className="cd-q">?</span></div>;
  const info = CARDS[c.id];
  const label = `${info.n}, influence ${inf(c)}`;
  const body = (
    <>
      <span className="n"><span>{inf(c)}</span>{c.mod ? <small>{c.base}{c.mod > 0 ? '+' : '−'}{Math.abs(c.mod)}</small> : null}</span>
      <span className="nm">{info.n}</span>
      <span className="ft">
        {c.tok && <i className="tok" title="Ongoing token">∞</i>}
        {Array.from({ length: sig }, (_, k) => <span key={k} className="sg" title="Signet" />)}
      </span>
    </>
  );
  const cls = `cd-card${big ? ' big' : ''}${sel ? ' sel' : ''}`;
  const style = { '--fc': `var(--cd-${facOf(c.id)})` };
  return onClick
    ? <button type="button" className={cls} style={style} onClick={onClick} aria-label={label} aria-pressed={!!sel}>{body}</button>
    : <div className={cls} style={style} aria-label={label}>{body}</div>;
}

export default function CardiaBoard({ s, me, mine, act, isOffline, kick }) {
  const [sel, setSel] = useState(null); // { t: 'hand' | 'board', uid }
  const boardRef = useRef(null);

  const iPlay = !!mine && !mine.left;
  const mySide = Math.max(0, s.players.findIndex((p) => p.id === me.id));
  const opp = 1 - mySide;
  const t = totals(s);
  const prompt = abPrompt(s);
  const first = s.phase === 'choose' ? firstToPlay(s) : -1;
  const myPick = s.phase === 'choose' ? s.pick[mySide] : null;
  const oppPick = s.phase === 'choose' ? s.pick[opp] : null;
  const canPick = iPlay && s.phase === 'choose' && myPick == null && !(first >= 0 && first !== mySide && s.pick[first] == null);
  const nameOf = (side) => s.players[side]?.name;

  // keep the newest encounter in view
  useEffect(() => { const b = boardRef.current; if (b) b.scrollLeft = b.scrollWidth; }, [s.enc.length, myPick, oppPick]);
  // a selected hand card disappears once played; clear stale selections
  useEffect(() => {
    if (!sel) return;
    const ok = sel.t === 'hand' ? s.hands[mySide].some((c) => c.uid === sel.uid) : !!findCard(s, sel.uid);
    if (!ok) setSel(null);
  }, [s, sel, mySide]);

  const faceVisible = (side) => (iPlay && side === mySide) || first === side;
  const pickedCard = (side) => s.hands[side].find((c) => c.uid === s.pick[side]);

  let status;
  if (s.phase === 'ended') status = s.winner === 'draw' ? 'A draw' : `🏆 ${s.players.find((p) => p.id === s.winner)?.name} wins!`;
  else if (s.phase === 'ability') status = prompt.side === mySide && iPlay ? 'Your ability: make a choice' : `${nameOf(prompt.side)} is choosing…`;
  else if (myPick != null) status = `Waiting for ${nameOf(opp)} to choose…`;
  else if (first >= 0 && first === mySide && iPlay) status = `Fortune Teller: play face up first, ${nameOf(opp)} will see your card`;
  else if (first >= 0 && first === opp && oppPick == null && iPlay) status = `Fortune Teller: waiting for ${nameOf(opp)} to play face up…`;
  else if (first >= 0 && first === opp && iPlay) status = `${nameOf(opp)} played face up. Your move`;
  else status = iPlay ? 'Choose a card from your hand' : `Round ${s.round}`;

  const selCard = sel && (sel.t === 'hand' ? s.hands[mySide].find((c) => c.uid === sel.uid) : findCard(s, sel.uid)?.c);
  const strip = (side) => (
    <div className="cd-strip">
      <span className="who">{nameOf(side)}{iPlay && side === mySide ? ' (you)' : ''}{isOffline(s.players[side].id) && !s.players[side].left ? ' · offline' : ''}</span>
      {side !== mySide || !iPlay ? <span>Hand <b>{s.hands[side].length}</b></span> : null}
      <span>Deck <b>{s.decks[side].length}</b></span>
      <span>Discard <b>{s.disc[side].length}</b></span>
      <span className="ring" title="Signets"><i />{t[side]}<small>/{TARGET}</small></span>
    </div>
  );

  const hand = iPlay ? s.hands[mySide].filter((c) => c.uid !== myPick).sort((a, b) => a.base - b.base) : [];

  return (
    <div className="cd">
      <p className="status center-text" aria-live="polite">{status}</p>

      {kick && (
        <p className="offline-banner" role="status">
          ⏳ {kick.name} seems to be offline. {kick.secs > 0 ? `Removing them in ${kick.secs}s unless they come back.` : 'Removing them now…'}
        </p>
      )}

      {strip(opp)}
      <div className="cd-board" ref={boardRef} aria-label="Encounters">
        {s.enc.length === 0 && myPick == null && oppPick == null && <span className="cd-empty">Encounters appear here, left to right.</span>}
        {s.enc.map((e, i) => (
          <div className="cd-enc" key={i}>
            <div className="en">{i + 1}</div>
            {[opp, mySide].map((side, k) => (
              <div key={side} className="cd-slot">
                {e[side]
                  ? <CdCard c={e[side]} sig={cardSignets(s, i, side)} sel={sel?.t === 'board' && sel.uid === e[side].uid}
                      onClick={() => setSel({ t: 'board', uid: e[side].uid })} />
                  : <CdCard ghost="hide" />}
                {k === 0 && <div className="mid" />}
              </div>
            ))}
          </div>
        ))}
        {(myPick != null || oppPick != null) && (
          <div className="cd-enc" aria-label="Cards chosen this round">
            <div className="en">next</div>
            <div className="cd-slot">
              {oppPick != null
                ? (faceVisible(opp) && pickedCard(opp) ? <CdCard c={pickedCard(opp)} /> : <CdCard back />)
                : <CdCard ghost />}
              <div className="mid" />
            </div>
            <div className="cd-slot">
              {myPick != null
                ? (faceVisible(mySide) && pickedCard(mySide) ? <CdCard c={pickedCard(mySide)} /> : <CdCard back />)
                : <CdCard ghost />}
            </div>
          </div>
        )}
      </div>
      {strip(mySide)}

      <div className="cd-log" aria-live="polite">{s.log.slice(-4).map((l, i, a) => <div key={s.log.length - a.length + i}>{l}</div>)}</div>

      <div className="cd-info">
        {selCard ? (
          <>
            <b>{inf(selCard)} {CARDS[selCard.id].n}</b> · {FAC[facOf(selCard.id)]} · {CARDS[selCard.id].t === 'O' ? 'Ongoing' : 'Instant'}<br />
            {CARDS[selCard.id].x}
            {selCard.ab && selCard.ab !== selCard.id && <><br /><i>Copying: {CARDS[selCard.ab].n}</i></>}
            {CARDS[selCard.id].u && <div className="warn">⚠ Ability text reconstructed; check it against your card.</div>}
          </>
        ) : 'Tap any card to read its ability.'}
      </div>

      {prompt && prompt.side === mySide && iPlay && (
        <section className="alert wide">
          <p>{prompt.ask}</p>
          <div className="cd-opts">
            {prompt.opts.map((o) => <button key={String(o.v)} className="btn" onClick={() => act({ type: 'pick', value: o.v })}>{o.label}</button>)}
          </div>
        </section>
      )}

      {iPlay && s.phase !== 'ended' && (
        <>
          <div className="cd-hand">
            {hand.map((c) => (
              <CdCard key={c.uid} c={c} big sel={sel?.t === 'hand' && sel.uid === c.uid} onClick={() => setSel({ t: 'hand', uid: c.uid })} />
            ))}
            {!hand.length && <p className="hint">{myPick != null ? 'Card chosen.' : 'No cards in hand.'}</p>}
          </div>
          <button className="btn primary cd-play" disabled={!canPick || sel?.t !== 'hand'}
            onClick={() => { act({ type: 'play', uid: sel.uid }); setSel(null); }}>
            {myPick != null ? 'Card chosen' : 'Play card'}
          </button>
        </>
      )}
      {!iPlay && s.phase !== 'ended' && <p className="hint spectate">{mine?.left ? 'You left this duel.' : 'You are watching this duel.'}</p>}

      {s.phase === 'ended' && (
        <section className="alert wide">
          <p className="status">{s.reason}</p>
          {s.hostId === me.id ? <button className="btn primary" onClick={() => act({ type: 'rematch' })}>Play again</button> : <p className="hint">The host can start a rematch.</p>}
        </section>
      )}

      {s.hostId === me.id && s.phase !== 'ended' && isOffline(s.players[opp].id) && (
        <button className="btn ghost small" onClick={() => act({ type: 'kick', target: s.players[opp].id })}>Remove {nameOf(opp)}</button>
      )}

      <details className="log">
        <summary>Rules in brief</summary>
        <ul className="rules">
          <li>Each round you both secretly pick a card. The higher influence wins a signet; the lower card activates its ability. First to {TARGET} signets wins.</li>
          <li>Modifiers and tokens can flip past encounters at any time, so signets are always counted from the table. Deck I only, no locations.</li>
          <li>Tap any card to read its ability. Cards marked with ⚠ (Void Mage, Surgeon, Palace Guard, Treasurer) have wording that isn’t printed in the rulebook, so it is a best guess.</li>
        </ul>
      </details>
      <details className="log">
        <summary>Game log</summary>
        <ol>{[...s.log].reverse().slice(0, 40).map((l, i) => <li key={i}>{l}</li>)}</ol>
      </details>
    </div>
  );
}
