// Individual iPhone collection and original packs. No virtual currency or purchases.
import {CARD,CARDS} from './cards.js?v=80';
export const PACK_KEY='duel-packs-v5';
export const PACK_RARITY_DEFAULT={N:65,R:23,SR:9,UR:2.5,SEC:.5};
const makeId=()=>`pack_${(globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2)).replace(/-/g,'').slice(0,18)}`;
export function defaultPack(){return {id:'starter',name:'はじまりの宝箱',ids:[],weights:{...PACK_RARITY_DEFAULT},size:5};}
export function defaultPackStore(){return {packs:[defaultPack()],collection:{},history:[]};}
export function readPackStore(storage){try{const raw=JSON.parse(storage.getItem(PACK_KEY)||'null');if(raw&&Array.isArray(raw.packs)&&raw.collection&&typeof raw.collection==='object')return raw;}catch{}return defaultPackStore();}
export function savePackStore(storage,value){storage.setItem(PACK_KEY,JSON.stringify(value));return value;}
export function newPack(){return {id:makeId(),name:'オリジナルパック',ids:[],weights:{...PACK_RARITY_DEFAULT},size:5};}
export function normalizePack(p){if(!p||typeof p!=='object'||!Array.isArray(p.ids))throw Error('パックデータが不正です');
 const ids=[...new Set(p.ids.filter(x=>typeof x==='string'&&CARD[x]))].slice(0,300);
 const weights=Object.fromEntries(Object.keys(PACK_RARITY_DEFAULT).map(r=>[r,Math.max(0,Math.min(1000,Number(p.weights?.[r])||0))]));
 const size=Math.round(Number(p.size));return {id:typeof p.id==='string'&&p.id.slice(0,5)==='pack_'?p.id:p.id==='starter'?'starter':makeId(),name:String(p.name||'パック').slice(0,30),ids,weights,size:Math.max(1,Math.min(10,size||5))};
}
/** First choose rarity with weights, then uniformly choose a card of that rarity. No stock limit. */
export function openPack(pack,rand=Math.random){const p=normalizePack(pack);const pool=(p.ids.length?p.ids:CARDS.map(c=>c.id)).filter(id=>!!CARD[id]);
 if(!pool.length)throw Error('パックにカードがありません');const byRarity=new Map();for(const id of pool){const r=CARD[id].rarity||'N';if(!byRarity.has(r))byRarity.set(r,[]);byRarity.get(r).push(id);}
 const possible=Object.keys(p.weights).filter(r=>p.weights[r]>0&&byRarity.get(r)?.length);
 if(!possible.length)throw Error('収録カードのレアリティと排出率を確認してください');
 const totalWeight=possible.reduce((s,r)=>s+p.weights[r],0);const picks=[];for(let i=0;i<p.size;i++){let roll=rand()*totalWeight,rarity=possible[possible.length-1];for(const r of possible){roll-=p.weights[r];if(roll<0){rarity=r;break;}}
 const list=byRarity.get(rarity);picks.push(list[Math.floor(rand()*list.length)]);}
 return picks;
}
export function collect(store,ids){for(const id of ids)store.collection[id]=(store.collection[id]||0)+1;store.history.unshift({at:Date.now(),ids});store.history=store.history.slice(0,30);return store;}
