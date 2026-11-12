import { newLobby, reduce } from '../src/engine.js';
import { CARDS } from '../src/cards.js';
let games=0, maxSteps=0;
for (let g=0; g<500; g++){
  const n = 2+(g%9);
  let s = newLobby('p0','P0');
  for(let i=1;i<n;i++) s=reduce(s,{type:'join',player:'p'+i,name:'P'+i});
  s.fast = g%2===0;
  s=reduce(s,{type:'start',player:'p0'});
  { // deck-size sanity: kittens = n-1, defuses = n (in hands) + spares, correct total
    const all=[...s.draw,...s.players.flatMap(p=>p.hand)];
    const d=n<=5?1:2;
    if(all.filter(c=>c==='exploding').length!==n-1) throw new Error('kitten count n='+n);
    const dz=all.filter(c=>c==='defuse').length; if(!s.fast && dz!==n+Math.min(2*d,6*d-n)) throw new Error('defuse count n='+n+' got '+dz);
    if(!s.fast && all.length!==56*d-(4*d-(n-1))-(6*d-n-Math.min(2*d,6*d-n))) throw new Error('total cards n='+n+' got '+all.length);
  }
  let steps=0;
  while(s.phase!=='ended' && steps++<5000){
    if(Math.random()<0.02){ const v=s.players.filter(p=>p.alive&&p.id!=='p0'); if(v.length){ const x=v[Math.floor(Math.random()*v.length)]; let r2=null; try{ r2=reduce(s,{type:Math.random()<0.5?'leave':'kick',player:Math.random()<0.5?x.id:'p0',target:x.id,now:Date.now()}); }catch(e){ if(!/Only the host/.test(e.message)) throw e; } if(r2) s=r2; if(s.phase==='ended'||s.phase==='lobby') break; } }
    const cur=s.players[s.turnIdx]; const now=Date.now();
    const act = (a)=>{ const r=reduce(s,{...a,now}); if(r) s=r; return r; };
    if(s.pending){
      if(Math.random()<0.3){ const o=s.players.find(p=>p.alive&&p.id!==s.pending.top&&p.hand.includes('nope')); if(o){act({type:'nope',player:o.id});continue;} }
      act({type:'resolve',seq:s.pending.seq}); continue;
    }
    if(s.phase==='favor'){ const f=s.players.find(p=>p.id===s.favor.from); act({type:'favorGive',player:f.id,card:f.hand[0]}); continue;}
    if(s.phase==='defuse'){ act({type:'defuse',player:cur.id}); continue;}
    if(s.phase==='reinsert'){ act({type:'reinsert',player:cur.id,pos:Math.floor(Math.random()*(s.draw.length+1))}); continue;}
    const r=Math.random();
    const others=s.players.filter(p=>p.alive&&p.id!==cur.id&&p.hand.length);
    const play=cur.hand.find(c=>['attack','skip','shuffle','future'].includes(c));
    if(r<0.3&&play) act({type:'play',player:cur.id,card:play});
    else if(r<0.4&&cur.hand.includes('favor')&&others.length) act({type:'play',player:cur.id,card:'favor',target:others[0].id});
    else if(r<0.5&&others.length){ const c=Object.keys(CARDS).find(t=>t!=='exploding'&&cur.hand.filter(x=>x===t).length>=2); if(c) act({type:'combo',player:cur.id,card:c,count:2,target:others[0].id}); else act({type:'draw',player:cur.id}); }
    else act({type:'draw',player:cur.id});
  }
  if(s.phase!=='ended'&&s.phase!=='lobby') throw new Error('stuck game '+g);
  if(s.phase==='ended'&&s.players.filter(p=>p.alive).length!==1) throw new Error('alive count');
  games++; maxSteps=Math.max(maxSteps,steps);
}
console.log('ok',games,'games; max steps',maxSteps);
let s=newLobby('a','A'); s=reduce(s,{type:'join',player:'b',name:'B'}); s=reduce(s,{type:'join',player:'c',name:'C'}); s=reduce(s,{type:'start',player:'a'});
s.turnIdx=0; s.turnsLeft=1; s.players[0].hand.push('attack'); s.players[1].hand.push('attack');
s=reduce(s,{type:'play',player:'a',card:'attack',now:0}); s=reduce(s,{type:'resolve',seq:1});
console.log('B turns (expect 2):',s.turnsLeft,'idx',s.turnIdx);
s=reduce(s,{type:'play',player:'b',card:'attack',now:0}); s=reduce(s,{type:'resolve',seq:1});
console.log('C turns (expect 4):',s.turnsLeft,'idx',s.turnIdx);

// ---- Nope rules (rulebook + official FAQ) ----
const mk=()=>{ let s=newLobby('a','A'); s=reduce(s,{type:'join',player:'b',name:'B'}); s=reduce(s,{type:'join',player:'c',name:'C'}); s=reduce(s,{type:'start',player:'a'});
  s.turnIdx=0; s.turnsLeft=1; s.attacked=false; s.players.forEach(p=>p.hand=['defuse']); return s; };
const must=(c,msg)=>{ if(!c) throw new Error('FAIL: '+msg); };
// 1) a player who is NOT the current player can Nope; Noped Skip -> still a's turn
let n=mk(); n.players[0].hand.push('skip'); n.players[2].hand.push('nope');
n=reduce(n,{type:'play',player:'a',card:'skip',now:0});
n=reduce(n,{type:'nope',player:'c',now:0});
must(reduce(n,{type:'resolve',seq:1})===null,'stale resolve must be ignored');
n=reduce(n,{type:'resolve',seq:2});
must(n.turnIdx===0 && n.pending===null,'noped skip should leave it a\'s turn');
must(n.players[2].hand.includes('nope')===false && n.discard.includes('nope'),'nope card goes to discard');
// 2) Nope on a Nope (Yup): the Skip goes through
n=mk(); n.players[0].hand.push('skip'); n.players[1].hand.push('nope'); n.players[0].hand.push('nope');
n=reduce(n,{type:'play',player:'a',card:'skip',now:0});
n=reduce(n,{type:'nope',player:'b',now:0}); n=reduce(n,{type:'nope',player:'a',now:0});
n=reduce(n,{type:'resolve',seq:3});
must(n.turnIdx===1,'double-noped skip should resolve (turn passes to B)');
// 3) Nope on a special combo (pair) cancels the steal
n=mk(); n.players[0].hand.push('cat_taco','cat_taco'); n.players[2].hand.push('nope');
n=reduce(n,{type:'combo',player:'a',card:'cat_taco',count:2,target:'b',now:0});
n=reduce(n,{type:'nope',player:'c',now:0}); const bBefore=n.players[1].hand.length;
n=reduce(n,{type:'resolve',seq:2});
must(n.players[1].hand.length===bBefore && n.players[0].hand.length===1,'noped combo steals nothing');
// 4) cannot Nope when nothing is pending (e.g. Exploding Kitten / Defuse)
n=mk(); n.players[1].hand.push('nope'); n.draw.unshift('exploding'); n=reduce(n,{type:'draw',player:'a'});
must(n.phase==='defuse','kitten drawn -> defuse phase');
let threw=false; try{ reduce(n,{type:'nope',player:'b',now:0}); }catch(e){ threw=true; } must(threw,'cannot Nope a kitten/defuse');
// 5) dead players cannot Nope
n=mk(); n.players[0].hand.push('skip'); n.players[2].hand.push('nope'); n.players[2].alive=false;
n=reduce(n,{type:'play',player:'a',card:'skip',now:0}); threw=false; try{ reduce(n,{type:'nope',player:'c',now:0}); }catch(e){ threw=true; } must(threw,'dead player cannot Nope');
// 6) you cannot Nope your own card (neither the original action nor your own Nope), but you can Nope someone else's Nope (Yup)
n=mk(); n.players[0].hand.push('skip','nope'); n.players[1].hand.push('nope','nope');
n=reduce(n,{type:'play',player:'a',card:'skip',now:0}); threw=false; try{ reduce(n,{type:'nope',player:'a',now:0}); }catch(e){ threw=true; } must(threw,'player cannot Nope their own played card');
n=reduce(n,{type:'nope',player:'b',now:0}); threw=false; try{ reduce(n,{type:'nope',player:'b',now:0}); }catch(e){ threw=true; } must(threw,'player cannot Nope their own Nope');
n=reduce(n,{type:'nope',player:'a',now:0}); must(n.pending.nopes===2 && n.pending.top==='a','original player may Nope the Nope (Yup)');
console.log('nope rules ok');
