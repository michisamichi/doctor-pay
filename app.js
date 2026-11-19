import {CARDS,CARD,PRESETS,copyPreset,validDeck,replaceCustomCards,isSafeCustomCard,effectText,MONSTER_EFFECTS,ORIGINAL_IDS,RARITIES,SPELL_KINDS,spellKind,persistentSpell} from './cards.js?v=80';
import {readDeckStore,writeDeckStore,newDeck,encodeDeckShare,decodeDeckShare,MAX_SAVED_DECKS,totalCards} from './decks.js?v=80';
import {PHASES,createRoom,joinRoom,createDemo,applyAction,normalizeRoom,effectiveAtk} from './engine.js?v=80';
import {LIMITS,cardLimit,TRIGGERS,TARGETS,OPERATIONS,EFFECT_VALUES,abilityText,normalizeRuleSettings,readRuleSettings,writeRuleSettings} from './rules.js?v=80';
import {readPackStore,savePackStore,newPack,normalizePack,openPack,collect} from './packs.js?v=80';
import {VISUAL_CHOICES,SOUND_CHOICES,readFxSettings,writeFxSettings,unlockAudio,playCue,setBgmPlaying} from './fx.js?v=80';

const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Start the UI independently from Firebase. In-app iPhone browsers may deny storage.
const tempStorage=new Map();
let storageAvailable=true;
try {const k='duel-storage-probe';window.localStorage.setItem(k,'1');window.localStorage.removeItem(k);}
catch {storageAvailable=false;}
const storage={
  getItem(k){if(tempStorage.has(k))return tempStorage.get(k);try{return window.localStorage.getItem(k);}catch{return null;}},
  setItem(k,v){try{window.localStorage.setItem(k,String(v));tempStorage.delete(k);}catch{tempStorage.set(k,String(v));}},
  removeItem(k){tempStorage.delete(k);try{window.localStorage.removeItem(k);}catch{}},
};
const stored=(k,fallback)=>{try {const v=storage.getItem(k);return v?JSON.parse(v):fallback;}catch{return fallback;}};
let firebaseConfig=null;
let configReady=false;

const storedDecks=readDeckStore(storage);
const selectedStoredDeck=storedDecks.decks.find(d=>d.id===storedDecks.activeId)||storedDecks.decks[0];
const ui={
  nickname:storage.getItem('duel-name')||'プレイヤー',
  counts:{...selectedStoredDeck.counts},
  decks:storedDecks,deckDraft:null,deckFilterType:'all',deckFilterRarity:'all',
  duelOpen:!!new URLSearchParams(location.search).get('room'),settingsOpen:false,
  galleryOpen:false,gallerySelected:null,galleryFilterType:'all',galleryFilterRarity:'all',
  pendingShare:null,shareError:'',
  game:null,roomCode:'',seat:0,demo:false,selected:null,targetMode:null,deckOpen:false,
  busy:false,sdk:null,db:null,uid:null,unsub:null,cardUnsub:null,toastTimer:null,
  cardsOpen:false,cardDraft:null,customCards:stored('duel-custom-cards',{}),cardBusy:false,
  fxOpen:false,fxSettings:readFxSettings(),lastFxRevision:null,
  rules:readRuleSettings(storage),rulesOpen:false,appearanceOpen:false,appearance:stored('duel-appearance-v5',{mat:'nebula',back:'crest'}),
  packOpen:false,packDraft:null,packResults:null,packs:readPackStore(storage),collectionOnly:false,previewCardId:null,
};
replaceCustomCards(ui.customCards);
try{
  const shared=new URLSearchParams(location.search).get('deck');
  if(shared)ui.pendingShare=decodeDeckShare(shared);
}catch(e){ui.shareError=e.message||'共有リンクを読めません';}

const effectNeedsTarget=id=>{const c=CARD[id];if(c?.type==='spell'&&spellKind(c)==='field'&&c.ability?.when==='continuous')return false;return c?.ability?['ownMonster','enemyMonster'].includes(c.ability.target):['destroy','boost500'].includes(c?.effect);};
const cardTypeName=c=>c.type==='monster'?(c.subtype==='effect'?'効果モンスター':'通常モンスター'):c.type==='spell'?SPELL_KINDS[spellKind(c)]:'罠';
const isMine=()=>!!ui.game?.players?.[ui.seat];
const activePlayer=()=>ui.game?.players?.[ui.seat];
const myTurn=()=>ui.game?.turn===ui.seat&&ui.game?.status==='playing';
const inMain=()=>myTurn()&&!ui.game.pending&&['main1','main2'].includes(ui.game.phase);
const suffix=(c)=>c.type==='monster'?`★${c.level}　ATK ${c.atk} / DEF ${c.def}`:cardTypeName(c);
const sum=totalCards;
const activeSavedDeck=()=>ui.decks.decks.find(d=>d.id===ui.decks.activeId)||ui.decks.decks[0];
const missingCards=counts=>Object.keys(counts||{}).filter(id=>!CARD[id]);
function persistDecks(){ui.decks=writeDeckStore(storage,ui.decks);ui.counts={...activeSavedDeck().counts};storage.setItem('duel-deck',JSON.stringify(ui.counts));}
function toast(msg){const el=$('toast');if(!el)return;el.textContent=msg;el.classList.add('show');clearTimeout(ui.toastTimer);ui.toastTimer=setTimeout(()=>el.classList.remove('show'),3500);}
function setNetwork(msg,status=''){const el=$('network');if(!el)return;el.title=msg;el.textContent=msg.includes('オンライン接続')?'オンライン':msg.includes('お試し')?'練習中':status==='off'?'オフライン':'準備中';el.className='network '+status;}
function setBusy(v){ui.busy=v;const view=$('view');if(view)view.setAttribute('aria-busy',String(v));}
function makeCode(){const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';const bytes=new Uint8Array(8);if(globalThis.crypto?.getRandomValues)crypto.getRandomValues(bytes);else for(let i=0;i<8;i++)bytes[i]=Math.floor(Math.random()*256);return Array.from(bytes,b=>alphabet[b%alphabet.length]).join('');}
function btn(label,action,cls='btn',data='',disabled=false){return `<button type="button" class="${cls}" data-action="${action}" ${data} ${disabled?'disabled':''}>${label}</button>`;}
function cardHtml(id,{hidden=false,def=false,card:previewCard=null}={}){
  if(hidden)return '<div class="card back" aria-label="裏側のカード"><div class="back-emblem">✦</div></div>';
  const c=previewCard||CARD[id];if(!c)return '<div class="card back"><div class="back-emblem">✦</div></div>';
  const face=c.type==='monster'?(c.subtype==='effect'?'effect-monster':'normal-monster'):c.type;
  const rarity=Object.hasOwn(RARITIES,c.rarity)?c.rarity:'N';
  const art=c.image?.startsWith('data:image/jpeg;base64,')||c.image?.startsWith('data:image/webp;base64,')
    ?`<img class="card-art-image" src="${esc(c.image)}" alt="${esc(c.name)}" loading="lazy">`
    :`<div class="card-emoji" aria-hidden="true">${esc(c.emoji||'✦')}</div>`;
  const detail=effectText(c)||c.desc||'';
  return `<div class="card ${esc(face)} rarity-${rarity} ${def?'defense':''}">
    <div class="card-head"><div class="card-name">${esc(c.name)}</div><span class="card-symbol">${c.type==='monster'?'✹':c.type==='spell'?'✦':'✧'}</span></div>
    <span class="card-rarity">${rarity}</span>
    <div class="card-stars">${c.type==='monster'?'★'.repeat(Math.max(1,Math.min(c.level,12))):c.type==='spell'?'SPELL':'TRAP'}</div>
    <div class="card-art">${art}</div>
    <div class="card-lore"><b>${esc(cardTypeName(c))}</b><span>${esc(detail)}</span></div>
    <div class="card-info">${c.type==='monster'?`ATK/${Number(c.atk)} DEF/${Number(c.def)}`:'SAHOVERSE'}</div>
  </div>`;
}

function renderHome(){
  const linkCode=new URLSearchParams(location.search).get('room')||'';
  return `<section class="sv-home" aria-label="ホーム">
    <div class="sv-hero">
      <img src="./sahoverse-icon-192.png?v=80" width="98" height="98" alt="" class="sv-crest">
      <div class="sv-hero-text"><div class="sv-hero-title">SAHOVERSE</div><div class="sv-hero-sub">CARD DUEL</div></div>
    </div>
    ${btn('<span class="sv-duel-icon" aria-hidden="true">⚔</span><span>デュエル</span><span class="sv-chevron" aria-hidden="true">›</span>','openDuel','sv-duel-button')}
    <div class="sv-home-grid">
      ${btn('<span class="sv-menu-icon" aria-hidden="true">◇</span>カード図鑑','openGallery','sv-menu-tile')}
      ${btn('<span class="sv-menu-icon" aria-hidden="true">✦</span>カード管理','openCards','sv-menu-tile')}
      ${btn('<span class="sv-menu-icon" aria-hidden="true">▱</span>デッキ','editDeck','sv-menu-tile')}
      ${btn('<span class="sv-menu-icon" aria-hidden="true">✧</span>パック','openPacks','sv-menu-tile')}
    </div>
    <div class="sv-home-footer">
      ${btn('ルール','openRules','sv-footer-tile')}
      ${btn('設定','openSettings','sv-footer-tile')}
    </div>
  </section>
  ${ui.duelOpen?`<section class="panel sv-duel-setup" id="duel-setup">
    <div class="row between"><h2>デュエル</h2>${btn('×','closeDuel','btn sm square')}</div>
    <div class="form-duo"><div><label class="field-label" for="playerName">プレイヤー名</label>
    <input class="input" id="playerName" maxlength="12" value="${esc(ui.nickname)}" placeholder="プレイヤー"></div>
    <div><label class="field-label" for="activeDeck">デッキ</label>
    <select class="input" id="activeDeck">${ui.decks.decks.map(d=>`<option value="${esc(d.id)}" ${d.id===ui.decks.activeId?'selected':''}>${esc(d.name)} (${sum(d.counts)}枚)</option>`).join('')}</select></div></div>
    ${missingCards(ui.counts).length?`<div class="notice">未登録のカードがあります。カード共有を確認してください。</div>`:''}
    <h3 class="sv-section-title">オンライン対戦</h3>
    ${configReady?`<div class="stack">${btn('部屋を作る','createRoom','btn primary wide')}
    <div class="row"><input id="roomCode" class="input grow" maxlength="8" value="${esc(linkCode)}" placeholder="部屋コード（8文字）" autocapitalize="characters">${btn('参加','joinRoom','btn secondary')}</div></div>`:
    `<div class="notice">オンライン接続の準備ができていません。</div>`}
    <div class="sv-try">${btn('1台で練習','demo','btn secondary wide')}</div>
    ${!storageAvailable?`<div class="notice">端末への保存が制限されています。Safariで開いてください。</div>`:''}
  </section>`:''}
  ${ui.settingsOpen?settingsModal():''}
  ${ui.deckOpen?deckModal():''}${ui.cardsOpen?cardsModal():''}${ui.galleryOpen?galleryModal():''}${ui.fxOpen?fxModal():''}
  ${ui.rulesOpen?ruleModal():''}${ui.appearanceOpen?appearanceModal():''}${ui.packOpen?packModal():''}
  ${ui.pendingShare||ui.shareError?shareImportModal():''}${ui.previewCardId?detailOverlay():''}`;
}
function settingsModal(){
  return `<div class="modal" role="dialog" aria-modal="true" aria-label="設定"><div class="modal-box sv-settings">
    <div class="modal-title-line"><h2>設定</h2>${btn('×','closeSettings','btn sm square')}</div>
    <div class="sv-settings-options">
      ${btn('カード裏面・プレイマット','settingsAppearance','btn secondary wide')}
      ${btn('演出・音量','settingsFx','btn secondary wide')}
      ${btn('ルール設定','settingsRules','btn secondary wide')}
    </div>
  </div></div>`;
}
function fxModal(){
  const f=ui.fxSettings;
  return `<div class="modal" role="dialog" aria-modal="true" aria-label="演出・音量の設定"><div class="modal-box fx-settings">
    <div class="modal-title-line"><h2>✧ 演出・音量</h2>${btn('×','closeFx','btn sm square')}</div>
    <p class="small muted">iPhoneごとに保存されます。対戦中でも変更できます。</p>
    <label class="fx-check"><input id="fxVisualToggle" type="checkbox" ${f.visuals?'checked':''}> アニメーションを表示</label>
    <label class="fx-check"><input id="fxSoundToggle" type="checkbox" ${f.sound?'checked':''}> 効果音を鳴らす</label>
    <label class="fx-check"><input id="fxBgmToggle" type="checkbox" ${f.bgm?'checked':''}> オリジナルBGMを再生</label>
    <label class="field-label" for="fxVolume">音量 <b id="fxVolumeValue">${f.volume}%</b></label>
    <input id="fxVolume" class="fx-slider" type="range" min="0" max="100" step="5" value="${f.volume}">
    <div class="row wrap mt8">${btn('▶ 炎を試す','previewFlame','btn sm secondary')}${btn('▶ 攻撃を試す','previewSlash','btn sm secondary')}${btn('▶ 罠を試す','previewShadow','btn sm secondary')}</div>
    <p class="tiny muted mt8">iPhoneは最初のタップで音声を有効にします。端末の音量設定も確認してください。</p>
    ${btn('閉じる','closeFx','btn primary wide mt8')}
  </div></div>`;
}
function announceCue(event){
  if(!event||!document.getElementById('fx-overlay'))return;
  playCue(event,CARD[event.cardId],ui.fxSettings);
}
function handleRoomCue(room){
  const ev=room?.lastEvent;
  if(ui.lastFxRevision===null){ui.lastFxRevision=ev?.id??room?.revision??0;return;}
  if(ev&&ev.id>ui.lastFxRevision){ui.lastFxRevision=ev.id;announceCue(ev);}
}
function deckModal(){
  if(!ui.deckDraft)return `<div class="modal" role="dialog" aria-modal="true" aria-label="デッキ管理"><div class="modal-box deck-manager">
    <div class="modal-title-line"><h2>▤ マイデッキ</h2>${btn('×','closeDeck','btn sm square')}</div>
    <p class="small muted">このiPhone内に保存。何組でも切り替えて使えます（最大${MAX_SAVED_DECKS}組）。</p>
    <div class="row wrap mt8">${btn('＋ 空から作る','deckNew','btn primary sm','',ui.decks.decks.length>=MAX_SAVED_DECKS)}${btn('🔥 紅蓮で作る','deckNewRed','btn sm','',ui.decks.decks.length>=MAX_SAVED_DECKS)}${btn('🌊 蒼海で作る','deckNewBlue','btn sm','',ui.decks.decks.length>=MAX_SAVED_DECKS)}</div>
    <div class="deck-saved-list">${ui.decks.decks.map(d=>`<section class="saved-deck ${d.id===ui.decks.activeId?'active':''}">
       <div class="row between"><b>${esc(d.name)}</b><span class="pill">${sum(d.counts)} / ${ui.rules.deckSize}枚</span></div>
       <div class="small muted">モンスター ${deckCountType(d.counts,'monster')}・魔法 ${deckCountType(d.counts,'spell')}・罠 ${deckCountType(d.counts,'trap')}</div>
       <div class="deck-controls">
         ${btn(d.id===ui.decks.activeId?'✓ 使用中':'使う','deckSelect','btn sm primary',`data-id="${esc(d.id)}"`,d.id===ui.decks.activeId||!validDeck(d.counts,ui.rules))}
         ${btn('編集','deckEdit','btn sm',`data-id="${esc(d.id)}"`)}
         ${btn('共有','deckShare','btn sm secondary',`data-id="${esc(d.id)}"`,!validDeck(d.counts,ui.rules))}
         ${btn('複製','deckClone','btn sm',`data-id="${esc(d.id)}"`,ui.decks.decks.length>=MAX_SAVED_DECKS)}
         ${btn('削除','deckDelete','btn sm ghost',`data-id="${esc(d.id)}"`,ui.decks.decks.length<=1)}
       </div></section>`).join('')}</div>
    <p class="tiny muted">「共有」はLINEなどで送るデッキ専用リンクです。相手が取り込んでも、あなたのデッキは変わりません。</p>
  </div></div>`;
  const d=ui.deckDraft,counts=d.counts;
  const usable=validDeck(counts,ui.rules)&&(!ui.collectionOnly||Object.entries(counts).every(([id,n])=>n<=(ui.packs.collection[id]||0)));
  return `<div class="modal" role="dialog" aria-modal="true" aria-label="デッキを作成・編集"><div class="modal-box deck-manager">
    <div class="modal-title-line"><h2>デッキ作成・編集</h2>${btn('×','deckBack','btn sm square')}</div>
    <label for="deckName" class="field-label">デッキ名</label><input id="deckName" class="input" maxlength="28" value="${esc(d.name)}">
    <div class="row between mt8"><span class="muted small">禁止0枚・制限1枚・準制限2枚・通常3枚まで</span><b class="deck-total ${usable?'good':''}">${sum(counts)} / ${ui.rules.deckSize}</b></div>
    <label class="fx-check small"><input id="collectionOnly" type="checkbox" ${ui.collectionOnly?'checked':''}> パックで獲得したカードだけでデッキを作る</label>
    <div class="row wrap mt8">${btn('🔥 紅蓮を読み込む','loadRed','btn sm')}${btn('🌊 蒼海を読み込む','loadBlue','btn sm')}${btn('空にする','deckClear','btn sm ghost')}</div>
    <div class="form-duo mt8"><div><label for="deckType" class="field-label">種類</label><select class="input" id="deckType"><option value="all">すべて</option>${['monster','spell','trap'].map(t=>`<option value="${t}" ${ui.deckFilterType===t?'selected':''}>${t==='monster'?'モンスター':t==='spell'?'魔法':'罠'}</option>`).join('')}</select></div>
    <div><label for="deckRarity" class="field-label">レアリティ</label><select class="input" id="deckRarity"><option value="all">すべて</option>${Object.entries(RARITIES).map(([v,n])=>`<option value="${v}" ${ui.deckFilterRarity===v?'selected':''}>${v} ${n}</option>`).join('')}</select></div></div>
    <input id="deckSearch" class="input mt8" placeholder="カード名で探す" autocomplete="off">
    <div class="deck-list mt8">${CARDS.map(c=>`<div class="deck-item" data-cardtype="${esc(c.type)}" data-rarity="${esc(c.rarity||'N')}" data-cardname="${esc(c.name)}">
      <div class="mini-card-preview">${cardHtml(c.id)}</div><div class="grow"><div class="deck-item-title">${esc(c.name)} <span class="rarity-label rarity-text-${esc(c.rarity||'N')}">${esc(c.rarity||'N')}</span></div><div class="deck-item-detail">${esc(suffix(c))} / ${esc(LIMITS[c.limit||'unlimited'].label)} ${ui.collectionOnly?' / 所持'+(ui.packs.collection[c.id]||0)+'枚':''}</div></div>
      ${btn('−','deckMinus','btn sm square',`data-id="${esc(c.id)}"`,!counts[c.id])}<span class="count">${counts[c.id]||0}</span>
      ${btn('＋','deckPlus','btn sm square',`data-id="${esc(c.id)}"`,(counts[c.id]||0)>=Math.min(cardLimit(c),ui.collectionOnly?(ui.packs.collection[c.id]||0):3)||sum(counts)>=ui.rules.deckSize)}</div>`).join('')}</div>
    ${btn(d.isNew?`この${ui.rules.deckSize}枚を保存`:'変更を保存','saveDeck','btn primary wide mt8','',!usable)}
    ${btn('保存せず戻る','deckBack','btn ghost wide mt8')}
  </div></div>`;
}
function deckCountType(counts,type){return Object.entries(counts).reduce((n,[id,count])=>n+(CARD[id]?.type===type?count:0),0);}
function galleryModal(){
  if(ui.gallerySelected){const c=CARD[ui.gallerySelected];if(!c)ui.gallerySelected=null;
    else return `<div class="modal" role="dialog" aria-modal="true" aria-label="カードの詳細"><div class="modal-box gallery-dialog">
    <div class="modal-title-line"><h2>カード詳細</h2>${btn('×','galleryBack','btn sm square')}</div>
    <div class="gallery-detail-card card-demo">${cardHtml(c.id)}</div>
    <h3>${esc(c.name)} <span class="rarity-label rarity-text-${esc(c.rarity||'N')}">${esc(c.rarity||'N')}・${esc(RARITIES[c.rarity]||'ノーマル')}</span></h3>
    <p class="small">${esc(suffix(c))}</p><p class="small muted">${esc(effectText(c)||c.desc||'効果なし')}</p>
    ${btn('一覧に戻る','galleryBack','btn primary wide')}</div></div>`;}
  return `<div class="modal" role="dialog" aria-modal="true" aria-label="カード図鑑"><div class="modal-box gallery-dialog">
    <div class="modal-title-line"><h2>◈ カード図鑑 <span class="tiny muted">${CARDS.length}種類</span></h2>${btn('×','closeGallery','btn sm square')}</div>
    <div class="form-duo"><div><label for="galleryType" class="field-label">カード種類</label><select id="galleryType" class="input"><option value="all">すべて</option>${['monster','spell','trap'].map(t=>`<option value="${t}" ${ui.galleryFilterType===t?'selected':''}>${t==='monster'?'モンスター':t==='spell'?'魔法':'罠'}</option>`).join('')}</select></div>
    <div><label for="galleryRarity" class="field-label">レアリティ</label><select id="galleryRarity" class="input"><option value="all">すべて</option>${Object.entries(RARITIES).map(([v,n])=>`<option value="${v}" ${ui.galleryFilterRarity===v?'selected':''}>${v} ${n}</option>`).join('')}</select></div></div>
    <input id="gallerySearch" class="input mt8" placeholder="名前で検索" autocomplete="off">
    <div class="gallery-grid">${CARDS.map(c=>`<button type="button" class="gallery-entry" data-action="galleryDetail" data-id="${esc(c.id)}" data-cardtype="${esc(c.type)}" data-rarity="${esc(c.rarity||'N')}" data-cardname="${esc(c.name)}">
      <div class="gallery-card">${cardHtml(c.id)}</div><span class="gallery-caption">${esc(c.name)}</span><span class="rarity-label rarity-text-${esc(c.rarity||'N')}">${esc(c.rarity||'N')}</span></button>`).join('')}</div>
    <p class="tiny muted">カードをタップすると、画像・効果・能力値を拡大表示できます。</p>
  </div></div>`;
}
function shareImportModal(){
  if(ui.shareError)return `<div class="modal" role="dialog" aria-modal="true"><div class="modal-box"><h2>共有リンクのエラー</h2><p class="small muted">${esc(ui.shareError)}</p>${btn('閉じる','rejectShare','btn primary wide')}</div></div>`;
  const d=ui.pendingShare;if(!d)return '';
  const absent=missingCards(d.counts);
  return `<div class="modal" role="dialog" aria-modal="true" aria-label="共有デッキを取り込む"><div class="modal-box">
    <h2>▤ 共有デッキを取り込む</h2>
    <div class="panel"><b>${esc(d.name)}</b><div class="small muted">${sum(d.counts)}枚・モンスター ${deckCountType(d.counts,'monster')}枚 / 魔法 ${deckCountType(d.counts,'spell')}枚 / 罠 ${deckCountType(d.counts,'trap')}枚</div></div>
    ${absent.length?`<div class="notice">未受信のオリジナルカードが${absent.length}種類あります。Firebase接続でカード図鑑に追加されると使用可能になります。</div>`:''}
    <p class="small muted">このiPhoneに別のデッキとして保存します。元のデッキは上書きしません。禁止制限・枚数設定が合わない場合は編集が必要です。</p>
    ${btn('このデッキを保存','acceptShare','btn primary wide','',ui.decks.decks.length>=MAX_SAVED_DECKS)}
    ${btn('キャンセル','rejectShare','btn ghost wide mt8')}
  </div></div>`;
}
const selectOptions=(choices,selected)=>Object.entries(choices).map(([value,label])=>`<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(label)}</option>`).join('');
const MAGIC_EFFECTS={draw2:'カードを2枚ドロー',heal1000:'LPを1000回復',destroy:'相手モンスター1体を破壊',boost500:'自分モンスター1体のATK＋500',burn800:'相手に800ダメージ'};
const TRAP_EFFECTS={negate:'攻撃を無効化',counterdestroy:'攻撃したモンスターを破壊',counterburn:'攻撃無効＋700ダメージ'};
const abilityTargets=(op,when)=>({draw:['self'],heal:['self'],damage:['opponent'],boost:['ownMonster'],destroy:when==='attack'?['attacker','enemyMonster','ownMonster']:['enemyMonster','ownMonster'],banish:when==='attack'?['attacker','enemyMonster','ownMonster']:['enemyMonster','ownMonster'],negateAttack:['none']}[op]||['none']);
function draftEffectFields(d){
 const isEffect=d.type!=='monster'||d.subtype==='effect';if(!isEffect)return '';
 const mode=d.type==='spell'&&spellKind(d)==='equip'?'builder':d.ability?'builder':'preset';
 const whenChoices=d.type==='trap'?{attack:TRIGGERS.attack,response:TRIGGERS.response}:d.type==='spell'? (spellKind(d)==='equip'?{continuous:TRIGGERS.continuous}:persistentSpell(d)?{main:TRIGGERS.main,continuous:TRIGGERS.continuous}:{main:TRIGGERS.main}):{main:TRIGGERS.main,summon:TRIGGERS.summon,continuous:TRIGGERS.continuous};
 const when=whenChoices[d.ability?.when]?d.ability.when:Object.keys(whenChoices)[0];
 const operations=when==='continuous'?{boost:OPERATIONS.boost}:when==='response'?Object.fromEntries(Object.entries(OPERATIONS).filter(([k])=>k!=='negateAttack')):OPERATIONS;
 const op=operations[d.ability?.operation]?d.ability.operation:Object.keys(operations)[0];
 const ts=abilityTargets(op,when);
 const targets=Object.fromEntries(ts.map(k=>[k,TARGETS[k]]));
 const target=targets[d.ability?.target]?d.ability.target:ts[0];
 const values=EFFECT_VALUES[op]||[0];
 return `<div class="effect-builder"><h3>✦ 効果エディター</h3><label class="field-label" for="cardEffectMode">設定方式</label>
 ${d.type==='spell'&&spellKind(d)==='equip'?'<p class="small muted">装備魔法は対象モンスターを強化する効果として作成します。</p>':`<select id="cardEffectMode" class="input">${selectOptions({preset:'かんたん効果プリセット',builder:'条件・対象・処理を設定'},mode)}</select>`}
 ${mode==='builder'?`<div class="form-duo"><div><label class="field-label" for="cardAbilityWhen">発動条件</label><select id="cardAbilityWhen" class="input">${selectOptions(whenChoices,when)}</select></div>
 <div><label class="field-label" for="cardAbilityOperation">処理内容</label><select id="cardAbilityOperation" class="input">${selectOptions(operations,op)}</select></div></div>
 <div class="form-duo"><div><label class="field-label" for="cardAbilityTarget">対象</label><select id="cardAbilityTarget" class="input">${selectOptions(targets,target)}</select></div>
 <div><label class="field-label" for="cardAbilityAmount">数値</label><select id="cardAbilityAmount" class="input">${selectOptions(Object.fromEntries(values.map(n=>[String(n),n===0?'指定なし':String(n)])),String(values.includes(d.ability?.amount)?d.ability.amount:values[0]))}</select></div></div>
 <p class="small muted mt8">${esc(abilityText({when,operation:op,target,amount:values.includes(d.ability?.amount)?d.ability.amount:values[0]}))}</p>`:
 `<div class="form-duo">${d.type==='monster'?`<div><label class="field-label" for="cardEffectKind">効果タイプ</label><select class="input" id="cardEffectKind">${selectOptions({continuous:'永続',ignition:'起動',trigger:'召喚時'},d.monsterEffect?.kind||'ignition')}</select></div>`:''}
 <div><label class="field-label" for="cardEffectCode">効果</label><select class="input" id="cardEffectCode">${selectOptions(d.type==='monster'?MONSTER_EFFECTS[d.monsterEffect?.kind||'ignition']:d.type==='spell'?MAGIC_EFFECTS:TRAP_EFFECTS,d.type==='monster'?d.monsterEffect?.code:d.effect)}</select></div></div>`}
 <p class="tiny muted mt8">永続系の魔法は発動後も場に残ります。装備は自分のモンスター1体、フィールド魔法は専用ゾーンです。キラ演出や効果は後から編集できます。</p></div>`;
}
function ruleModal(){const r=ui.rules;
 return `<div class="modal" role="dialog" aria-modal="true"><div class="modal-box"><div class="modal-title-line"><h2>⚙ デュエルルール</h2>${btn('×','closeRules','btn sm square')}</div>
 <p class="small muted">部屋を作る側の設定が対戦に適用されます。設定はこの端末に保存されます。</p>
 <label class="field-label" for="ruleLP">初期LP</label><select class="input" id="ruleLP">${selectOptions({1000:'1000',2000:'2000',4000:'4000',6000:'6000',8000:'8000',10000:'10000',12000:'12000',16000:'16000',20000:'20000'},String(r.lp))}</select>
 <label class="field-label" for="ruleDeck">デッキ枚数</label><select class="input" id="ruleDeck">${selectOptions({20:'20枚',30:'30枚',40:'40枚',50:'50枚',60:'60枚'},String(r.deckSize))}</select>
 <p class="small muted mt8">通常ルールは8000LP・40枚。変更した場合、同じ枚数のデッキが必要です。</p>
 ${btn('保存する','saveRules','btn primary wide')}</div></div>`;
}
function appearanceModal(){const x=ui.appearance;
 return `<div class="modal" role="dialog" aria-modal="true"><div class="modal-box"><div class="modal-title-line"><h2>🎨 デザイン設定</h2>${btn('×','closeAppearance','btn sm square')}</div>
 <label class="field-label" for="matChoice">プレイマット</label><select class="input" id="matChoice">${selectOptions({nebula:'星雲',forest:'森',lava:'溶岩',ocean:'深海'},x.mat)}</select>
 <label class="field-label" for="backChoice">カード裏面</label><select class="input" id="backChoice">${selectOptions({crest:'金の紋章',flame:'炎の渦',ice:'蒼の結晶',midnight:'漆黒'},x.back)}</select>
 <p class="small muted">見た目だけを変更します。このiPhoneごとに保存されます。</p>
 ${btn('閉じる','closeAppearance','btn primary wide')}</div></div>`;
}
function packModal(){const st=ui.packs;
 if(ui.packResults)return `<div class="modal" role="dialog" aria-modal="true"><div class="modal-box pack-manager"><div class="modal-title-line"><h2>✦ 開封結果</h2>${btn('×','packBack','btn sm square')}</div>
 <div class="pack-results">${ui.packResults.map(id=>`<button class="gallery-entry" data-action="packDetail" data-id="${esc(id)}"><div class="gallery-card">${cardHtml(id)}</div><span>${esc(CARD[id]?.name||id)}</span></button>`).join('')}</div>
 <p class="small muted mt8">獲得カードはこのiPhoneのコレクションに保存されます。</p>${btn('戻る','packBack','btn primary wide')}</div></div>`;
 if(ui.packDraft){const d=ui.packDraft,ids=new Set(d.ids);return `<div class="modal" role="dialog" aria-modal="true"><div class="modal-box pack-manager"><div class="modal-title-line"><h2>オリジナルパック作成</h2>${btn('×','packEditorBack','btn sm square')}</div>
 <label class="field-label" for="packName">パック名</label><input class="input" id="packName" maxlength="30" value="${esc(d.name)}">
 <label class="field-label" for="packSize">1回で引く枚数</label><select class="input" id="packSize">${selectOptions(Object.fromEntries(Array.from({length:10},(_,i)=>[i+1,`${i+1}枚`])),String(d.size||5))}</select>
 <h3 class="mt8">レアリティ排出比率（重み）</h3><div class="pack-weights">${Object.keys(RARITIES).map(r=>`<label><span>${r}</span><input data-pack-weight="${r}" class="input" type="number" min="0" max="1000" step="0.5" value="${d.weights?.[r]??0}"></label>`).join('')}</div>
 <p class="tiny muted">比率は合計100でなくても構いません。収録していないレアリティは抽選から除外します。</p>
 <h3 class="mt8">収録カード</h3><p class="small muted">何も選ばない場合は全カードが対象です。選択中：${ids.size}種類</p>
 <div class="pack-card-list">${CARDS.map(c=>`<label class="pack-card-row"><input type="checkbox" data-pack-card="${esc(c.id)}" ${ids.has(c.id)?'checked':''}><span class="rarity-label rarity-text-${esc(c.rarity||'N')}">${esc(c.rarity||'N')}</span><span>${esc(c.name)}</span></label>`).join('')}</div>
 ${btn('パックを保存','packSave','btn primary wide mt8')}${btn('キャンセル','packEditorBack','btn ghost wide mt8')}</div></div>`;}
 return `<div class="modal" role="dialog" aria-modal="true"><div class="modal-box pack-manager"><div class="modal-title-line"><h2>🎁 パック開封</h2>${btn('×','closePacks','btn sm square')}</div>
 <div class="small muted">このiPhoneのコレクション：${Object.values(st.collection).reduce((a,b)=>a+b,0)}枚 / ${Object.keys(st.collection).filter(k=>st.collection[k]>0).length}種類。パックは無料・回数制限なしです。</div>
 <div class="deck-saved-list">${st.packs.map(p=>`<div class="saved-deck"><div class="row between"><b>${esc(p.name)}</b><span class="pill">${p.size}枚</span></div><p class="small muted">${p.ids?.length?p.ids.length+'種類を収録':'全カード収録'}</p>
 <div class="row wrap">${btn('開封する','packOpenOne','btn primary sm',`data-id="${esc(p.id)}"`)}${btn('編集','packEdit','btn sm',`data-id="${esc(p.id)}"`)}${p.id!=='starter'?btn('削除','packDelete','btn ghost sm',`data-id="${esc(p.id)}"`):''}</div></div>`).join('')}</div>
 ${btn('＋ 新しいパックを作る','packNew','btn secondary wide','',st.packs.length>=25)}
 <h3 class="mt8">獲得カード</h3><div class="collection-grid">${Object.entries(st.collection).filter(([id,n])=>n>0&&CARD[id]).sort((a,b)=>a[0].localeCompare(b[0])).map(([id,n])=>`<button data-action="packDetail" data-id="${esc(id)}" class="collection-item">${esc(CARD[id].emoji||'✦')} ${esc(CARD[id].name)} ×${n}</button>`).join('')||'<p class="small muted">まだカードを獲得していません。</p>'}</div>
 </div></div>`;
}
function detailOverlay(){const c=CARD[ui.previewCardId];if(!c)return '';
 return `<div class="modal modal-detail" role="dialog" aria-modal="true"><div class="modal-box gallery-dialog"><div class="modal-title-line"><h2>カード詳細</h2>${btn('×','closePreview','btn sm square')}</div>
 <div class="gallery-detail-card card-demo">${cardHtml(c.id)}</div><h3>${esc(c.name)} <span class="rarity-label">${esc(c.rarity||'N')}</span></h3>
 <p>${esc(suffix(c))}</p><p class="small muted">${esc(effectText(c)||c.desc||'効果なし')}</p><p class="small muted">枚数制限：${esc(LIMITS[c.limit||'unlimited'].label)}</p>${btn('閉じる','closePreview','btn primary wide')}</div></div>`;
}
function appearanceApply(){const a=$('app');if(a){a.dataset.mat=ui.appearance.mat;a.dataset.back=ui.appearance.back;}}
function persistAppearance(){storage.setItem('duel-appearance-v5',JSON.stringify(ui.appearance));appearanceApply();}
function savePackDraftFields(){const d=ui.packDraft;if(!d)return;d.name=$('packName')?.value||d.name;d.size=Number($('packSize')?.value||d.size);
 document.querySelectorAll('[data-pack-weight]').forEach(x=>d.weights[x.dataset.packWeight]=Math.max(0,Number(x.value)||0));}

function newCardDraft(){
  const random=typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID().replace(/-/g,'').slice(0,24):`${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.padEnd(24,'0').slice(0,24);
  return {id:`u_${random}`,name:'',rarity:'N',limit:'unlimited',type:'monster',subtype:'normal',level:4,atk:1500,def:1200,emoji:'✨',desc:'',image:'',fx:{visual:'auto',sound:'auto'},monsterEffect:{kind:'ignition',code:'burn500'}};
}
function cardsModal(){
  if(ui.cardDraft)return editorModal();
  return `<div class="modal" role="dialog" aria-modal="true" aria-label="カード管理"><div class="modal-box card-manager">
    <div class="modal-title-line"><h2>✦ カード管理</h2>${btn('×','closeCards','btn sm square')}</div>
    ${btn('＋ 新しいカードを作成','newCard','btn primary wide')}
    <input id="cardSearch" class="input mt8" placeholder="カード名で検索" autocomplete="off">
    <div class="card-manage-list">${CARDS.map(c=>{
       const canEdit=!ui.customCards[c.id]||ui.customCards[c.id].owner===(ui.uid||'local');
       return `<div class="card-manage-item" data-cardname="${esc(c.name)}">
         <div class="mini-card-preview">${cardHtml(c.id)}</div>
         <div class="grow"><b>${esc(c.name)}</b><div class="tiny muted"><span class="rarity-label rarity-text-${esc(c.rarity||'N')}">${esc(c.rarity||'N')}</span> ${esc(suffix(c))}</div><div class="tiny muted">${esc(effectText(c)||c.desc||'')}</div></div>
         ${btn(canEdit?'編集':'閲覧のみ','editCard','btn sm',`data-id="${esc(c.id)}"`,!canEdit)}
       </div>`}).join('')}</div>
  </div></div>`;
}
function editorModal(){
  const d=ui.cardDraft;
  const isMonster=d.type==='monster';
  const custom=!!ui.customCards[d.id];
  const editable=(!custom||ui.customCards[d.id]?.owner===(ui.uid||'local'));
  return `<div class="modal" role="dialog" aria-modal="true" aria-label="カードを編集"><div class="modal-box card-manager">
    <div class="modal-title-line"><h2>${ORIGINAL_IDS.has(d.id)?'カードを編集':custom?'カードを編集':'カードを作成'}</h2>${btn('×','cardList','btn sm square')}</div>
    <div class="editor-preview"><div class="card-demo">${cardHtmlPreview(d)}</div>
      <div class="upload-tools"><label class="btn secondary upload-label">🖼 画像を選ぶ<input id="cardImage" type="file" accept="image/*" hidden></label>
      ${d.image?btn('画像を削除','removeCardImage','btn sm ghost'):''}
</div></div>
    <div class="card-form">
      <label class="field-label" for="cardName">カード名</label><input id="cardName" class="input" maxlength="32" value="${esc(d.name)}" placeholder="例：星影の魔術師">
      <div class="form-duo"><div><label class="field-label" for="cardRarity">レアリティ</label><select id="cardRarity" class="input">${selectOptions(RARITIES,d.rarity||'N')}</select></div>
      <div><label class="field-label" for="cardLimit">禁止・制限</label><select id="cardLimit" class="input">${selectOptions(Object.fromEntries(Object.entries(LIMITS).map(([v,x])=>[v,x.label])),d.limit||'unlimited')}</select></div></div>
      <div class="form-duo"><div><label class="field-label" for="cardType">種類</label><select class="input" id="cardType">${selectOptions({monster:'モンスター',spell:'魔法',trap:'罠'},d.type)}</select></div>
      ${!isMonster&&d.type==='spell'?`<div><label class="field-label" for="cardSpellKind">魔法の種類</label><select class="input" id="cardSpellKind">${selectOptions(SPELL_KINDS,spellKind(d))}</select></div>`:''}
      ${isMonster?`<div><label class="field-label" for="cardSubtype">モンスター種別</label><select class="input" id="cardSubtype">${selectOptions({normal:'通常',effect:'効果'},d.subtype||'normal')}</select></div>`:''}</div>
      ${isMonster?`<div class="form-trio"><div><label class="field-label" for="cardLevel">レベル</label><input id="cardLevel" class="input" inputmode="numeric" type="number" min="1" max="12" value="${d.level||4}"></div>
          <div><label class="field-label" for="cardAtk">ATK</label><input id="cardAtk" class="input" inputmode="numeric" type="number" min="0" max="5000" value="${d.atk??1500}"></div>
          <div><label class="field-label" for="cardDef">DEF</label><input id="cardDef" class="input" inputmode="numeric" type="number" min="0" max="5000" value="${d.def??1200}"></div></div>`:''}
      ${draftEffectFields(d)}
      <label class="field-label" for="cardEmoji">画像がない場合のアイコン（絵文字）</label><input id="cardEmoji" class="input" maxlength="8" value="${esc(d.emoji||'✨')}">
      <label class="field-label" for="cardDesc">フレーバー説明文</label><textarea id="cardDesc" class="input" maxlength="250" rows="2" placeholder="カードの説明を入力">${esc(d.desc||'')}</textarea>
      <div class="fx-card-editor"><h3>✧ このカードの演出・音</h3>
        <div class="form-duo"><div><label class="field-label" for="cardFxVisual">使用時のエフェクト</label><select class="input" id="cardFxVisual">${selectOptions(VISUAL_CHOICES,d.fx?.visual||'auto')}</select></div>
        <div><label class="field-label" for="cardFxSound">使用時の効果音</label><select class="input" id="cardFxSound">${selectOptions(SOUND_CHOICES,d.fx?.sound||'auto')}</select></div></div>
        <div class="row mt8">${btn('▶ この演出を試す','previewCardFx','btn sm secondary')}</div>
      </div>
    </div>
    ${btn('このカードを保存','saveCard','btn primary wide','',!editable||ui.cardBusy)}
    ${custom?btn(ORIGINAL_IDS.has(d.id)?'初期状態に戻す':'このカードを削除','deleteCard','btn ghost danger wide mt8','',!editable):''}
    ${btn('カード一覧に戻る','cardList','btn ghost wide mt8')}
  </div></div>`;
}
function cardHtmlPreview(card){return cardHtml(card.id,{card});}
function readCardForm(){
  const d=ui.cardDraft;if(!d)return;
  const value=(id,fallback='')=>$(id)?.value??fallback;
  d.name=value('cardName',d.name).trim();
  d.rarity=value('cardRarity',d.rarity||'N');d.limit=value('cardLimit',d.limit||'unlimited');
  d.type=value('cardType',d.type);
  if(d.type==='spell')d.spellKind=value('cardSpellKind',d.spellKind||'normal');else delete d.spellKind;
  d.emoji=value('cardEmoji',d.emoji).trim()||'✦';
  d.desc=value('cardDesc',d.desc).trim();
  d.fx={visual:value('cardFxVisual',d.fx?.visual||'auto'),sound:value('cardFxSound',d.fx?.sound||'auto')};
  if(d.type==='monster'){
    d.subtype=value('cardSubtype',d.subtype||'normal');
    d.level=Number(value('cardLevel',d.level??4));
    d.atk=Number(value('cardAtk',d.atk??1500));d.def=Number(value('cardDef',d.def??1200));
    if(d.subtype==='effect'){
      const kind=value('cardEffectKind',d.monsterEffect?.kind||'ignition');
      const code=value('cardEffectCode',d.monsterEffect?.code||Object.keys(MONSTER_EFFECTS[kind])[0]);
      d.monsterEffect={kind,code};
    }else delete d.monsterEffect;
    delete d.effect;
  }else{d.effect=value('cardEffectCode',d.effect||'draw2');delete d.monsterEffect;delete d.subtype;}
  const mode=value('cardEffectMode',d.ability?'builder':'preset');
  if(d.type==='spell'&&spellKind(d)==='equip'){
    const a=Number(value('cardAbilityAmount',d.ability?.amount||500));
    d.ability={when:'continuous',operation:'boost',target:'ownMonster',amount:EFFECT_VALUES.boost.includes(a)?a:500};
  }else if((d.type!=='monster'||d.subtype==='effect')&&mode==='builder'){
    const when=value('cardAbilityWhen',d.ability?.when|| (d.type==='trap'?'attack':'main'));
    const operation=value('cardAbilityOperation',d.ability?.operation||'damage');
    const targets=abilityTargets(operation,when);
    const oldTarget=value('cardAbilityTarget',d.ability?.target||targets[0]);
    const values=EFFECT_VALUES[operation]||[0];
    d.ability={when,operation,target:targets.includes(oldTarget)?oldTarget:targets[0],amount:values.includes(Number(value('cardAbilityAmount',d.ability?.amount??values[0])))?Number(value('cardAbilityAmount',values[0])):values[0]};
  }else delete d.ability;
}
async function saveCardFromForm(){
  if(ui.cardBusy)return;
  readCardForm();
  const d={...ui.cardDraft,owner:ui.customCards[ui.cardDraft.id]?.owner||ui.uid||'local'};
  if(d.type==='monster'&&d.subtype==='effect'&&!d.ability&&!MONSTER_EFFECTS[d.monsterEffect?.kind]?.[d.monsterEffect?.code])
    d.monsterEffect={kind:d.monsterEffect?.kind||'ignition',code:Object.keys(MONSTER_EFFECTS[d.monsterEffect?.kind||'ignition'])[0]};
  if(!isSafeCustomCard(d))return toast('名前・攻守・効果・画像サイズを確認してください');
  ui.cardBusy=true;
  try{
    if(ui.sdk)await ui.sdk.set(ui.sdk.ref(ui.db,`cardLibrary/cards/${d.id}`),d);
    else{
      ui.customCards[d.id]=d;
      storage.setItem('duel-custom-cards',JSON.stringify(ui.customCards));
      replaceCustomCards(ui.customCards);
    }
    ui.cardDraft=null;render();toast(ui.sdk?'共有カードを保存しました':'このiPhoneに保存しました（共有にはFirebaseが必要）');
  }catch(e){toast('保存に失敗しました：'+e.message);}
  finally{ui.cardBusy=false;}
}
async function deleteCard(){
  const id=ui.cardDraft?.id;
  if(!ui.customCards[id])return;
  if(!confirm(ORIGINAL_IDS.has(id)?'カードを初期状態に戻しますか？':'このカードを削除しますか？ デッキに入れている場合は組み直しが必要です。'))return;
  try{
    if(ui.sdk)await ui.sdk.remove(ui.sdk.ref(ui.db,`cardLibrary/cards/${id}`));
    else{delete ui.customCards[id];replaceCustomCards(ui.customCards);storage.setItem('duel-custom-cards',JSON.stringify(ui.customCards));}
    ui.cardDraft=null;render();toast('反映しました');
  }catch(e){toast('削除に失敗しました：'+e.message);}
}
async function compressCardImage(file){
  if(!file.type.startsWith('image/'))throw Error('画像ファイルを選んでください');
  if(file.size>12*1024*1024)throw Error('12MB以下の写真を選んでください');
  const url=URL.createObjectURL(file);
  try{
    const im=new Image();
    await new Promise((resolve,reject)=>{im.onload=resolve;im.onerror=()=>reject(Error('画像を開けません'));im.src=url;});
    let size=420,quality=.76,result='';
    for(let tries=0;tries<7;tries++){
      const canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;
      const ctx=canvas.getContext('2d');if(!ctx)throw Error('画像処理に失敗しました');
      const side=Math.min(im.naturalWidth,im.naturalHeight),sx=(im.naturalWidth-side)/2,sy=(im.naturalHeight-side)/2;
      ctx.drawImage(im,sx,sy,side,side,0,0,size,size);
      result=canvas.toDataURL('image/jpeg',quality);
      if(result.length<=65000)break;
      size=Math.floor(size*.83);quality=Math.max(.45,quality-.06);
    }
    if(!result.startsWith('data:image/jpeg;base64,')||result.length>90000)throw Error('画像を縮小できませんでした');
    return result;
  }finally{URL.revokeObjectURL(url);}
}

function slotHtml(player,owner,zone,i){
  const item=player?.[zone]?.[i]||null;
  const hide=owner==='opponent'&&((zone==='backrow'&&item?.faceDown)||item?.pos==='set');
  const selected=ui.selected?.owner===owner&&ui.selected?.zone===zone&&ui.selected?.index===i;
  const occupied=item?.id;
  let marker='';
  if(zone==='monsters'&&occupied&&(!hide||owner==='mine')) {
    const c=CARD[item.id];const attack=effectiveAtk(item,ui.game,owner==='mine'?ui.seat:1-ui.seat);
    marker=`<span class="slot-tag">${item.pos==='atk'?'攻'+attack:item.pos==='set'?'裏守':'守'+(c?.def??0)}</span>`;
  }
  return `<button type="button" aria-label="${owner==='mine'?'自分':'相手'}の${zone==='monsters'?'モンスター':'魔法・罠'}ゾーン${i+1}${occupied?' カードあり':' 空き'}" class="slot ${occupied?'':'empty'} ${selected?'selected':''}" data-select="1" data-owner="${owner}" data-zone="${zone}" data-index="${i}">
  ${occupied?cardHtml(item.id,{hidden:hide,def:item.pos==='def'}):''}${marker}</button>`;
}
function fieldSlotHtml(player,owner){
 const item=player?.field,hidden=owner==='opponent'&&item?.faceDown;
 const selected=ui.selected?.owner===owner&&ui.selected?.zone==='field';
 return `<button type="button" class="slot field-slot ${item?'':'empty'} ${selected?'selected':''}" data-select="1" data-owner="${owner}" data-zone="field" data-index="0" aria-label="${owner==='mine'?'自分':'相手'}のフィールド魔法">
 ${item?cardHtml(item.id,{hidden}):'<span class="small muted">フィールド<br>魔法</span>'}</button>`;
}
function playerStatus(p,side){
  const isCurrent=ui.game.turn===side;
  const lp=p?.lp??ui.game?.rules?.lp??8000;
  return `<div class="seat ${side!==ui.seat?'right':''}">
  <div class="avatar">${side===0?'🔥':'🌊'}</div><div><div class="seat-name">${esc(p?.name||'対戦相手')} ${isCurrent?'<span class="turn-chip">手番</span>':''}</div>
  <div class="lp ${lp<=2000?'danger':''}">${Number(lp).toLocaleString('ja-JP')} <span class="tiny">LP</span></div>
  <div class="mini-stats">山札 ${p?.deck?.length??ui.rules.deckSize} / 手札 ${p?.hand?.length??0} / 墓地 ${p?.grave?.length??0} / 除外 ${p?.banished?.length??0}</div></div></div>`;
}
function quickChoices(){
 const s=ui.game,p=activePlayer();if(!s||!p)return [];
 const rows=p.backrow.map((x,i)=>({card:x&&CARD[x.id],source:'backrow',index:i,item:x}))
   .filter(x=>x.card?.type==='spell'&&spellKind(x.card)==='quick'&&x.item?.faceDown&&x.item.setTurn<s.turnNo);
 if(s.turn===ui.seat)rows.push(...p.hand.map((id,i)=>({card:CARD[id],source:'hand',index:i}))
   .filter(x=>x.card?.type==='spell'&&spellKind(x.card)==='quick'));
 return rows;
}
function quickChoiceButtons(){return quickChoices().map(x=>btn('⚡ '+esc(x.card.name),'quickResponse','btn sm secondary',`data-source="${x.source}" data-index="${x.index}"`)).join('');}
function renderPending(){
  const s=ui.game;if(!s.pending)return '';
  if(s.pending.kind==='chain'){
    const ch=s.pending,priority=ch.priority===ui.seat;
    const traps=activePlayer().backrow.map((v,i)=>({v,i})).filter(({v})=>v&&v.setTurn<s.turnNo&&CARD[v.id]?.type==='trap'&&
      (CARD[v.id]?.ability?.when==='response'||(ch.afterAttack&&(CARD[v.id]?.ability?.when==='attack'||!CARD[v.id]?.ability))));
    return `<div class="respond"><strong>🔗 チェーン処理（${ch.stack.length}件）</strong>
      <div class="small">${ch.stack.map((e,i)=>`${i+1}. ${esc(CARD[e.cardId]?.name||e.cardId)}`).join(' → ')}</div>
      <p class="small muted">${priority?'あなたの応答順です。罠を追加するかパスしてください。':'相手の応答を待っています。'} 2回連続でパスすると逆順に解決します。</p>
      ${priority?`<div class="row wrap">${traps.map(({v,i})=>btn(esc(CARD[v.id].name),'chainTrap','btn sm secondary',`data-index="${i}"`)).join('')}${quickChoiceButtons()}
      ${btn('チェーンに追加せずパス','chainPass','btn primary sm')}</div>`:''}
      ${ui.demo&&!priority?btn('操作側を交代','switchSeat','btn secondary wide mt8'):''}</div>`;
  }
  const attacking=s.pending.by===ui.seat;
  if(attacking)return `<div class="respond"><strong>⚔ 攻撃を宣言しました</strong>
   <div class="small">相手が罠カードを発動するか選んでいます。</div>
   ${ui.demo?btn('相手側に切り替える','switchSeat','btn secondary wide mt8'):''}</div>`;
  const p=activePlayer();
  const traps=p.backrow.map((v,i)=>({v,i})).filter(({v})=>v&&CARD[v.id]?.type==='trap'&&v.setTurn<s.turnNo&&(CARD[v.id]?.ability?.when==='attack'||!CARD[v.id]?.ability));
  return `<div class="respond"><strong>⚠ 相手の攻撃！ 罠を使いますか？</strong><div class="small">セット済みの罠・速攻魔法を発動できます。発動しなくてもOK。</div>
  <div class="row wrap mt8">${traps.map(({v,i})=>btn(`${esc(CARD[v.id].emoji)} ${esc(CARD[v.id].name)}`,'trap','btn sm secondary',`data-index="${i}"`)).join('')}${quickChoiceButtons()||''}</div>
  ${btn('何も発動せず攻撃を通す','passAttack','btn wide mt8')}</div>`;
}
function renderTargetHint(){
  if(!ui.targetMode)return '';
  const m=ui.targetMode;
  return `<div class="hintbox">${m.type==='spell'||m.type==='quick'?'選択した効果の対象モンスターをタップしてください。':m.type==='chainTrap'?'✧ 罠の対象モンスターをタップしてください。':m.type==='monsterEffect'?'✦ 効果で破壊する相手のモンスターをタップしてください。':m.type==='attack'?`⚔ 攻撃対象となる相手モンスターをタップしてください。${!ui.game.players[1-ui.seat].monsters.some(Boolean)?'「直接攻撃」もできます。':''}`:m.id==='s03'?'⚡ 破壊する相手のモンスターをタップしてください。':'💪 強化する自分の攻撃表示モンスターをタップしてください。'}
   <div class="row mt8">${m.type==='attack'&&!ui.game.players[1-ui.seat].monsters.some(Boolean)?btn('直接攻撃','directAttack','btn sm primary'):''}${btn('キャンセル','cancelTarget','btn sm ghost')}</div></div>`;
}
function renderSelection(){
  const s=ui.game,sel=ui.selected;if(!sel||!isMine())return '';
  const p=s.players[ui.seat],enemy=s.players[1-ui.seat];
  let id=null,item=null;
  if(sel.zone==='hand'){id=p.hand[sel.index];}
  if(sel.zone==='monsters'){
    item=(sel.owner==='mine'?p:enemy).monsters[sel.index];id=item?.id;
  }
  if(sel.zone==='field'){item=(sel.owner==='mine'?p:enemy).field;id=item?.id;}
  if(sel.zone==='backrow'){
    item=(sel.owner==='mine'?p:enemy).backrow[sel.index];id=item?.id;
  }
  if(!id)return '';
  if(sel.owner==='opponent'&&((sel.zone==='backrow'||sel.zone==='field')&&item?.faceDown||item?.pos==='set'))return '<div class="card-detail"><b>裏側のカード</b><div class="small muted">内容はまだわかりません。</div></div>';
  const c=CARD[id];if(!c)return '';
  let options='';const canMain=inMain();
  if(sel.owner==='mine'&&sel.zone==='hand'&&myTurn()&&!s.pending&&(canMain||c.type==='spell'&&spellKind(c)==='quick')){
    if(c.type==='monster'&&canMain){
      options=btn('攻撃表示で召喚','summonAtk','btn primary sm')+btn('裏側守備でセット','summonSet','btn sm');
    }else if(c.type==='spell'){
      options=btn('魔法を発動','spellHand','btn primary sm')+(canMain?btn('伏せてセット','setHand','btn sm'):'');
    }else if(canMain)options=btn('伏せてセット','setHand','btn primary sm');
  }
  if(sel.owner==='mine'&&sel.zone==='hand'&&myTurn()&&p.hand.length>6)
     options+=btn('手札から捨てる','discard','btn sm danger');
  if(sel.owner==='mine'&&sel.zone==='monsters'&&item){
    if(canMain){
      if(item.pos==='set')options+=btn('反転召喚','flip','btn primary sm');
      else options+=btn('表示形式変更','changePosition','btn sm');
    }
    if(canMain&&item.pos!=='set'&&c.subtype==='effect'&&(c.ability?.when==='main'||c.monsterEffect?.kind==='ignition')&&item.effectUsedTurn!==s.turnNo)
      options+=btn('✦ モンスター効果を発動','monsterEffect','btn secondary sm');
    if(myTurn()&&s.phase==='battle'&&!s.pending&&item.pos==='atk'&&!item.attacked&&s.turnNo>1)
      options+=btn('このモンスターで攻撃','attackSelect','btn primary sm');
  }
  if(sel.owner==='mine'&&sel.zone==='monsters'&&canMain&&item){options+=btn('位置移動','moveSelected','btn sm')+btn('墓地へ','destroySelected','btn sm ghost')+btn('除外','banishSelected','btn sm ghost');}
  if(sel.owner==='mine'&&(sel.zone==='backrow'||sel.zone==='field')&&item){
    if(c.type==='spell'&&item.faceDown&&myTurn()&&!s.pending&&(canMain||spellKind(c)==='quick'))options=btn('魔法を発動','spellField','btn primary sm');
    if(c.type==='trap'&&s.pending?.kind==='attack'&&s.pending.by!==ui.seat&&item.setTurn<s.turnNo)
      options=btn('罠を発動','trap','btn primary sm',`data-index="${sel.index}"`);
  }
  if(sel.owner==='mine'&&sel.zone==='backrow'&&canMain&&item)options+=btn('位置移動','moveSelected','btn sm')+btn('墓地へ','destroySelected','btn sm ghost')+btn('除外','banishSelected','btn sm ghost');
  if(sel.owner==='mine'&&sel.zone==='field'&&canMain&&item)options+=btn('フィールド魔法を墓地へ','destroySelected','btn sm ghost');
  return `<section class="card-detail"><div class="row between"><div class="detail-title">${esc(c.emoji||'✦')} ${esc(c.name)}</div><span class="detail-badge">${cardTypeName(c)}</span></div>
   <div class="small muted mt8">${esc(suffix(c))}${item?.bonus?` / 強化+${item.bonus}`:''}</div><p class="detail-text">${esc(effectText(c)||c.desc)}</p>
   <div class="actionbar">${btn('🔎 拡大・効果確認','viewCard','btn secondary sm')}${options}</div></section>`;
}
function renderGame(){
  const s=ui.game;if(!s)return renderHome();
  const roombar=ui.demo?`<div class="rooms">練習モード</div>`:
    `<div class="row between rooms"><span>部屋コード：<b>${esc(ui.roomCode)}</b></span>${btn('招待リンクをコピー','copyInvite','btn sm')}</div>`;
  if(s.status==='waiting')return `${roombar}<section class="hero"><div class="eyebrow">WAITING ROOM</div><h1>対戦相手を待っています</h1>
    <p>次のコードか招待リンクを相手に送ってください。</p></section><section class="panel"><div class="code">${esc(ui.roomCode)}</div>
    ${btn('招待リンクをコピー','copyInvite','btn primary wide')}
    <p class="small muted center mt8">相手が入室すると自動的に始まります。</p></section>
    ${btn('ホームに戻る','goHome','btn ghost wide')}`;
  const me=s.players[ui.seat],enemy=s.players[1-ui.seat];
  if(!me)return '<div class="notice">この対戦に参加していません。</div>';
  const ready=!!s.pending;
  const myStatus=playerStatus(me,ui.seat),enemyStatus=playerStatus(enemy,1-ui.seat);
  const hand=me.hand.map((id,i)=>`<button type="button" class="hand-slot ${ui.selected?.zone==='hand'&&ui.selected?.index===i?'selected':''}" data-select="1" data-owner="mine" data-zone="hand" data-index="${i}">${cardHtml(id)}</button>`).join('');
  const phaseButton=!myTurn()||ready||s.status!=='playing'?'':s.phase==='main2'?btn('ターン終了','endTurn','btn primary'):btn(s.phase==='draw'?(s.turnNo===1?'メインへ':'ドローしてメインへ'):s.phase==='main1'?(s.turnNo===1?'メイン2へ':'バトルへ'):'メイン2へ','nextPhase','btn primary');
  const endButton=myTurn()&&!ready&&s.status==='playing'&&s.phase!=='main2'&&s.phase!=='draw'?btn('ターン終了','endTurn','btn ghost'):'';
  const winner=s.status==='finished'?`<section class="panel winner">🏆 ${s.winner==='draw'?'引き分け':`${esc(s.players[s.winner].name)} の勝利！`}</section>`:'';
  return `${roombar}<div class="statusbar">${enemyStatus}</div>
   <div class="battlefield">
     <div class="field-zone-line"><span>相手のフィールド魔法</span>${fieldSlotHtml(enemy,'opponent')}</div><div class="zone-caption">相手の魔法・罠</div>
     <div class="slots">${Array.from({length:5},(_,i)=>slotHtml(enemy,'opponent','backrow',i)).join('')}</div>
     <div class="zone-caption">相手のモンスター</div>
     <div class="slots">${Array.from({length:5},(_,i)=>slotHtml(enemy,'opponent','monsters',i)).join('')}</div>
     <div class="field-center"><div class="turnnote">ターン ${s.turnNo}</div><div class="phase">${esc(PHASES[s.phase]||'終了')}</div><div class="turnnote">${myTurn()?'あなたの手番':'相手の手番'}</div></div>
     <div class="zone-caption">自分のモンスター</div>
     <div class="slots">${Array.from({length:5},(_,i)=>slotHtml(me,'mine','monsters',i)).join('')}</div>
     <div class="zone-caption">自分の魔法・罠</div>
     <div class="slots">${Array.from({length:5},(_,i)=>slotHtml(me,'mine','backrow',i)).join('')}</div><div class="field-zone-line"><span>自分のフィールド魔法</span>${fieldSlotHtml(me,'mine')}</div>
   </div>
   <div class="statusbar">${myStatus}<div class="row">${ui.demo?btn('操作側を交代','switchSeat','btn sm secondary'):''}</div></div>
   ${winner}
   ${renderPending()}
   ${renderTargetHint()}
   ${s.status==='playing'&&!s.pending&&myTurn()?`<div class="row wrap mt8">${phaseButton}${endButton}</div>`:''}
   <div class="hand-count">自分の手札 (${me.hand.length}枚)　${!myTurn()?'・相手のターン中':''}</div>
   <div class="hand-scroll">${hand||'<div class="muted small">手札がありません</div>'}</div>
   ${renderSelection()}
   <section class="panel"><h3>デュエル操作</h3><div class="row wrap battle-tools">
     ${btn('🎲 サイコロ','rollDice','btn sm secondary')}${btn('🪙 コイン','flipCoin','btn sm secondary')}
     ${myTurn()&&!ready&&['main1','main2'].includes(s.phase)?btn('山札を混ぜる','shuffleDeck','btn sm')+btn('＋1枚ドロー','manualDraw','btn sm'):''}
     ${ui.demo?btn('↶ 1操作戻す','undoDemo','btn sm ghost','',!s.undoSnapshot):
       (s.undoRequest!==null&&s.undoRequest!==undefined&&s.undoRequest!==ui.seat?
        btn('取り消し承認','approveUndo','btn sm primary')+btn('拒否','rejectUndo','btn sm ghost'):
       btn(s.undoRequest===ui.seat?'承認待ち':'↶ 取り消しを依頼','requestUndo','btn sm ghost','',!s.undoSnapshot||s.undoActor!==ui.seat||s.undoRequest!==null&&s.undoRequest!==undefined))}
     ${btn('🎨 デザイン','openAppearance','btn sm')}
   </div>${s.lastRandom?`<div class="notice mt8">${esc(s.lastRandom)}</div>`:''}
   </section>
   <section class="panel"><div class="row between"><h3>対戦ログ</h3></div><div class="loglist">${s.log.map(x=>`<div>• ${esc(x)}</div>`).join('')}</div>
   <hr class="soft-divider"><div class="row between"><span class="small muted">墓地・除外 ${me.grave.length+me.banished.length}枚</span>${btn('墓地・除外を見る','showGrave','btn sm')}</div></section>
   <div class="footer-links">${s.status==='playing'?btn('降参する','surrender','btn ghost sm'):''}${btn('🔊 演出設定','openFx','btn ghost sm')}${btn('ホームへ','goHome','btn ghost sm')}</div>
   ${ui.graveOpen?graveModal():''}${ui.fxOpen?fxModal():''}${ui.appearanceOpen?appearanceModal():''}${ui.previewCardId?detailOverlay():''}`;
}
function graveModal(){const me=activePlayer(),enemy=ui.game.players[1-ui.seat];
 const view=(p,side)=>`<h3>${side}：墓地 (${p.grave.length})</h3><div class="grave-list">${p.grave.map((id,i)=>`<button class="grave-chip" data-action="graveDetail" data-id="${esc(id)}">${esc(CARD[id]?.name||id)}</button>`).join('')||'なし'}</div>
 <h3>${side}：除外 (${p.banished?.length||0})</h3><div class="grave-list">${(p.banished||[]).map(id=>`<button class="grave-chip" data-action="graveDetail" data-id="${esc(id)}">${esc(CARD[id]?.name||id)}</button>`).join('')||'なし'}</div>`;
 return `<div class="modal"><div class="modal-box"><div class="modal-title-line"><h2>墓地・除外ゾーン</h2>${btn('×','closeGrave','btn sm square')}</div>
 ${view(me,'自分')}${myTurn()&&!ui.game.pending&&['main1','main2'].includes(ui.game.phase)&&me.grave.length?btn('墓地のカードを除外する','banishFromGrave','btn sm secondary mt8'):''}
 <hr class="soft-divider">${view(enemy,'相手')}</div></div>`;
}
function render(){
 const mode=!!ui.game,changed=ui.renderedMode!==mode;ui.renderedMode=mode;
 $('view').innerHTML=mode?renderGame():renderHome();appearanceApply();
 if(changed)try{window.scrollTo(0,0);}catch{}
}
function readHomeValues(){
 const input=$('playerName');if(input){ui.nickname=(input.value.trim()||'プレイヤー').slice(0,12);storage.setItem('duel-name',ui.nickname);}
}
function startDeckDraft(mode,source){
  if(mode==='new'&&ui.decks.decks.length>=MAX_SAVED_DECKS)return toast('保存できるデッキは最大30組です');
  const base=source||activeSavedDeck();
  ui.deckDraft=mode==='new'?{...newDeck('新しいデッキ',{}),isNew:true}:{...base,counts:{...base.counts},isNew:false};
  ui.deckFilterType='all';ui.deckFilterRarity='all';render();
}
function saveDeck(){
  const d=ui.deckDraft;if(!d||!validDeck(d.counts,ui.rules))return toast(`${ui.rules.deckSize}枚・禁止制限を守ってください`);
  if(ui.collectionOnly&&Object.entries(d.counts).some(([id,n])=>n>(ui.packs.collection[id]||0)))return toast('所持カード枚数を超えています');
  const name=($('deckName')?.value||d.name).trim().slice(0,28)||'名前のないデッキ';
  const result={id:d.id,name,counts:{...d.counts},updatedAt:Date.now()};
  if(d.isNew){if(ui.decks.decks.length>=MAX_SAVED_DECKS)return toast('保存数の上限です');ui.decks.decks.push(result);}
  else{const i=ui.decks.decks.findIndex(x=>x.id===d.id);if(i<0)return toast('デッキがありません');ui.decks.decks[i]=result;}
  ui.decks.activeId=result.id;persistDecks();ui.deckDraft=null;render();toast('「'+name+'」を保存しました');
}
function selectDeck(id){
 const d=ui.decks.decks.find(x=>x.id===id);if(!d)return;
 if(!validDeck(d.counts,ui.rules))return toast(`${ui.rules.deckSize}枚・禁止制限を守る必要があります`);
 ui.decks.activeId=id;persistDecks();render();toast('対戦用デッキを切り替えました');
}
async function shareDeck(id){
 const d=ui.decks.decks.find(x=>x.id===id);if(!d)return;
 let url;try{url=`${location.origin}${location.pathname}?deck=${encodeDeckShare(d)}`;}catch(e){return toast(e.message);}
 if(navigator.share){
   try{await navigator.share({title:`SAHOVERSE：${d.name}`,text:'このデッキを取り込む',url});return;}
   catch(e){if(e.name==='AbortError')return;}
 }
 try{await navigator.clipboard.writeText(url);toast('デッキ共有リンクをコピーしました');}
 catch{prompt('リンクをコピーして送ってください',url);}
}
function closeShare(){ui.pendingShare=null;ui.shareError='';try{const u=new URL(location.href);u.searchParams.delete('deck');history.replaceState({},'',u.pathname+u.search+u.hash);}catch{}render();}
function addImportedDeck(){
 if(!ui.pendingShare)return;if(ui.decks.decks.length>=MAX_SAVED_DECKS)return toast('デッキ保存数の上限です');
 const deck=newDeck(ui.pendingShare.name+'（共有）',ui.pendingShare.counts);
 ui.decks.decks.push(deck);ui.decks.activeId=deck.id;persistDecks();closeShare();toast('共有デッキを保存しました');
}
/** Update only deck counts/buttons; keep search, scroll and keyboard focus intact. */
function refreshDeckEditor(){
  if(!ui.deckDraft)return;
  const counts=ui.deckDraft.counts,total=sum(counts);
  const valid=validDeck(counts,ui.rules)&&(!ui.collectionOnly||
    Object.entries(counts).every(([id,n])=>n<=(ui.packs.collection[id]||0)));
  const counter=document.querySelector('.deck-total');
  if(counter){counter.textContent=`${total} / ${ui.rules.deckSize}`;counter.classList.toggle('good',valid);}
  const save=document.querySelector('[data-action="saveDeck"]');if(save)save.disabled=!valid;
  for(const row of document.querySelectorAll('.deck-item')){
    const add=row.querySelector('[data-action="deckPlus"]');if(!add)continue;
    const id=add.dataset.id,c=CARD[id],count=counts[id]||0;
    const minus=row.querySelector('[data-action="deckMinus"]');
    const qty=row.querySelector('.count');if(qty)qty.textContent=String(count);
    if(minus)minus.disabled=count<=0;
    add.disabled=!c||count>=Math.min(cardLimit(c),ui.collectionOnly?(ui.packs.collection[id]||0):3)||total>=ui.rules.deckSize;
  }
}
function updateCardRows(scope){
 const gallery=scope==='gallery';const type=gallery?ui.galleryFilterType:ui.deckFilterType;
 const rarity=gallery?ui.galleryFilterRarity:ui.deckFilterRarity;
 const search=($(gallery?'gallerySearch':'deckSearch')?.value||'').trim().toLocaleLowerCase('ja');
 for(const row of document.querySelectorAll(gallery?'.gallery-entry':'.deck-item')){
   row.hidden=(type!=='all'&&row.dataset.cardtype!==type)||(rarity!=='all'&&row.dataset.rarity!==rarity)||!row.dataset.cardname.toLocaleLowerCase('ja').includes(search);
 }
}
function startDemo(){readHomeValues();if(!validDeck(ui.counts,ui.rules))return toast(`先に${ui.rules.deckSize}枚のデッキを完成させてください`);ui.demo=true;ui.seat=0;ui.roomCode='';ui.selected=null;ui.targetMode=null;
 ui.game=createDemo({counts1:ui.counts,counts2:ui.decks.decks.find(d=>d.id!==ui.decks.activeId&&validDeck(d.counts,ui.rules))?.counts||ui.counts,rules:ui.rules});ui.seat=ui.game.turn;ui.lastFxRevision=ui.game.revision;storeDemo();setNetwork('お試し対戦','ok');render();}
function storeDemo(){if(ui.demo&&ui.game){storage.setItem('duel-demo-state',JSON.stringify(ui.game));storage.setItem('duel-demo-seat',String(ui.seat));}}
async function remoteCreate(){
 if(!ui.sdk)return toast('Firebaseの設定が必要です');readHomeValues();if(!validDeck(ui.counts,ui.rules))return toast(`先に${ui.rules.deckSize}枚のデッキを完成させてください`);
 setBusy(true);
 try{
   for(let tries=0;tries<4;tries++){
     const code=makeCode(),r=ui.sdk.ref(ui.db,`rooms/${code}`);
     const result=await ui.sdk.runTransaction(r,old=>old?undefined:createRoom({uid:ui.uid,name:ui.nickname,counts:ui.counts,rules:ui.rules}),{applyLocally:false});
     if(result.committed){await openRoom(code);return;}
   }
   throw Error('部屋コードを作れませんでした');
 }catch(e){toast('部屋の作成に失敗しました：'+e.message)}finally{setBusy(false);}
}
async function remoteJoin(){
 if(!ui.sdk)return toast('Firebaseの設定が必要です');readHomeValues();
 if(!validDeck(ui.counts,ui.rules))return toast(`対戦できる${ui.rules.deckSize}枚のデッキを選んでください`);
 const code=($('roomCode')?.value||'').trim().toUpperCase().replace(/[^A-Z2-9]/g,'');
 if(code.length!==8)return toast('8文字の部屋コードを入力してください');
 setBusy(true);
 try{
   const r=ui.sdk.ref(ui.db,`rooms/${code}`);
   const result=await ui.sdk.runTransaction(r,old=>{
     if(!old)return;
     const players=Array.isArray(old.players)?old.players:[old.players?.[0],old.players?.[1]];
     if(players.some(p=>p?.uid===ui.uid))return old;
     if(old.status!=='waiting'||old.players?.[1])return;
     return joinRoom(old,{uid:ui.uid,name:ui.nickname,counts:ui.counts});
   },{applyLocally:false});
   if(!result.committed)return toast('部屋が見つからないか、すでに満員です');
   await openRoom(code);
 }catch(e){toast('参加できませんでした：'+e.message)}finally{setBusy(false);}
}
async function openRoom(code){
 if(ui.unsub){ui.unsub();ui.unsub=null;}
 ui.demo=false;ui.roomCode=code;ui.selected=null;ui.targetMode=null;ui.lastFxRevision=null;
 history.replaceState({},'',`${location.pathname}?room=${code}`);
 ui.unsub=ui.sdk.onValue(ui.sdk.ref(ui.db,`rooms/${code}`),snap=>{
   const v=snap.val();if(!v){toast('部屋が見つかりません');return;}
   ui.game=normalizeRoom(v);ui.seat=ui.game.players.findIndex(p=>p?.uid===ui.uid);
   if(ui.seat<0){ui.game=null;toast('この部屋に参加していません');}
   render();handleRoomCue(ui.game);
 },err=>{toast('同期エラー：'+err.message);setNetwork('同期エラー','off')});
 render();
}
async function send(action){
 if(!ui.game||ui.busy)return;
 const hadTarget=!!ui.targetMode;ui.targetMode=null;
 if(hadTarget)render();
 if(ui.demo){
   if(action.type==='undoDemo'){
     if(!ui.game.undoSnapshot)return toast('取り消せる操作がありません');
     const restored=normalizeRoom(structuredClone(ui.game.undoSnapshot));restored.revision=(ui.game.revision||0)+1;restored.undoSnapshot=null;restored.undoActor=null;restored.undoRequest=null;restored.log.unshift('直前の操作を取り消しました。');ui.game=restored;storeDemo();render();return;
   }
   try {ui.game=applyAction(ui.game,`demo-${ui.seat===0?'a':'b'}`,action);ui.selected=null;storeDemo();render();handleRoomCue(ui.game);}
   catch(e){toast(e.message);}return;
 }
 setBusy(true);let problem=null;
 try{
   const result=await ui.sdk.runTransaction(ui.sdk.ref(ui.db,`rooms/${ui.roomCode}`),old=>{
      if(!old){problem='部屋がありません';return;}
      try{return applyAction(old,ui.uid,action);}catch(e){problem=e.message;return;}
   },{applyLocally:false});
   if(!result.committed)toast(problem||'ほかの操作と重なりました。もう一度お試しください。');
   else ui.selected=null;
 }catch(e){toast('通信エラー：'+e.message)}finally{setBusy(false);}
}
function requestTributes(id){
 const c=CARD[id],need=c.level<=4?0:c.level<=6?1:2;if(!need)return [];
 const p=activePlayer();const occupied=p.monsters.map((m,i)=>m?i+1:null).filter(Boolean);
 if(occupied.length<need){toast(`レベル${c.level}の召喚には${need}体のリリースが必要です`);return null;}
 const raw=prompt(`召喚には${need}体のリリースが必要です。\n自分のモンスターゾーン番号(1〜5)を選択してください。\nカードがある位置: ${occupied.join(', ')}\n${need===2?'例: 1,3':'例: 2'}`);
 if(raw===null)return null;
 const indexes=raw.split(/[,、\s]+/).map(x=>Number(x)-1);
 if(indexes.length!==need||new Set(indexes).size!==need||!indexes.every(x=>Number.isInteger(x)&&p.monsters[x])){toast('正しいモンスターの位置番号を入力してください');return null;}
 return indexes;
}
function attemptSummon(faceDown){
 const i=ui.selected?.index;if(ui.selected?.zone!=='hand')return;
 const id=activePlayer().hand[i],c=CARD[id];if(!c||c.type!=='monster')return;
 const tributes=requestTributes(id);if(tributes===null)return;
 send({type:'summon',hand:i,faceDown,tributes});
}
function chooseSpell(source,index){
 const p=activePlayer(),id=source==='hand'?p.hand[index]:source==='field'?p.field?.id:p.backrow[index]?.id;
 if(!id)return;
 if(effectNeedsTarget(id)){
   ui.targetMode={type:'spell',source,index,id};ui.selected=null;render();
   toast(CARD[id].ability?.target==='ownMonster'||CARD[id].effect==='boost500'?'自分の対象モンスターを選択':'相手の対象モンスターを選択');
 }else send({type:source==='hand'?'spellFromHand':'spellFromField',[source==='hand'?'hand':'index']:index,field:source==='field'});
}
function chooseSlot(owner,zone,index){
 if(!ui.game||ui.game.status==='waiting')return;
 if(ui.targetMode){
   const mode=ui.targetMode;
   if(mode.type==='attack'&&owner==='opponent'&&zone==='monsters'&&ui.game.players[1-ui.seat].monsters[index])
     return send({type:'attack',index:mode.index,target:index});
   if(mode.type==='monsterEffect'&&owner===(mode.owner||'opponent')&&zone==='monsters'&&ui.game.players[owner==='mine'?ui.seat:1-ui.seat].monsters[index])
     return send({type:'activateMonsterEffect',index:mode.index,target:index});
   if(mode.type==='chainTrap'&&zone==='monsters'&&owner===mode.owner)return send({type:mode.attack?'activateTrap':'chainTrap',index:mode.index,target:index});
   if(mode.type==='quick'){
     const c=CARD[mode.id],need=c?.ability?.target==='enemyMonster'||c?.effect==='destroy'?'opponent':'mine';
     const pl=ui.game.players[need==='mine'?ui.seat:1-ui.seat];
     if(zone==='monsters'&&owner===need&&pl.monsters[index])return send({type:'quickResponse',source:mode.source,index:mode.index,target:index});
   }
   if(mode.type==='spell'){
     const correct=(CARD[mode.id]?.ability?CARD[mode.id].ability.target==='enemyMonster':CARD[mode.id]?.effect==='destroy')?owner==='opponent':owner==='mine';
     const targetPlayer=ui.game.players[owner==='mine'?ui.seat:1-ui.seat];
     if(zone==='monsters'&&correct&&targetPlayer.monsters[index])
       return send({type:mode.source==='hand'?'spellFromHand':'spellFromField',[mode.source==='hand'?'hand':'index']:mode.index,field:mode.source==='field',target:index});
   }
   return toast('対象となるモンスターを選んでください');
 }
 if(zone==='hand'){
   if(owner!=='mine')return;
   ui.selected={owner,zone,index};return render();
 }
 if(zone==='monsters'||zone==='backrow'||zone==='field'){
   if(!(zone==='field'?ui.game.players[owner==='mine'?ui.seat:1-ui.seat]?.field:ui.game.players[owner==='mine'?ui.seat:1-ui.seat]?.[zone]?.[index]))return;
   ui.selected={owner,zone,index};return render();
 }
}
async function copyInvite(){
 const link=`${location.origin}${location.pathname}?room=${encodeURIComponent(ui.roomCode)}`;
 try{await navigator.clipboard.writeText(link);toast('招待リンクをコピーしました');}
 catch{prompt('招待リンクをコピーしてください',link);}
}
function goHome(){if(ui.unsub){ui.unsub();ui.unsub=null;}ui.demo=false;ui.game=null;ui.roomCode='';ui.selected=null;ui.targetMode=null;ui.graveOpen=false;ui.fxOpen=false;ui.settingsOpen=false;ui.duelOpen=false;ui.lastFxRevision=null;try{history.replaceState({},'',location.pathname);}catch{}if(configReady&&ui.db)setNetwork('オンライン接続可能','ok');else setNetwork('お試し対戦可能');render();}
async function initFirebase(){
 // The config is OPTIONAL for the offline UI, and is loaded after the home screen.
 // A missing/incorrect export must not prevent the whole game from starting.
 try {
   const configModule=await import('./firebase-config.js?config=80');
   firebaseConfig=configModule.firebaseConfig||null;
   configReady=['apiKey','authDomain','databaseURL','projectId','appId'].every(key=>
     typeof firebaseConfig?.[key]==='string'&&firebaseConfig[key].trim()!=='');
   if(!configReady){setNetwork('Firebase未設定','off');render();return;}
 } catch(error) {
   setNetwork('Firebase設定エラー','off');
   toast('Firebase設定を確認してください：'+(error?.message||String(error)));
   render();
   return;
 }
 try {
   const [{initializeApp},{getAuth,signInAnonymously},{getDatabase,ref,runTransaction,onValue,set,remove}]=await Promise.all([
     import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js'),
     import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js'),
     import('https://www.gstatic.com/firebasejs/11.10.0/firebase-database.js'),
   ]);
   const app=initializeApp(firebaseConfig);const auth=getAuth(app);
   await auth.authStateReady();if(!auth.currentUser)await signInAnonymously(auth);
   ui.uid=auth.currentUser.uid;ui.db=getDatabase(app);ui.sdk={ref,runTransaction,onValue,set,remove};
   ui.cardUnsub=onValue(ref(ui.db,'cardLibrary/cards'),snapshot=>{
     // Preserve text being typed if someone updates the shared card library.
     if(ui.cardDraft&&$('cardName'))readCardForm();
     if(ui.packDraft&&$('packName'))savePackDraftFields();
     ui.customCards=snapshot.val()||{};
     storage.setItem('duel-custom-cards',JSON.stringify(ui.customCards));
     replaceCustomCards(ui.customCards);render();
   },err=>{toast('カード共有エラー：'+err.message);});
   setNetwork('オンライン接続可能','ok');render();
 }catch(e){setNetwork('接続設定エラー','off');toast('Firebase接続エラー：'+e.message);render();}
}
$('view').addEventListener('click',async e=>{
 if(ui.fxSettings.sound||ui.fxSettings.bgm)unlockAudio();if(ui.fxSettings.bgm)setBgmPlaying(true); // iOS gesture
 const selected=e.target.closest('[data-select]');if(selected){chooseSlot(selected.dataset.owner,selected.dataset.zone,Number(selected.dataset.index));return;}
 const el=e.target.closest('[data-action]');if(!el)return;
 const action=el.dataset.action;
 if(ui.busy)return;
 if(action==='openDuel'){ui.duelOpen=true;render();requestAnimationFrame(()=>document.getElementById('duel-setup')?.scrollIntoView({behavior:'smooth',block:'start'}));return;}
 if(action==='closeDuel'){ui.duelOpen=false;render();return;}
 if(action==='openSettings'){ui.settingsOpen=true;render();return;}
 if(action==='closeSettings'){ui.settingsOpen=false;render();return;}
 if(action==='settingsAppearance'){ui.settingsOpen=false;ui.appearanceOpen=true;render();return;}
 if(action==='settingsFx'){ui.settingsOpen=false;ui.fxOpen=true;render();return;}
 if(action==='settingsRules'){ui.settingsOpen=false;ui.rulesOpen=true;render();return;}
 if(action==='openRules'){ui.rulesOpen=true;render();return;}
 if(action==='closeRules'){ui.rulesOpen=false;render();return;}
 if(action==='saveRules'){ui.rules=writeRuleSettings(storage,{lp:Number($('ruleLP').value),deckSize:Number($('ruleDeck').value)});ui.rulesOpen=false;render();toast('ルールを保存しました');return;}
 if(action==='openAppearance'){ui.appearanceOpen=true;render();return;}
 if(action==='closeAppearance'){ui.appearanceOpen=false;render();return;}
 if(action==='openPacks'){ui.packOpen=true;ui.packResults=null;ui.packDraft=null;render();return;}
 if(action==='closePacks'){ui.packOpen=false;ui.packDraft=null;ui.packResults=null;render();return;}
 if(action==='packBack'){ui.packResults=null;render();return;}
 if(action==='packEditorBack'){ui.packDraft=null;render();return;}
 if(action==='packNew'){if(ui.packs.packs.length>=25)return toast('パックは最大25種類');ui.packDraft=newPack();render();return;}
 if(action==='packEdit'){ui.packDraft=structuredClone(ui.packs.packs.find(p=>p.id===el.dataset.id));render();return;}
 if(action==='packSave'){
   savePackDraftFields();let d;try{d=normalizePack(ui.packDraft);}catch(e){toast(e.message);return;}
   if(!Object.values(d.weights).some(w=>w>0))return toast('少なくとも1種類の排出比率を正にしてください');
   const index=ui.packs.packs.findIndex(p=>p.id===d.id);
   if(index>=0)ui.packs.packs[index]=d;else ui.packs.packs.push(d);
   savePackStore(storage,ui.packs);ui.packDraft=null;render();toast('パックを保存しました');return;
 }
 if(action==='packOpenOne'){
   const p=ui.packs.packs.find(x=>x.id===el.dataset.id);if(!p)return;
   try{ui.packResults=openPack(p);collect(ui.packs,ui.packResults);savePackStore(storage,ui.packs);render();}
   catch(e){toast('開封できません：'+e.message);}return;
 }
 if(action==='packDelete'){
  const p=ui.packs.packs.find(x=>x.id===el.dataset.id);if(!p||p.id==='starter'||!confirm('このパックを削除しますか？'))return;
  ui.packs.packs=ui.packs.packs.filter(x=>x.id!==p.id);savePackStore(storage,ui.packs);render();return;
 }
 if(action==='packDetail'){ui.previewCardId=el.dataset.id;render();return;}
 if(action==='viewCard'){const x=ui.selected;let id=null;if(x&&ui.game){const p=ui.game.players[x.owner==='mine'?ui.seat:1-ui.seat];id=x.zone==='hand'?p.hand[x.index]:p[x.zone]?.[x.index]?.id;}if(id){ui.previewCardId=id;render();}return;}
 if(action==='graveDetail'){ui.previewCardId=el.dataset.id;render();return;}
 if(action==='closePreview'){ui.previewCardId=null;render();return;}

 if(action==='openFx'){ui.fxOpen=true;render();return;}
 if(action==='closeFx'){ui.fxOpen=false;render();return;}
 if(['previewFlame','previewSlash','previewShadow'].includes(action)){
   const kind=action==='previewFlame'?'flame':action==='previewSlash'?'slash':'shadow';
   const sound=kind==='flame'?'boom':kind==='slash'?'slash':'spark';
   Promise.resolve(unlockAudio()).then(()=>playCue({type:kind==='slash'?'impact':kind==='shadow'?'trap':'summon',cardId:'__preview'}, {name:'テスト演出',fx:{visual:kind,sound}},ui.fxSettings));return;
 }
 if(action==='previewCardFx'&&ui.cardDraft){readCardForm();
   const card=ui.cardDraft;
   Promise.resolve(unlockAudio()).then(()=>playCue({type:card.type==='trap'?'trap':card.type==='spell'?'spell':card.subtype==='effect'?'effect':'summon',cardId:card.id},card,ui.fxSettings));return;}
 if(action==='openCards'){readHomeValues();ui.cardsOpen=true;ui.cardDraft=null;render();return;}
 if(action==='closeCards'){ui.cardsOpen=false;ui.cardDraft=null;render();return;}
 if(action==='newCard'){ui.cardDraft=newCardDraft();render();return;}
 if(action==='editCard'){ui.cardDraft={...CARD[el.dataset.id],subtype:CARD[el.dataset.id]?.type==='monster'?(CARD[el.dataset.id]?.subtype||'normal'):undefined,monsterEffect:CARD[el.dataset.id]?.monsterEffect?{...CARD[el.dataset.id].monsterEffect}:undefined};render();return;}
 if(action==='cardList'){ui.cardDraft=null;render();return;}
 if(action==='saveCard')return saveCardFromForm();
 if(action==='deleteCard')return deleteCard();
 if(action==='removeCardImage'){if(ui.cardDraft){ui.cardDraft.image='';render();}return;}
 if(action==='openGallery'){readHomeValues();ui.galleryOpen=true;ui.gallerySelected=null;render();return;}
 if(action==='closeGallery'){ui.galleryOpen=false;ui.gallerySelected=null;render();return;}
 if(action==='galleryDetail'){ui.gallerySelected=el.dataset.id;render();return;}
 if(action==='galleryBack'){ui.gallerySelected=null;render();return;}
 if(action==='editDeck'){readHomeValues();ui.deckOpen=true;ui.deckDraft=null;render();return;}
 if(action==='closeDeck'){ui.deckOpen=false;ui.deckDraft=null;render();return;}
 if(action==='deckBack'){ui.deckDraft=null;render();return;}
 if(action==='deckNew'||action==='deckNewRed'||action==='deckNewBlue'){
   startDeckDraft('new');
   if(ui.deckDraft&&action!=='deckNew'){ui.deckDraft.counts=copyPreset(action==='deckNewRed'?'red':'blue');ui.deckDraft.name=action==='deckNewRed'?'紅蓮デッキ（新規）':'蒼海デッキ（新規）';render();}
   return;
 }
 if(action==='deckSelect'){selectDeck(el.dataset.id);return;}
 if(action==='deckEdit'){const d=ui.decks.decks.find(x=>x.id===el.dataset.id);if(d)startDeckDraft('edit',d);return;}
 if(action==='deckShare'){shareDeck(el.dataset.id);return;}
 if(action==='deckClone'){
   const d=ui.decks.decks.find(x=>x.id===el.dataset.id);
   if(!d||ui.decks.decks.length>=MAX_SAVED_DECKS)return;
   const cloned=newDeck(d.name+' のコピー',d.counts);ui.decks.decks.push(cloned);persistDecks();render();toast('デッキを複製しました');return;
 }
 if(action==='deckDelete'){
   const d=ui.decks.decks.find(x=>x.id===el.dataset.id);
   if(!d||ui.decks.decks.length<=1||!confirm(`「${d.name}」を削除しますか？`))return;
   ui.decks.decks=ui.decks.decks.filter(x=>x.id!==d.id);
   if(ui.decks.activeId===d.id)ui.decks.activeId=ui.decks.decks[0].id;
   persistDecks();render();toast('デッキを削除しました');return;
 }
 if(action==='deckPlus'||action==='deckMinus'){
   if(!ui.deckDraft)return;
   const counts=ui.deckDraft.counts,id=el.dataset.id,n=counts[id]||0;
   if(action==='deckPlus'&&n<Math.min(cardLimit(CARD[id]),ui.collectionOnly?(ui.packs.collection[id]||0):3)&&sum(counts)<ui.rules.deckSize)counts[id]=n+1;
   if(action==='deckMinus'&&n>0){if(n===1)delete counts[id];else counts[id]=n-1;}
   refreshDeckEditor();return;
 }
 if(action==='loadRed'||action==='loadBlue'||action==='deckClear'){
   if(!ui.deckDraft)return;
   ui.deckDraft.counts=action==='deckClear'?{}:copyPreset(action==='loadRed'?'red':'blue');render();return;
 }
 if(action==='saveDeck'){saveDeck();return;}
 if(action==='acceptShare'){addImportedDeck();return;}
 if(action==='rejectShare'){closeShare();return;}
 if(action==='demo')return startDemo();
 if(action==='createRoom')return remoteCreate();
 if(action==='joinRoom')return remoteJoin();
 if(action==='copyInvite')return copyInvite();
 if(action==='goHome')return goHome();
 if(action==='switchSeat'){ui.seat=1-ui.seat;ui.selected=null;ui.targetMode=null;storeDemo();render();return;}
 if(action==='nextPhase')return send({type:'nextPhase'});
 if(action==='chainPass')return send({type:'chainPass'});
 if(action==='quickResponse'){
   const source=el.dataset.source,index=Number(el.dataset.index),p=activePlayer();
   const id=source==='hand'?p.hand[index]:p.backrow[index]?.id;
   if(effectNeedsTarget(id)){
     ui.targetMode={type:'quick',source,index,id};ui.selected=null;render();toast('効果の対象をタップしてください');return;
   }
   return send({type:'quickResponse',source,index});
 }
 if(action==='chainTrap'){const i=Number(el.dataset.index),c=CARD[activePlayer()?.backrow[i]?.id];
  if(c?.ability&&['ownMonster','enemyMonster'].includes(c.ability.target)){ui.targetMode={type:'chainTrap',index:i,owner:c.ability.target==='ownMonster'?'mine':'opponent'};render();return;}
  return send({type:'chainTrap',index:i});}
 if(action==='manualDraw')return send({type:'manualDraw'});
 if(action==='shuffleDeck')return send({type:'shuffleDeck'});
 if(action==='rollDice')return send({type:'random',kind:'dice'});
 if(action==='flipCoin')return send({type:'random',kind:'coin'});
 if(action==='requestUndo'||action==='approveUndo'||action==='rejectUndo')return send({type:action});
 if(action==='undoDemo')return send({type:'undoDemo'});
 if(action==='moveSelected'){const x=ui.selected;if(!x||x.owner!=='mine')return;const n=Number(prompt('移動先の空いているゾーン番号（1〜5）を入力'));if(!Number.isInteger(n)||n<1||n>5)return toast('1〜5で指定してください');return send({type:'moveCard',zone:x.zone,from:x.index,to:n-1});}
 if(action==='destroySelected'||action==='banishSelected'){const x=ui.selected;if(x?.owner!=='mine')return;return send({type:action==='destroySelected'?'manualDestroy':'manualBanish',zone:x.zone,index:x.index});}
 if(action==='banishFromGrave'){const n=Number(prompt('除外する墓地のカード番号を指定\n'+(activePlayer()?.grave||[]).map((id,i)=>`${i+1}: ${CARD[id]?.name||id}`).join('\n')));if(Number.isInteger(n))return send({type:'banishGrave',index:n-1});return;}
 if(action==='endTurn')return send({type:'endTurn'});
 if(action==='passAttack')return send({type:'passAttack'});
 if(action==='trap'){
  const i=Number(el.dataset.index??ui.selected?.index),c=CARD[activePlayer()?.backrow[i]?.id];
  if(c?.ability&&['enemyMonster','ownMonster'].includes(c.ability.target)){
   ui.targetMode={type:'chainTrap',attack:true,index:i,owner:c.ability.target==='ownMonster'?'mine':'opponent'};render();return;
  }
  return send({type:'activateTrap',index:i});
 }
 if(action==='summonAtk')return attemptSummon(false);
 if(action==='summonSet')return attemptSummon(true);
 if(action==='setHand')return send({type:'setBackrow',hand:ui.selected.index});
 if(action==='spellHand')return chooseSpell('hand',ui.selected.index);
 if(action==='spellField')return chooseSpell(ui.selected.zone==='field'?'field':'backrow',ui.selected.index);
 if(action==='flip')return send({type:'flip',index:ui.selected.index});
 if(action==='changePosition')return send({type:'changePosition',index:ui.selected.index});
 if(action==='discard')return send({type:'discard',hand:ui.selected.index});
 if(action==='monsterEffect'){
   const i=ui.selected?.index,m=activePlayer()?.monsters[i],c=CARD[m?.id];
   if(!c)return;
   if((c.ability&&['ownMonster','enemyMonster'].includes(c.ability.target))||c.monsterEffect?.code==='destroy1'){
     ui.targetMode={type:'monsterEffect',index:i,owner:c.ability?.target==='ownMonster'?'mine':'opponent'};ui.selected=null;render();return;
   }
   return send({type:'activateMonsterEffect',index:i});
 }
 if(action==='attackSelect'){ui.targetMode={type:'attack',index:ui.selected.index};ui.selected=null;render();return;}
 if(action==='directAttack')return send({type:'attack',index:ui.targetMode.index,target:null});
 if(action==='cancelTarget'){ui.targetMode=null;render();return;}
 if(action==='surrender'&&confirm('本当に降参しますか？'))return send({type:'surrender'});
 if(action==='showGrave'){ui.graveOpen=true;render();return;}
 if(action==='closeGrave'){ui.graveOpen=false;render();return;}
});
$('view').addEventListener('input',e=>{
 if(e.target.id==='fxVolume'){ui.fxSettings.volume=Number(e.target.value);writeFxSettings(ui.fxSettings);const el=$('fxVolumeValue');if(el)el.textContent=`${ui.fxSettings.volume}%`;return;}
 if(e.target.id==='gallerySearch'){updateCardRows('gallery');return;}
 if(e.target.id==='deckSearch'){updateCardRows('deck');return;}
 if(e.target.id==='deckName'&&ui.deckDraft){ui.deckDraft.name=e.target.value;return;}
 if(e.target.id==='cardSearch'){
   const q=e.target.value.toLocaleLowerCase('ja');
   for(const row of document.querySelectorAll('.card-manage-item'))row.hidden=!row.dataset.cardname.toLocaleLowerCase('ja').includes(q);
 }
 if(ui.cardDraft&&['cardName','cardLevel','cardAtk','cardDef','cardEmoji','cardDesc'].includes(e.target.id)){
   readCardForm();
   const preview=document.querySelector('.card-demo');if(preview)preview.innerHTML=cardHtmlPreview(ui.cardDraft);
 }

});
$('view').addEventListener('change',async e=>{
 if(['fxVisualToggle','fxSoundToggle','fxBgmToggle'].includes(e.target.id)){
   ui.fxSettings[e.target.id==='fxVisualToggle'?'visuals':e.target.id==='fxSoundToggle'?'sound':'bgm']=e.target.checked;
   writeFxSettings(ui.fxSettings);
   if(e.target.id==='fxSoundToggle'&&e.target.checked)unlockAudio();
   if(e.target.id==='fxBgmToggle')setBgmPlaying(ui.fxSettings.bgm);
   return;
 }
 if(e.target.id==='cardImage'&&e.target.files?.[0]){
   readCardForm(); // 写真選択前に入力した名前・ATK等が消えないよう保存
   ui.cardBusy=true;
   try {const img=await compressCardImage(e.target.files[0]);if(ui.cardDraft){ui.cardDraft.image=img;toast('画像を登録しました');}}
   catch(err){toast('画像を読み込めません：'+err.message);}
   finally{ui.cardBusy=false;render();}return;
 }
 if(['cardType','cardSubtype','cardSpellKind','cardEffectKind','cardEffectMode','cardAbilityWhen','cardAbilityOperation'].includes(e.target.id)&&ui.cardDraft){
   readCardForm();
   if(e.target.id==='cardType'){
     ui.cardDraft.type=e.target.value;
     if(ui.cardDraft.type==='monster'){ui.cardDraft.subtype='normal';delete ui.cardDraft.effect;}
     else{ui.cardDraft.effect=ui.cardDraft.type==='spell'?'draw2':'negate';if(ui.cardDraft.type==='spell')ui.cardDraft.spellKind='normal';delete ui.cardDraft.monsterEffect;}
   }
   if(e.target.id==='cardSubtype')ui.cardDraft.subtype=e.target.value;
   if(e.target.id==='cardSpellKind'){
     ui.cardDraft.spellKind=e.target.value;
     if(ui.cardDraft.ability?.when==='continuous'&&!persistentSpell(ui.cardDraft))ui.cardDraft.ability.when='main';
     if(e.target.value==='equip')ui.cardDraft.ability={when:'continuous',operation:'boost',target:'ownMonster',amount:500};
     if(e.target.value==='field')ui.cardDraft.ability={when:'continuous',operation:'boost',target:'ownMonster',amount:500};
   }
   if(e.target.id==='cardEffectKind')ui.cardDraft.monsterEffect={kind:e.target.value,code:Object.keys(MONSTER_EFFECTS[e.target.value])[0]};
   if(e.target.id==='cardEffectMode'){
     if(e.target.value==='builder'){
       const when=ui.cardDraft.type==='trap'?'attack':'main';ui.cardDraft.ability={when,operation:'damage',target:'opponent',amount:500};
     }else delete ui.cardDraft.ability;
   }
   if(e.target.id==='cardAbilityWhen'&&ui.cardDraft.ability){
     ui.cardDraft.ability.when=e.target.value;
     if(e.target.value==='continuous')ui.cardDraft.ability={when:'continuous',operation:'boost',target:'ownMonster',amount:500};
     else if(ui.cardDraft.ability.operation==='negateAttack'&&e.target.value!=='attack')ui.cardDraft.ability={when:e.target.value,operation:'damage',target:'opponent',amount:500};
   }
   if(e.target.id==='cardAbilityOperation'&&ui.cardDraft.ability){
     const op=e.target.value,when=ui.cardDraft.ability.when;
     ui.cardDraft.ability.operation=op;ui.cardDraft.ability.target=abilityTargets(op,when)[0];ui.cardDraft.ability.amount=EFFECT_VALUES[op][0];
   }
   render();return;
 }
 if(['cardEffectCode','cardAbilityTarget','cardAbilityAmount','cardLimit'].includes(e.target.id)&&ui.cardDraft){readCardForm();return;}
 if(e.target.id==='cardRarity'&&ui.cardDraft){readCardForm();const preview=document.querySelector('.card-demo');if(preview)preview.innerHTML=cardHtmlPreview(ui.cardDraft);return;}
 if(e.target.id==='matChoice'||e.target.id==='backChoice'){ui.appearance[e.target.id==='matChoice'?'mat':'back']=e.target.value;persistAppearance();return;}
 if(e.target.id==='collectionOnly'){ui.collectionOnly=e.target.checked;render();return;}
 if(e.target.matches('[data-pack-card]')&&ui.packDraft){savePackDraftFields();const id=e.target.dataset.packCard;if(e.target.checked&&!ui.packDraft.ids.includes(id))ui.packDraft.ids.push(id);else if(!e.target.checked)ui.packDraft.ids=ui.packDraft.ids.filter(x=>x!==id);return;}
 if(e.target.id==='activeDeck'){readHomeValues();selectDeck(e.target.value);return;}
 if(e.target.id==='deckType'||e.target.id==='deckRarity'){
   ui[e.target.id==='deckType'?'deckFilterType':'deckFilterRarity']=e.target.value;updateCardRows('deck');return;
 }
 if(e.target.id==='galleryType'||e.target.id==='galleryRarity'){
   ui[e.target.id==='galleryType'?'galleryFilterType':'galleryFilterRarity']=e.target.value;updateCardRows('gallery');return;
 }
});
// オンライン設定前は1台お試しのみ利用可能。
setNetwork('画面の準備完了');render();window.__DUEL_READY=true;initFirebase();
