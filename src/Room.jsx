import { useEffect, useRef, useState } from 'react';
import { useGame } from './useGame.js';
import { gameOf } from './games.js';
import EkBoard from './EkBoard.jsx';
import UnoBoard from './uno/UnoBoard.jsx';
import CatBoard from './cat/CatBoard.jsx';
import Flip7Board from './flip7/Flip7Board.jsx';
import CoupBoard from './coup/CoupBoard.jsx';

const BOARDS = { ek: EkBoard, uno: UnoBoard, cat: CatBoard, flip7: Flip7Board, coup: CoupBoard };

const GAME_WAIT = 60000;   // offline player we're waiting on is removed after 60s
const SHORT_WAIT = 15000;  // ...or 15s if they were already gone for a while
const LOBBY_WAIT = 30000;  // lobby: offline players are dropped after 30s

// Shared by every game: connection, lobby, presence (who is online), removing players who disconnect.
export default function Room({ code, me, onLeave }) {
  const { state: s, notFound, error, dispatch, online, synced } = useGame(code, me.id);
  const [copied, setCopied] = useState(false);
  const [offlineSince, setOfflineSince] = useState({});
  const [kick, setKick] = useState(null);
  const [tick, setTick] = useState(0);
  const blockRef = useRef({ key: '', t: 0 });
  const kickedAt = useRef({});
  const leaving = useRef(false);

  const mine = s?.players.find((p) => p.id === me.id);
  const game = s ? gameOf(s) : null;

  // join automatically when opening a lobby link
  useEffect(() => {
    if (s && s.phase === 'lobby' && !mine && !leaving.current) dispatch({ type: 'join', player: me.id, name: me.name.trim() });
  }, [s?.phase, !!mine]); // eslint-disable-line react-hooks/exhaustive-deps

  // Who is offline, and since when (only trusted after the first presence sync).
  useEffect(() => {
    if (!s || !synced) return;
    const t = Date.now();
    setOfflineSince((prev) => {
      const next = {};
      for (const p of s.players) if (p.id !== me.id && !online.has(p.id)) next[p.id] = prev[p.id] || t;
      return next;
    });
  }, [online, synced, s?.players.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Remove the offline player the game is waiting on. Every online player runs this with a small
  // stagger; the engine ignores duplicates, so exactly one removal happens.
  useEffect(() => {
    if (!s || !synced || s.phase === 'ended' || !s.players.some((p) => p.id === me.id)) { setKick(null); return; }
    const t = Date.now();
    let target = null, wait = 0, since = 0;
    if (s.phase === 'lobby') {
      target = s.players.find((p) => offlineSince[p.id]);
      if (target) { since = offlineSince[target.id]; wait = LOBBY_WAIT; }
    } else {
      const b = game.blockerId(s);
      const o = b && offlineSince[b];
      if (o) {
        const key = `${b}|${s.phase}|${s.log.length}`;
        if (blockRef.current.key !== key) blockRef.current = { key, t };
        wait = t - o >= GAME_WAIT ? SHORT_WAIT : GAME_WAIT;
        since = Math.max(o, blockRef.current.t);
        target = s.players.find((p) => p.id === b);
      }
    }
    if (!target) { setKick(null); return; }
    const left = wait - (t - since);
    setKick({ id: target.id, name: target.name, secs: Math.max(0, Math.ceil(left / 1000)) });
    const rank = s.players.filter((p) => p.id !== target.id && (p.id === me.id || online.has(p.id))).findIndex((p) => p.id === me.id);
    if (left + rank * 3000 <= 0 && (kickedAt.current[target.id] || 0) < t - 5000) {
      kickedAt.current[target.id] = t;
      dispatch({ type: 'kick', player: me.id, target: target.id });
    }
  }, [tick, s, offlineSince, online, synced]); // eslint-disable-line react-hooks/exhaustive-deps

  if (notFound) {
    return (
      <main className="home">
        <h1>Game not found</h1>
        <p className="hint">Check the 4-letter code and try again.</p>
        <button className="btn primary" onClick={onLeave}>Back</button>
      </main>
    );
  }
  if (!s) return <main className="home"><p className="hint">Connecting…</p></main>;

  const act = (a) => dispatch({ ...a, player: me.id });
  const link = `${location.origin}${location.pathname}#${code}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };
  const isOffline = (id) => Boolean(offlineSince[id]);

  const leave = async () => {
    const inGame = mine && s.phase !== 'lobby' && s.phase !== 'ended' && mine.alive;
    if (inGame && !window.confirm('Leave the game? You will be out of this round.')) return;
    leaving.current = true;
    if (mine && (s.phase === 'lobby' || inGame)) await act({ type: 'leave' });
    onLeave();
  };

  const header = (
    <header className="bar">
      <h2>{game.emoji} {game.title}</h2>
      <button className="code" onClick={copy} title="Copy invite link">
        {copied ? 'Link copied' : `Game ${code}`}
      </button>
      <button className="btn ghost" onClick={leave}>Leave</button>
    </header>
  );
  const toast = error && <div className="toast" role="alert">{error}</div>;

  if (s.phase === 'lobby') {
    const isHost = s.hostId === me.id;
    return (
      <div className="table">
        {header}
        <main className="lobby card-panel">
          <h1>Waiting for players</h1>
          <p className="hint">Send this link to your friends, or give them the code <strong>{code}</strong>.</p>
          <button className="btn" onClick={copy}>{copied ? 'Link copied' : 'Copy invite link'}</button>
          <p className="hint">{game.lobbyNote(s.players.length)}</p>
          <ul className="roster">
            {s.players.map((p) => (
              <li key={p.id}>
                <span>{p.name}{p.id === s.hostId ? ' (host)' : ''}{p.id === me.id ? ' (you)' : ''}{isOffline(p.id) ? ' · offline' : ''}</span>
                {isHost && p.id !== me.id && (
                  <button className="btn ghost small" onClick={() => act({ type: 'kick', target: p.id })}>Remove</button>
                )}
              </li>
            ))}
          </ul>
          {isHost ? (
            <>
              {game.options.map((o) => (
                <label className="check" key={o.label}>
                  <input type="checkbox" checked={!!o.get(s)} onChange={(e) => act(o.set(e.target.checked))} />
                  {o.label}
                </label>
              ))}
              <button className="btn primary" disabled={s.players.length < 2} onClick={() => act({ type: 'start' })}>
                {s.players.length < 2 ? 'Need 2+ players' : `Start with ${s.players.length} players`}
              </button>
            </>
          ) : <p className="hint">The host will start the game.</p>}
        </main>
        {toast}
      </div>
    );
  }

  const Board = BOARDS[s.game || 'ek'];
  return (
    <div className="table">
      {header}
      <Board s={s} me={me} mine={mine} act={act} dispatch={dispatch} isOffline={isOffline} kick={kick} />
      {toast}
    </div>
  );
}
