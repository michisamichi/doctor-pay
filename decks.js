// v0.4: browser-local saved decks. No deck data is uploaded to Firebase.
import {copyPreset} from './cards.js?v=80';

export const DECK_STORE_KEY='duel-decks-v4';
export const MAX_SAVED_DECKS=30;
const ID_RE=/^(?:[a-z][0-9]{2}|u_[0-9a-f]{16,32})$/;
const cleanName=s=>String(s??'').trim().slice(0,28)||'名前のないデッキ';
export const totalCards=counts=>Object.values(counts||{}).reduce((n,x)=>n+Number(x||0),0);
export function structurallyValidCounts(counts){
  return !!counts&&typeof counts==='object'&&!Array.isArray(counts)&&Object.keys(counts).length<=60&&totalCards(counts)>=20&&totalCards(counts)<=60&&
    Object.entries(counts).every(([id,n])=>ID_RE.test(id)&&Number.isInteger(n)&&n>=1&&n<=3);
}
function id(){
  return 'd_'+(globalThis.crypto?.randomUUID?.().replaceAll('-','').slice(0,20)||`${Date.now().toString(36)}${Math.random().toString(36).slice(2,12)}`);
}
export function newDeck(name='新しいデッキ',counts={}){
  return {id:id(),name:cleanName(name),counts:{...counts},updatedAt:Date.now()};
}
export function normalizeDeckStore(value){
  if(!value||typeof value!=='object'||!Array.isArray(value.decks))return null;
  const decks=[],used=new Set();
  for(const raw of value.decks.slice(0,MAX_SAVED_DECKS)){
    if(!raw||typeof raw!=='object'||typeof raw.id!=='string'||!/^d_[a-z0-9]{8,40}$/.test(raw.id)||used.has(raw.id))continue;
    const counts=raw.counts;
    if(!counts||typeof counts!=='object'||Array.isArray(counts)||Object.keys(counts).length>60||
       !Object.entries(counts).every(([key,n])=>ID_RE.test(key)&&Number.isInteger(n)&&n>=1&&n<=3))continue;
    decks.push({id:raw.id,name:cleanName(raw.name),counts:{...counts},updatedAt:Number(raw.updatedAt)||Date.now()});used.add(raw.id);
  }
  if(!decks.length)return null;
  return {version:4,decks,activeId:used.has(value.activeId)?value.activeId:decks[0].id};
}
export function initialDeckStore(legacyCounts,legacyPreset){
  const red=newDeck('🔥 紅蓮デッキ',copyPreset('red'));
  const blue=newDeck('🌊 蒼海デッキ',copyPreset('blue'));
  const decks=[red,blue];let activeId=legacyPreset==='blue'?blue.id:red.id;
  if(legacyCounts&&structurallyValidCounts(legacyCounts)){
    const same=decks.find(d=>JSON.stringify(Object.entries(d.counts).sort())===JSON.stringify(Object.entries(legacyCounts).sort()));
    if(same)activeId=same.id;
    else{const older=newDeck('以前のマイデッキ',legacyCounts);decks.unshift(older);activeId=older.id;}
  }
  return {version:4,decks,activeId};
}
export function readDeckStore(storage){
  try{
    const existing=storage.getItem(DECK_STORE_KEY);
    if(existing){const valid=normalizeDeckStore(JSON.parse(existing));if(valid)return valid;}
    const old=storage.getItem('duel-deck');
    let parsed=null;try{parsed=old?JSON.parse(old):null;}catch{}
    return initialDeckStore(parsed,storage.getItem('duel-preset'));
  }catch{return initialDeckStore(null,null);}
}
export function writeDeckStore(storage,store){
  const norm=normalizeDeckStore(store);if(!norm)throw Error('デッキ保存データが不正です');
  storage.setItem(DECK_STORE_KEY,JSON.stringify(norm));return norm;
}
export function encodeDeckShare(deck){
  if(!structurallyValidCounts(deck?.counts))throw Error('20〜60枚のデッキだけ共有できます');
  const body=JSON.stringify({v:1,n:cleanName(deck.name),c:Object.entries(deck.counts)});
  const utf8=new TextEncoder().encode(body);let ascii='';for(const byte of utf8)ascii+=String.fromCharCode(byte);
  return btoa(ascii).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
export function decodeDeckShare(code){
  if(typeof code!=='string'||!code||code.length>6000||!/^[A-Za-z0-9_-]+$/.test(code))throw Error('共有リンクが正しくありません');
  let raw;try{
    const ascii=atob(code.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-code.length%4)%4));
    raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(ascii,c=>c.charCodeAt(0))));
  }catch{throw Error('共有リンクを読み込めません');}
  if(raw?.v!==1||typeof raw.n!=='string'||raw.n.length>28||!Array.isArray(raw.c)||raw.c.length>60)throw Error('共有データの形式が違います');
  const counts=Object.create(null);
  for(const p of raw.c){
    if(!Array.isArray(p)||p.length!==2||typeof p[0]!=='string'||!ID_RE.test(p[0])||Object.hasOwn(counts,p[0]))throw Error('カード情報が不正です');
    counts[p[0]]=p[1];
  }
  if(!structurallyValidCounts(counts))throw Error('20〜60枚のデッキではありません');
  return {name:cleanName(raw.n),counts:{...counts}};
}
