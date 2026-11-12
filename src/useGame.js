import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase.js';
import { reduceRoom, switchGame } from './games.js';

// Keeps one game row in sync (realtime + polling fallback) and applies actions with
// optimistic concurrency: the update only succeeds if nobody else changed the row first;
// otherwise we refetch, re-run the action on the latest state, and retry.
export function useGame(code, playerId) {
  const [row, setRow] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState('');
  const [online, setOnline] = useState(() => new Set());
  const [synced, setSynced] = useState(false);
  const rowRef = useRef(null);

  const accept = useCallback((r) => {
    if (!rowRef.current || r.version > rowRef.current.version) {
      rowRef.current = r;
      setRow(r);
    }
  }, []);

  const fetchRow = useCallback(async () => {
    const { data } = await supabase.from('games').select('*').eq('code', code).maybeSingle();
    if (data) accept(data); else if (!rowRef.current) setNotFound(true);
    return data;
  }, [code, accept]);

  useEffect(() => {
    rowRef.current = null; setRow(null); setNotFound(false); setSynced(false);
    fetchRow();
    const channel = supabase
      .channel(`game-${code}`, { config: { presence: { key: playerId } } })
      .on('presence', { event: 'sync' }, () => {
        setOnline(new Set(Object.keys(channel.presenceState())));
        setSynced(true);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `code=eq.${code}` },
        (payload) => payload.new && accept(payload.new))
      .subscribe((status) => { if (status === 'SUBSCRIBED') channel.track({ at: Date.now() }); });
    const poll = setInterval(fetchRow, 4000); // safety net if a websocket drops
    return () => { clearInterval(poll); supabase.removeChannel(channel); };
  }, [code, playerId, fetchRow, accept]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(''), 3500);
    return () => clearTimeout(t);
  }, [error]);

  const dispatch = useCallback(async (action) => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const cur = rowRef.current;
      if (!cur) return false;
      let next;
      try {
        next = action.type === 'setGame'
          ? switchGame(cur.state, action.game, action.player)
          : reduceRoom(cur.state, { ...action, now: Date.now() });
      }
      catch (e) { setError(e.message); return false; }
      if (!next) return false;
      const { data, error: err } = await supabase
        .from('games')
        .update({ state: next, version: cur.version + 1, updated_at: new Date().toISOString() })
        .eq('code', code).eq('version', cur.version)
        .select().maybeSingle();
      if (err) { setError(err.message); return false; }
      if (data) { accept(data); return true; }
      await fetchRow(); // someone else moved first: retry on the fresh state
    }
    setError('Connection is busy, try again.');
    return false;
  }, [code, accept, fetchRow]);

  return { row, state: row?.state, notFound, error, dispatch, online, synced };
}
