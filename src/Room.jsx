import { useEffect, useRef, useState } from 'react';
import { useGame } from './useGame.js';
import { GAMES, gameOf } from './games.js';
import EkBoard from './EkBoard.jsx';
import UnoBoard from './uno/UnoBoard.jsx';
import CatBoard from './cat/CatBoard.jsx';
import Flip7Board from './flip7/Flip7Board.jsx';
import CoupBoard from './coup/CoupBoard.jsx';
import CardiaBoard from './cardia/CardiaBoard.jsx';

const BOARDS = { ek: EkBoard, uno: UnoBoard, cat: CatBoard, flip7: Flip7Board, coup: CoupBoard, cardia: CardiaBoard };

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
  const [view, setView] = useState(null);          // null = automatic, 'lobby' or 'game' once the player chose
  const [confirming, setConfirming] = useState(false);

  const mine = s?.players.find((p) => p.id === me.id);
  const game = s ? gameOf(s) : null;
  const specs = s?.spectators || [];                       // people watching instead of playing
  const isSpec = specs.some((p) => p.id === me.id);

  // Join automatically when opening a room link: as a player if there is a free seat, otherwise as a spectator.
  useEffect(() => {
    if (s && !mine && !isSpec && !leaving.current) dispatch({ type: 'join', player: me.id, name: me.name.trim() });
  }, [s?.phase, !!mine, isSpec]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new game (or a return to the lobby) starts fresh: drop any manual lobby/watch choice and any open dialog.
  useEffect(() => { setView(null); setConfirming(false); }, [s?.phase === 'lobby']); // eslint-disable-line react-hooks/exhaustive-deps

  // Who is offline, and since when (only trusted after the first presence sync).
  useEffect(() => {
    if (!s || !synced) return;
    const t = Date.now();
    setOfflineSince((prev) => {
      const next = {};
      for (const p of [...s.players, ...specs]) if (p.id !== me.id && !online.has(p.id)) next[p.id] = prev[p.id] || t;
      return next;
    });
  }, [online, synced, s?.players.length, specs.length]); // eslint-disable-line react-hooks/exhaustive-deps

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
      target = [...s.players, ...specs].find((p) => offlineSince[p.id]);
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
      } else {
        // nobody is holding the game up: still tidy away spectators who disconnected
        target = specs.find((p) => offlineSince[p.id]);
        if (target) { since = offlineSince[target.id]; wait = LOBBY_WAIT; }
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

  const isHost = s.hostId === me.id;
  // taking part in the game that is running (not left, not just arrived)
  const inPlay = Boolean(mine) && !mine.left;
  const gameRunning = s.phase !== 'lobby';
  // Everyone who isn't playing (latecomers, or players who chose "Back to lobby") waits in the lobby.
  const showLobby = !gameRunning || (view ? view === 'lobby' : !(inPlay || isSpec));

  // Leaving during a game asks first. Anyone playing is out of the round; the host ends it for everyone.
  const askLeave = () => {
    if (gameRunning && !isSpec) setConfirming(true); else leaveRoom();
  };
  const leaveRoom = async () => {
    leaving.current = true;
    if (isSpec || (mine && (!gameRunning || isHost || (s.phase !== 'ended' && mine.alive)))) await act({ type: 'leave' });
    onLeave();
  };
  const toLobby = async () => {
    setConfirming(false);
    if (isHost) { await act({ type: 'toLobby' }); return; }
    if (inPlay && s.phase !== 'ended' && mine.alive) await act({ type: 'leave' });
    setView('lobby');
  };

  const header = (
    <header className="bar">
      <h2>{game.emoji} {game.title}</h2>
      <button className="code" onClick={copy} title="Copy invite link">
        {copied ? 'Link copied' : `Game ${code}`}
      </button>
      <button className="btn ghost" onClick={askLeave}>Leave</button>
    </header>
  );
  const toast = error && <div className="toast" role="alert">{error}</div>;

  const full = s.players.length >= game.max;
  const playing = !isHost && inPlay && s.phase !== 'ended' && mine.alive;
  const dialog = confirming && (
    <div className="backdrop" role="presentation" onClick={() => setConfirming(false)}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="leave-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="leave-title">Leave the game?</h2>
        {isHost && (
          <p className="warn">⚠️ You're the host. If you leave, the game ends and every player goes back to the lobby.</p>
        )}
        {playing && <p>You'll be out of this round. You can join the next game from the lobby.</p>}
        <div className="choices">
          <button className={`btn ${isHost ? 'danger' : 'primary'}`} onClick={toLobby}>
            {isHost ? 'End game and go to lobby' : 'Leave to lobby'}
          </button>
          <button className="btn" onClick={() => { setConfirming(false); leaveRoom(); }}>
            {isHost ? 'End game and leave the room' : 'Leave the room'}
          </button>
          <button className="btn ghost" onClick={() => setConfirming(false)}>Stay in the game</button>
        </div>
      </div>
    </div>
  );

  if (showLobby) {
    return (
      <div className="table">
        {header}
        <main className="lobby card-panel">
          <h1>{gameRunning ? 'Game in progress' : 'Waiting for players'}</h1>
          {gameRunning ? (
            <p className="hint">
              You're in the lobby. A game is already running, you'll be in the next one once the host brings everyone back to the lobby.
            </p>
          ) : (
            <>
              <p className="hint">Send this link to your friends, or give them the code <strong>{code}</strong>.</p>
              <button className="btn" onClick={copy}>{copied ? 'Link copied' : 'Copy invite link'}</button>
              {isHost ? (
                <div className="picker" role="radiogroup" aria-label="Choose a game">
                  {Object.values(GAMES).map((g) => (
                    <button key={g.id} type="button" role="radio" aria-checked={g.id === game.id}
                      className={`pick${g.id === game.id ? ' on' : ''}`} onClick={() => act({ type: 'setGame', game: g.id })}>
                      <span aria-hidden>{g.emoji}</span> {g.title}
                    </button>
                  ))}
                </div>
              ) : <p className="chosen">The host picked <strong>{game.emoji} {game.title}</strong></p>}
              <p className="hint">{game.lobbyNote(s.players.length)}</p>
            </>
          )}
          <h3 className="roster-h">Playing {s.players.length}/{game.max}</h3>
          <ul className="roster">
            {s.players.map((p) => (
              <li key={p.id}>
                <span>{p.name}{p.id === s.hostId ? ' (host)' : ''}{p.id === me.id ? ' (you)' : ''}{isOffline(p.id) ? ' · offline' : ''}</span>
                {!gameRunning && isHost && p.id !== me.id && (
                  <span className="row-actions">
                    <button className="btn ghost small" onClick={() => act({ type: 'setRole', target: p.id, role: 'watch' })}>Watch instead</button>
                    <button className="btn ghost small" onClick={() => act({ type: 'kick', target: p.id })}>Remove</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          {(specs.length > 0 || (full && !gameRunning)) && (
            <>
              <h3 className="roster-h">Watching {specs.length}</h3>
              {specs.length > 0 && (
                <ul className="roster">
                  {specs.map((p) => (
                    <li key={p.id}>
                      <span>👀 {p.name}{p.id === me.id ? ' (you)' : ''}{isOffline(p.id) ? ' · offline' : ''}</span>
                      {!gameRunning && isHost && (
                        <span className="row-actions">
                          <button className="btn ghost small" disabled={full} title={full ? 'All seats are taken' : ''}
                            onClick={() => act({ type: 'setRole', target: p.id, role: 'play' })}>Make player</button>
                          <button className="btn ghost small" onClick={() => act({ type: 'kick', target: p.id })}>Remove</button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <p className="hint">
                {full ? `${game.title} is full (${game.max} players), so anyone else who joins watches. ` : ''}
                {isHost && !gameRunning ? 'You choose who plays: swap people between the lists.' : ''}
              </p>
            </>
          )}
          {gameRunning ? (
            <button className="btn" onClick={() => setView('game')}>Watch the game</button>
          ) : isHost ? (
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
          ) : <p className="hint">{isSpec ? "You're watching. The host chooses who plays and starts the game." : 'The host will start the game.'}</p>}
        </main>
        {toast}
        {dialog}
      </div>
    );
  }

  const Board = BOARDS[s.game || 'ek'];
  return (
    <div className="table">
      {header}
      {specs.length > 0 && <p className="watchers">👀 Watching: {specs.map((p) => p.name).join(', ')}</p>}
      <Board s={s} me={me} mine={mine} act={act} dispatch={dispatch} isOffline={isOffline} kick={kick} />
      {toast}
      {dialog}
    </div>
  );
}
