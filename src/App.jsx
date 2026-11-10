import { useEffect, useState } from 'react';
import { configured, supabase } from './supabase.js';
import { GAMES } from './games.js';
import Room from './Room.jsx';

const ME_KEY = 'ek_me';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid confusion

function loadMe() {
  try {
    const m = JSON.parse(localStorage.getItem(ME_KEY));
    if (m?.id) return m;
  } catch { /* ignore */ }
  return { id: crypto.randomUUID(), name: '' };
}

const codeFromHash = () => (location.hash.replace('#', '').toUpperCase().match(/^[A-Z]{4}$/) || [])[0] || '';

export default function App() {
  const [me, setMe] = useState(loadMe);
  const [code, setCode] = useState(codeFromHash);
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => localStorage.setItem(ME_KEY, JSON.stringify(me)), [me]);
  useEffect(() => {
    const on = () => setCode(codeFromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  if (!configured) {
    return (
      <main className="home">
        <h1>Card Night</h1>
        <p className="card-panel">Supabase isn't configured yet. Copy <code>.env.example</code> to <code>.env</code>,
          fill in your project URL and anon key, then restart <code>npm run dev</code>.</p>
      </main>
    );
  }

  const needName = !me.name.trim();

  async function create(gameId) {
    setBusy(true); setErr('');
    for (let i = 0; i < 5; i++) {
      const c = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
      const { error } = await supabase.from('games').insert({ code: c, state: GAMES[gameId].newLobby(me.id, me.name.trim()), version: 0 });
      if (!error) { location.hash = c; setBusy(false); return; }
      if (error.code !== '23505') { setErr(error.message); setBusy(false); return; } // 23505 = code taken, retry
    }
    setErr('Could not create a game, try again.'); setBusy(false);
  }

  function join(e) {
    e.preventDefault();
    const c = joinCode.trim().toUpperCase();
    if (c.length !== 4) return setErr('Game codes are 4 letters.');
    setErr(''); location.hash = c;
  }

  if (code && !needName) {
    return <Room code={code} me={me} onLeave={() => { location.hash = ''; }} />;
  }

  return (
    <main className="home">
      <div className="logo" aria-hidden>💣</div>
      <h1>Card Night</h1>
      <p className="tagline">Exploding Kittens, Uno, Cat in the Box, Flip 7 and Coup with friends anywhere, no one has to sit at the same table.</p>

      <section className="card-panel">
        <label htmlFor="name">Your name</label>
        <input id="name" maxLength={14} value={me.name} placeholder="e.g. Priya"
          onChange={(e) => setMe({ ...me, name: e.target.value })} />

        {code ? (
          <p className="hint">You're joining game <strong>{code}</strong>. Enter your name to continue.</p>
        ) : (
          <>
            <button className="btn primary" disabled={needName || busy} onClick={() => create('ek')}>💣 New Exploding Kittens game</button>
            <button className="btn primary" disabled={needName || busy} onClick={() => create('uno')}>🎴 New Uno game</button>
            <button className="btn primary" disabled={needName || busy} onClick={() => create('cat')}>📦 New Cat in the Box game</button>
            <button className="btn primary" disabled={needName || busy} onClick={() => create('flip7')}>🔢 New Flip 7 game</button>
            <button className="btn primary" disabled={needName || busy} onClick={() => create('coup')}>👑 New Coup game</button>
            <form onSubmit={join} className="row">
              <input aria-label="Game code" value={joinCode} maxLength={4} placeholder="Game code"
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())} />
              <button className="btn" disabled={needName}>Join</button>
            </form>
          </>
        )}
        {err && <p className="error">{err}</p>}
      </section>
    </main>
  );
}
