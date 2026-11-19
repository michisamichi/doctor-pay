import {CARD, expandDeck, shuffle, validDeck, spellKind, persistentSpell} from './cards.js?v=80';
import {normalizeRuleSettings} from './rules.js?v=80';

export const PHASES = {draw:'ドロー',main1:'メイン1',battle:'バトル',main2:'メイン2',end:'エンド'};
const blank5 = () => [null,null,null,null,null];
const fail = msg => {throw new Error(msg)};
const assert = (cond,msg) => {if(!cond) fail(msg)};
const opponent = seat => 1-seat;
const mustCard = id => {assert(!!CARD[id],'不明なカードです');return CARD[id];};
export function effectiveAtk(item,state=null,seat=null){
  if(!item)return 0;
  const c=CARD[item.id];if(!c)return 0;
  const extra=item.pos!=='set'&&c.ability?.when==='continuous'&&c.ability.operation==='boost'?c.ability.amount:
    c.subtype==='effect'&&c.monsterEffect?.kind==='continuous'&&item.pos!=='set'?
    (c.monsterEffect.code==='atk300'?300:c.monsterEffect.code==='atk500'?500:0):0;
  let spellBonus=0;
  if(state&&seat!==null&&item.pos!=='set'){
    const p=state.players[seat];
    for(const slot of [...(p.backrow||[]),p.field]){
      if(!slot||slot.faceDown)continue;
      const spell=CARD[slot.id];if(!spell||spell.type!=='spell')continue;
      const kind=spellKind(spell),ab=actionAbility(spell);
      if(!persistentSpell(spell)||ab?.operation!=='boost')continue;
      if(kind==='field'||(slot.linkKey!==undefined&&slot.linkKey===item.key))spellBonus+=ab.amount||0;
    }
  }
  return c.atk+(item.bonus||0)+extra+spellBonus;
}
function activateMonsterAbility(s,seat,item,kind){
  const c=mustCard(item.id), e=c.monsterEffect;
  assert(c.subtype==='effect'&&e?.kind===kind,'この種類の効果は発動できません');
  const p=s.players[seat],enemy=s.players[1-seat];
  switch(e.code){
    case 'draw1':draw(p,1,s);break;
    case 'heal500':p.lp+=500;break;
    case 'burn500':enemy.lp=Math.max(0,enemy.lp-500);break;
    case 'atk500':item.bonus=(item.bonus||0)+500;break;
    case 'destroy1':
      assert(kind==='ignition'&&Number.isInteger(target)&&!!getMonster(s,1-seat,target),'破壊する相手モンスターを選択してください');
      sendToGrave(enemy,'monsters',target);break;
    default:fail('このモンスター効果には未対応です');
  }
  log(s,`「${c.name}」の効果を発動！`);
  checkWinner(s);
}

const log = (s,text) => {s.log.unshift(text);s.log=s.log.slice(0,30);};
/** RTDB は null しかない配列や空配列を省略するため、読み込み時に形を復元。 */
export function normalizeRoom(s) {
  if(!s)return null;
  if(!Array.isArray(s.players))s.players=[s.players?.[0]??null,s.players?.[1]??null];
  for(const p of s.players){
    if(!p)continue;
    for(const field of ['monsters','backrow']){
      const original=p[field]||{};
      p[field]=Array.from({length:5},(_,i)=>original[i]??null);
    }
    p.banished=Array.isArray(p.banished)?p.banished:[];
    p.field=p.field||null;
    for(const field of ['hand','deck','grave']){
      const original=p[field]||[];
      p[field]=Array.isArray(original)?original:Object.keys(original).sort((a,b)=>+a-+b).map(k=>original[k]);
    }
    p.normalUsed=!!p.normalUsed;
  }
  s.nextKey=Number.isInteger(s.nextKey)?s.nextKey:0;
  s.log=Array.isArray(s.log)?s.log:[];
  s.pending=s.pending||null;
  return s;
}
const newPlayer = ({uid,name,counts,rules}) => {
  assert(validDeck(counts,rules),`デッキは${rules.deckSize}枚・禁止制限を守る必要があります`);
  return {uid, name:String(name||'プレイヤー').slice(0,12),
    deck:shuffle(expandDeck(counts)), hand:[], monsters:blank5(), backrow:blank5(), grave:[],banished:[],
    field:null,lp:rules.lp,normalUsed:false};
};
export function createRoom({uid,name,counts,rules}) {
  rules=normalizeRuleSettings(rules);
  return {status:'waiting',rules,players:[newPlayer({uid,name,counts,rules}),null],turn:0,turnNo:1,
    phase:'main1',nextKey:0,pending:null,winner:null,log:['対戦相手の入室を待っています'],revision:0,createdAt:Date.now()};
}
export function joinRoom(state,{uid,name,counts}) {
  assert(state?.status==='waiting','参加できる部屋ではありません');
  assert(state.players[0].uid!==uid,'同じ端末からはオンライン対戦に参加できません');
  assert(!state.players[1],'すでに2人参加しています');
  const s=normalizeRoom(structuredClone(state));
  s.rules=normalizeRuleSettings(s.rules);
  s.players[1]=newPlayer({uid,name,counts,rules:s.rules});
  s.status='playing';s.turn=Math.random()<0.5?0:1;
  s.turnNo=1; s.phase='draw';s.log=[];
  for(const p of s.players) draw(p,5,s,false);
  log(s,`対戦開始！ ${s.players[s.turn].name} が先攻です。`);
  s.revision++;
  return s;
}
export function createDemo({counts1,counts2,rules}) {
  const s=createRoom({uid:'demo-a',name:'プレイヤー1',counts:counts1,rules});
  return joinRoom(s,{uid:'demo-b',name:'プレイヤー2',counts:counts2});
}
function draw(p,n,s,loseOnShort=true) {
  for(let i=0;i<n;i++) {
    if(!p.deck.length) {
      if(loseOnShort) {s.status='finished';s.winner=s.players.indexOf(p)===0?1:0;log(s,`${p.name} はカードを引けず敗北。`);return false;}
      fail('ドローするカードが足りません');
    }
    p.hand.push(p.deck.shift());
  }
  return true;
}
function checkWinner(s) {
  if(s.status==='finished')return;
  if(s.players[0].lp<=0 || s.players[1].lp<=0){
    s.status='finished';
    s.winner=s.players[0].lp<=0 && s.players[1].lp<=0?'draw':s.players[0].lp<=0?1:0;
    log(s,s.winner==='draw'?'引き分けです。':`${s.players[s.winner].name} の勝利です！`);
  }
}
function requireMain(s,seat) {
  assert(s.turn===seat,'自分のターンではありません');
  assert(!s.pending,'相手の対応を待っています');
  assert(s.phase==='main1'||s.phase==='main2','メインフェイズではありません');
}
function reqOwn(s,seat) {assert([0,1].includes(seat) && s.players[seat], 'プレイヤーが見つかりません');}
const arrayIndex = (xs,i)=>Number.isInteger(i) && i>=0 && i<xs.length;
function getMonster(s,seat,index) {
  assert(arrayIndex(s.players[seat].monsters,index),'場所が不正です');
  return s.players[seat].monsters[index];
}
function sendToGrave(p,zone,index) {
  const item=p[zone][index];
  if(item){p.grave.push(item.id);p[zone][index]=null;
    if(zone==='monsters'&&item.key!==undefined)removeOrphanEquips(p);
  }
}
function removeOrphanEquips(p){
  const alive=new Set(p.monsters.filter(Boolean).map(m=>m.key));
  for(let i=0;i<p.backrow.length;i++){
    const v=p.backrow[i];if(v?.linkKey!==undefined&&!alive.has(v.linkKey)){
      p.grave.push(v.id);p.backrow[i]=null;
    }
  }
}
function sweepOrphanEquips(s){for(const p of s.players){if(p)removeOrphanEquips(p);}}
function resolveAttack(s) {
  const a=s.pending;
  assert(a?.kind==='attack','処理する攻撃がありません');
  const atkP=s.players[a.by],defP=s.players[1-a.by];
  const attacker=atkP.monsters[a.attacker];
  if(!attacker){log(s,'攻撃モンスターがいないため、攻撃は終了しました。');s.pending=null;return;}
  const atk=effectiveAtk(attacker,s,a.by);
  if(a.target===null) {
    if(defP.monsters.some(Boolean)) {log(s,'相手のモンスターがいるため直接攻撃できません。');}
    else{defP.lp=Math.max(0,defP.lp-atk);log(s,`${atkP.name} の直接攻撃！ ${defP.name} に${atk}ダメージ。`);}
  } else {
    const defender=defP.monsters[a.target];
    if(!defender) {log(s,'対象モンスターがいなくなったため攻撃は終了しました。');s.pending=null;return;}
    const dc=mustCard(defender.id);
    if(defender.pos==='set'){defender.pos='def';log(s,`${dc.name} が表になりました。`);}
    const isAtk=defender.pos==='atk';
    const power=isAtk?effectiveAtk(defender,s,1-a.by):dc.def;
    if(atk>power){
      sendToGrave(defP,'monsters',a.target);
      if(isAtk)defP.lp=Math.max(0,defP.lp-(atk-power));
      log(s,`${mustCard(attacker.id).name} が ${dc.name} を破壊！${isAtk?` ${atk-power}ダメージ。`:''}`);
    } else if(atk<power) {
      if(isAtk)sendToGrave(atkP,'monsters',a.attacker);
      atkP.lp=Math.max(0,atkP.lp-(power-atk));
      log(s,`${dc.name} が攻撃を防ぎ、${atkP.name} に${power-atk}ダメージ。`);
    } else {
      if(isAtk){sendToGrave(atkP,'monsters',a.attacker);sendToGrave(defP,'monsters',a.target);log(s,'攻撃力が同じため、両方のモンスターが破壊されました。');}
      else log(s,'攻撃力と守備力が同じため、どちらも破壊されません。');
    }
  }
  s.pending=null;checkWinner(s);
}
function actionAbility(card){
 if(card?.ability)return card.ability;
 if(card?.type==='spell'){
  const op={draw2:['draw','self',2],heal1000:['heal','self',1000],burn800:['damage','opponent',800],destroy:['destroy','enemyMonster',0],boost500:['boost','ownMonster',500]}[card.effect];
  return op?{when:'main',operation:op[0],target:op[1],amount:op[2]}:null;
 }
 if(card?.type==='trap'){
  const op={negate:['negateAttack','none',0],counterdestroy:['destroy','attacker',0],counterburn:['damage','opponent',700]}[card.effect];
  return op?{when:'attack',operation:op[0],target:op[1],amount:op[2]}:null;
 }
 if(card?.monsterEffect){
  const op={draw1:['draw','self',1],heal500:['heal','self',500],burn500:['damage','opponent',500],atk500:['boost','ownMonster',500],destroy1:['destroy','enemyMonster',0]}[card.monsterEffect.code];
  return op?{when:card.monsterEffect.kind==='trigger'?'summon':card.monsterEffect.kind==='continuous'?'continuous':'main',operation:op[0],target:op[1],amount:op[2]}:null;
 }
 return null;
}
function abilityTargetCheck(s,seat,ability,target,sourceIndex){
 if(!ability)fail('効果の定義がありません');
 if(['ownMonster','enemyMonster'].includes(ability.target)){
   const who=ability.target==='ownMonster'?seat:1-seat;
   if(ability.when==='continuous'&&sourceIndex!==undefined)return;
   assert(Number.isInteger(target)&&!!getMonster(s,who,target),'対象モンスターを選んでください');
 }
 if(ability.target==='attacker')assert(s.pending?.kind==='attack'||s.pending?.afterAttack,'攻撃中のみ使用できます');
}
function executeAbility(s,entry,chain){
 const seat=entry.seat, p=s.players[seat],enemy=s.players[1-seat],card=mustCard(entry.cardId);
 const ab=actionAbility(card);if(!ab)return;
 const targetSeat=ab.target==='ownMonster'?seat:ab.target==='enemyMonster'?1-seat:ab.target==='attacker'?chain?.afterAttack?.by:null;
 const targetIndex=ab.target==='attacker'?chain?.afterAttack?.attacker:entry.target;
 const item=targetSeat===null?null:s.players[targetSeat].monsters[targetIndex];
 switch(ab.operation){
  case 'draw':draw(p,ab.amount,s);break;
  case 'heal':p.lp+=ab.amount;break;
  case 'damage':enemy.lp=Math.max(0,enemy.lp-ab.amount);break;
  case 'destroy':if(item)sendToGrave(s.players[targetSeat],'monsters',targetIndex);break;
  case 'banish':if(item){s.players[targetSeat].banished.push(item.id);s.players[targetSeat].monsters[targetIndex]=null;}break;
  case 'boost':if(item&&!(card.type==='spell'&&persistentSpell(card)))item.bonus=(item.bonus||0)+ab.amount;break;
  case 'negateAttack':if(chain)chain.attackNegated=true;break;
 }
 if(card.type==='trap'&&chain?.afterAttack&&ab.when==='attack')chain.attackNegated=true; // legacy attack traps prevent damage
 log(s,`${p.name}：「${card.name}」の効果を解決しました。`);
 sweepOrphanEquips(s);
 checkWinner(s);
}
function startChain(s,entry,afterAttack=null){
 assert(!s.pending||s.pending.kind==='attack','対応処理中です');
 s.pending={kind:'chain',stack:[entry],priority:1-entry.seat,passes:0,afterAttack,attackNegated:false};
 log(s,`チェーン1：「${mustCard(entry.cardId).name}」発動。相手の応答を待ちます。`);
}
function castSpell(s,seat,source,index,target){
  const p=s.players[seat],ch=s.pending;
  const responding=!!ch,attackResponse=ch?.kind==='attack';
  const fromHand=source==='hand';
  const old=fromHand?p.hand[index]:source==='field'?p.field:p.backrow[index];
  const id=fromHand?old:old?.id,c=mustCard(id);
  assert(c.type==='spell','魔法カードではありません');
  const kind=spellKind(c),quick=kind==='quick';
  if(responding){
    assert(quick,'対応中は速攻魔法だけ発動できます');
    if(attackResponse)assert(seat!==ch.by,'攻撃への最初の対応は防御側が行います');
    else assert(ch.kind==='chain'&&ch.priority===seat&&ch.stack.length<8,'チェーンの応答順ではありません');
  } else {
    assert(s.turn===seat,'相手ターンに手札から魔法は使えません');
    assert(quick||['main1','main2'].includes(s.phase),'メインフェイズで発動してください');
    assert(!quick||['draw','main1','battle','main2'].includes(s.phase),'このフェイズでは使えません');
  }
  if(fromHand)assert(s.turn===seat&&arrayIndex(p.hand,index),'手札からの発動は自分ターンのみです');
  else {
    assert(old&&old.faceDown,'セット済みの魔法カードを選んでください');
    if(kind==='quick')assert(old.setTurn<s.turnNo,'速攻魔法はセットしたターンには発動できません');
  }
  const ab=actionAbility(c);assert(ab,'この魔法の効果は未対応です');
  if(!(kind==='field'&&ab.when==='continuous'&&ab.operation==='boost'))abilityTargetCheck(s,seat,ab,target);
  // 装備魔法は対象のモンスターに紐付ける。移動しても装備関係は維持する。
  if(kind==='equip'){
    assert(ab.target==='ownMonster'&&Number.isInteger(target),'装備する自分のモンスターを選んでください');
    const monster=getMonster(s,seat,target);
    if(monster.key===undefined)monster.key=++s.nextKey;
  }
  const ongoing=persistentSpell(c);
  let slotItem={id,faceDown:false,setTurn:s.turnNo};
  if(!fromHand)slotItem={...old,faceDown:false};
  if(kind==='equip'||(kind==='continuous'&&ab.target==='ownMonster'&&ab.operation==='boost')){
    const monster=getMonster(s,seat,target);
    if(monster.key===undefined)monster.key=++s.nextKey;
    slotItem.linkKey=monster.key;
  }
  if(fromHand){
    if(ongoing&&kind!=='field')assert(p.backrow.some(v=>v===null),'魔法・罠ゾーンが満杯です');
    p.hand.splice(index,1);
    if(ongoing){
      if(kind==='field'){
        if(p.field)p.grave.push(p.field.id);
        p.field=slotItem;
      }else p.backrow[p.backrow.indexOf(null)]=slotItem;
    }else p.grave.push(id);
  }else if(source==='field'){
    assert(kind==='field','フィールドゾーンにある魔法ではありません');
    p.field=slotItem;
  }else{
    assert(arrayIndex(p.backrow,index),'ゾーンが不正です');
    if(ongoing)p.backrow[index]=slotItem;
    else{p.backrow[index]=null;p.grave.push(id);}
  }
  const entry={seat,cardId:id,target};
  if(!responding){startChain(s,entry);return;}
  if(attackResponse){startChain(s,entry,{...ch});return;}
  ch.stack.push(entry);ch.priority=1-seat;ch.passes=0;
  log(s,`チェーン${ch.stack.length}：「${c.name}」発動！`);
}
function addChainTrap(s,seat,index,target){
 const ch=s.pending;assert(ch?.kind==='chain'&&ch.priority===seat,'チェーンの応答順ではありません');
 assert(ch.stack.length<8,'チェーンは最大8つまでです');
 const item=s.players[seat].backrow[index];assert(item&&mustCard(item.id).type==='trap','罠カードがありません');
 assert(item.setTurn<s.turnNo,'セットしたターンに罠は使えません');
 const c=mustCard(item.id),ab=actionAbility(c);assert(ab&&(ab.when==='response'||(ab.when==='attack'&&ch.afterAttack)),'今はこの罠を発動できません');
 abilityTargetCheck(s,seat,ab,target);
 s.players[seat].backrow[index]=null;s.players[seat].grave.push(item.id);
 ch.stack.push({seat,cardId:item.id,target});ch.priority=1-seat;ch.passes=0;
 log(s,`チェーン${ch.stack.length}：「${c.name}」発動！`);
}
function finishChain(s){
 const ch=s.pending;assert(ch?.kind==='chain','チェーンがありません');
 const after=ch.afterAttack;
 // Unwind from most recently activated to oldest. Resolve target if still present.
 for(const entry of [...ch.stack].reverse()){
   if(s.status==='finished')break;
   executeAbility(s,entry,ch);
 }
 s.pending=null;
 sweepOrphanEquips(s);
  if(after&&s.status==='playing'&&!ch.attackNegated){s.pending={kind:'attack',...after};resolveAttack(s);}
 else if(after)log(s,'攻撃は無効になりました。');
 checkWinner(s);
}
function takeSnapshot(s){const snapshot={};for(const key of ['status','players','turn','turnNo','phase','pending','winner','log','lastEvent','lastRandom','rules','nextKey'])snapshot[key]=structuredClone(s[key]??null);return snapshot;}

function endTurn(s) {
  assert(!s.pending,'相手の対応が終わっていません');
  const p=s.players[s.turn];assert(s.phase!=='draw','ドローフェイズを完了してください');assert(p.hand.length<=6,'手札が7枚以上あります。6枚以下になるまで手札を捨ててください。');
  for(const pl of s.players)for(const mon of pl.monsters)if(mon)mon.bonus=0;
  s.turn=1-s.turn;s.turnNo++;s.phase='draw';s.players[s.turn].normalUsed=false;
  const active=s.players[s.turn];
  for(const mon of active.monsters)if(mon)mon.attacked=false;
  log(s,`${active.name} のターン。`);
  checkWinner(s);
}
/**
 * Firebase の transaction / ローカルお試しに共通する純粋な状態更新関数。
 * 不正な操作時は Error を投げ、既存の状態は変更しない。
 */
export function applyAction(current,actorUid,action) {
  assert(current?.status==='playing'||(['requestUndo','approveUndo','rejectUndo'].includes(action?.type)&&current?.status==='finished'),'対戦中ではありません');
  const s=normalizeRoom(structuredClone(current));
  const before=takeSnapshot(s);
  const seat=s.players.findIndex(p=>p?.uid===actorUid);
  reqOwn(s,seat);
  const p=s.players[seat],enemy=s.players[1-seat];
  const a=action||{};
  const ownTurn=s.turn===seat;
  const lpBefore=s.players.map(q=>q.lp);
  if(s.undoRequest!==null&&s.undoRequest!==undefined&&!['approveUndo','rejectUndo'].includes(a.type))fail('取り消し依頼への返答を待っています');
  if(a.type==='requestUndo'){assert(s.undoSnapshot&&s.undoActor===seat&&!s.undoRequest,'直前の自分の操作だけ取り消しを依頼できます');s.undoRequest=seat;s.revision++;log(s,'直前の操作の取り消しを相手に依頼しました。');return s;}
  if(a.type==='rejectUndo'){assert(s.undoRequest!==null&&s.undoRequest!==undefined&&s.undoRequest!==seat,'依頼がありません');s.undoRequest=null;s.revision++;log(s,'取り消し依頼を断りました。');return s;}
  if(a.type==='approveUndo'){assert(s.undoRequest!==null&&s.undoRequest!==undefined&&s.undoRequest!==seat&&s.undoSnapshot,'依頼がありません');const restored=normalizeRoom(structuredClone(s.undoSnapshot));restored.revision=(s.revision||0)+1;restored.undoRequest=null;restored.undoSnapshot=null;restored.undoActor=null;log(restored,'双方の同意により直前の操作を取り消しました。');return restored;}
  // Store only a public, non-sensitive cue for audiovisual sync.
  let cueType=null, cueCard=null;
  switch(a.type){
    case 'summon':cueType=a.faceDown?'set':'summon';cueCard=p.hand[a.hand];break;
    case 'flip':cueType='summon';cueCard=p.monsters[a.index]?.id;break;
    case 'activateMonsterEffect':cueType='effect';cueCard=p.monsters[a.index]?.id;break;
    case 'spellFromHand':cueType='spell';cueCard=p.hand[a.hand];break;
    case 'quickResponse':cueType='spell';cueCard=a.source==='hand'?p.hand[a.index]:p.backrow[a.index]?.id;break;
    case 'spellFromField':cueType='spell';cueCard=p.backrow[a.index]?.id;break;
    case 'activateTrap':cueType='trap';cueCard=p.backrow[a.index]?.id;break;
    case 'attack':cueType='attack';cueCard=p.monsters[a.index]?.id;break;
    case 'passAttack':cueType='impact';cueCard=s.players[s.pending?.by]?.monsters[s.pending?.attacker]?.id;break;
    case 'setBackrow':cueType='set';cueCard=p.hand[a.hand];break;
  }
  switch(a.type) {
    case 'summon': {
      requireMain(s,seat);
      assert(!p.normalUsed,'このターンはすでに通常召喚しました');
      assert(arrayIndex(p.hand,a.hand),'手札の位置が不正です');
      const id=p.hand[a.hand],c=mustCard(id);
      assert(c.type==='monster','モンスターではありません');
      const need=c.level<=4?0:c.level<=6?1:2;
      const tributes=a.tributes||[];
      assert(Array.isArray(tributes)&&tributes.length===need,'必要なリリース数が違います');
      assert(new Set(tributes).size===tributes.length,'同じモンスターを2回リリースできません');
      assert(tributes.every(i=>Number.isInteger(i)&&!!getMonster(s,seat,i)),'リリースするモンスターを正しく選んでください');
      const slot=p.monsters.findIndex((m,i)=>m===null||tributes.includes(i));
      assert(slot>=0,'モンスターゾーンが満杯です');
      for(const i of tributes)sendToGrave(p,'monsters',i);
      p.hand.splice(a.hand,1);
      p.monsters[slot]={key:++s.nextKey,id,pos:a.faceDown?'set':(a.position==='def'?'def':'atk'),bornTurn:s.turnNo,attacked:false,changedTurn:s.turnNo,bonus:0};
      p.normalUsed=true;
      if(!a.faceDown&&c.subtype==='effect'&&s.status==='playing'){
        if(c.ability?.when==='summon'){
          // The simplified summon-trigger flow cannot ask for a target while summoning.
          // Own-monster effects use the summoned card; opponent-target effects pick
          // the first available opposing monster instead of silently doing nothing.
          const target=c.ability.target==='ownMonster'?slot:c.ability.target==='enemyMonster'?
            enemy.monsters.findIndex(Boolean):null;
          if(target!==-1)executeAbility(s,{seat,cardId:id,target},null);
          else log(s,`「${c.name}」の効果は対象がいないため処理できませんでした。`);
        }else if(c.monsterEffect?.kind==='trigger')activateMonsterAbility(s,seat,p.monsters[slot],'trigger');
      }
      log(s,`${p.name} はモンスターを${a.faceDown?'裏側守備表示でセット':a.position==='def'?'守備表示で召喚':'召喚'}しました。`);
      break;
    }
    case 'activateMonsterEffect': {
      requireMain(s,seat);
      const m=getMonster(s,seat,a.index);
      assert(m&&m.pos!=='set','表側表示の効果モンスターを選んでください');
      const c=mustCard(m.id);
      assert(c.subtype==='effect'&&(c.ability?.when==='main'||c.monsterEffect?.kind==='ignition'),'起動効果ではありません');
      assert(m.effectUsedTurn!==s.turnNo,'このターンはすでに効果を使いました');
      const ab=actionAbility(c);abilityTargetCheck(s,seat,ab,a.target,a.index);
      m.effectUsedTurn=s.turnNo;
      startChain(s,{seat,cardId:m.id,target:ab.target==='ownMonster'&&a.target===undefined?a.index:a.target});
      break;
    }
    case 'setBackrow': {
      requireMain(s,seat);
      assert(arrayIndex(p.hand,a.hand),'手札の位置が不正です');
      const id=p.hand[a.hand],c=mustCard(id);
      assert(c.type==='spell'||c.type==='trap','魔法・罠カードではありません');
      const slot=p.backrow.indexOf(null);assert(c.type==='spell'&&spellKind(c)==='field'||slot>=0,'魔法・罠ゾーンが満杯です');
      p.hand.splice(a.hand,1);
      if(c.type==='spell'&&spellKind(c)==='field'){
        if(p.field)p.grave.push(p.field.id);
        p.field={id,faceDown:true,setTurn:s.turnNo};
      }else p.backrow[slot]={id,faceDown:true,setTurn:s.turnNo};
      log(s,`${p.name} は魔法・罠を1枚セットしました。`);break;
    }
    case 'spellFromHand': {
      castSpell(s,seat,'hand',a.hand,a.target);break;
    }
    case 'spellFromField': {
      castSpell(s,seat,a.field?'field':'backrow',a.index,a.target);break;
    }
    case 'quickResponse': {
      assert(['hand','backrow'].includes(a.source),'発動場所が不正です');
      castSpell(s,seat,a.source,a.index,a.target);break;
    }
    case 'flip': {
      requireMain(s,seat);const m=getMonster(s,seat,a.index);
      assert(m&&m.pos==='set','裏側守備表示のモンスターではありません');
      assert(m.bornTurn!==s.turnNo,'セットしたターンには反転召喚できません');
      m.pos='atk';m.changedTurn=s.turnNo;log(s,`${p.name} は ${CARD[m.id].name} を反転召喚しました。`);break;
    }
    case 'changePosition': {
      requireMain(s,seat);const m=getMonster(s,seat,a.index);
      assert(m&&m.pos!=='set','表側のモンスターを選んでください');
      assert(m.bornTurn!==s.turnNo,'召喚したターンには表示形式を変更できません');
      assert(m.changedTurn!==s.turnNo,'このターンはすでに表示形式を変更しました');
      assert(!m.attacked,'攻撃したモンスターは表示形式を変更できません');
      m.pos=m.pos==='atk'?'def':'atk';m.changedTurn=s.turnNo;log(s,`${p.name} はモンスターの表示形式を変更しました。`);break;
    }
    case 'attack': {
      assert(ownTurn&&s.phase==='battle','バトルフェイズではありません');
      assert(!s.pending,'すでに攻撃の対応待ちです');
      assert(s.turnNo>1,'先攻1ターン目は攻撃できません');
      const m=getMonster(s,seat,a.index);
      assert(m&&m.pos==='atk','攻撃表示のモンスターを選んでください');
      assert(!m.attacked,'このモンスターはすでに攻撃しました');
      const target=a.target===null?null:a.target;
      if(target===null)assert(!enemy.monsters.some(Boolean),'相手のモンスターがいるため直接攻撃できません');
      else assert(Number.isInteger(target)&&!!getMonster(s,1-seat,target),'攻撃対象を選んでください');
      m.attacked=true;s.pending={kind:'attack',by:seat,attacker:a.index,target};
      log(s,`${p.name} の攻撃宣言。${enemy.name} は罠を使うか選んでください。`);break;
    }
    case 'passAttack': {
      assert(s.pending?.kind==='attack'&&s.pending.by!==seat,'対応できる攻撃がありません');
      log(s,`${p.name} はカードを発動しませんでした。`);resolveAttack(s);break;
    }
    case 'activateTrap': {
      assert(s.pending?.kind==='attack'&&s.pending.by!==seat,'相手の攻撃時に発動できます');
      assert(arrayIndex(p.backrow,a.index),'ゾーンが不正です');
      const item=p.backrow[a.index];assert(item&&mustCard(item.id).type==='trap','セットされた罠カードがありません');
      assert(item.setTurn<s.turnNo,'セットしたターンに罠は発動できません');
      const c=mustCard(item.id),ab=actionAbility(c);assert(ab?.when==='attack','この攻撃に対応できない罠です');
      abilityTargetCheck(s,seat,ab,a.target);
      const attack=s.pending;
      p.backrow[a.index]=null;p.grave.push(item.id);
      startChain(s,{seat,cardId:item.id,target:a.target},attack);
      break;
    }
    case 'chainPass': {
      const ch=s.pending;assert(ch?.kind==='chain'&&ch.priority===seat,'あなたの応答順ではありません');
      ch.passes++;ch.priority=1-seat;
      if(ch.passes>=2)finishChain(s);
      else log(s,`${p.name} はチェーンを追加しませんでした。`);
      break;
    }
    case 'chainTrap': {
      assert(Number.isInteger(a.index),'罠の位置が不正です');
      addChainTrap(s,seat,a.index,a.target);break;
    }
    case 'manualDraw': {
      requireMain(s,seat);draw(p,1,s);log(s,`${p.name} が追加ドローしました（カジュアル操作）。`);checkWinner(s);break;
    }
    case 'shuffleDeck':{
      requireMain(s,seat);p.deck=shuffle(p.deck);log(s,`${p.name} がデッキをシャッフルしました。`);break;
    }
    case 'moveCard': {
      requireMain(s,seat);const zone=a.zone;
      assert(['monsters','backrow'].includes(zone),'ゾーンが不正です');
      assert(Number.isInteger(a.from)&&a.from>=0&&a.from<5&&Number.isInteger(a.to)&&a.to>=0&&a.to<5,'位置が不正です');
      assert(p[zone][a.from]&&!p[zone][a.to],'移動元または移動先を確認してください');
      p[zone][a.to]=p[zone][a.from];p[zone][a.from]=null;log(s,`${p.name} がカードの位置を移動しました。`);break;
    }
    case 'manualDestroy': case 'manualBanish':{
      requireMain(s,seat);assert(['monsters','backrow','field'].includes(a.zone),'ゾーンが不正です');
      assert(a.zone==='field'?!!p.field:Number.isInteger(a.index)&&p[a.zone][a.index],'対象カードがありません');
      const item=a.zone==='field'?p.field:p[a.zone][a.index];
      if(a.zone==='field')p.field=null;else p[a.zone][a.index]=null;
      if(a.type==='manualDestroy')p.grave.push(item.id);else p.banished.push(item.id);
      sweepOrphanEquips(s);
      log(s,`${p.name} が自分のカード「${mustCard(item.id).name}」を${a.type==='manualDestroy'?'墓地へ送りました':'除外しました'}。`);break;
    }
    case 'banishGrave':{
      requireMain(s,seat);assert(Number.isInteger(a.index)&&a.index>=0&&a.index<p.grave.length,'墓地の位置が不正です');
      p.banished.push(p.grave.splice(a.index,1)[0]);log(s,`${p.name} は墓地から1枚除外しました。`);break;
    }
    case 'random': {
      assert(!s.pending,'対応待ちの間はできません');
      if(a.kind==='coin'){const face=Math.random()<.5?'表':'裏';s.lastRandom=`コイントス：${face}`;}
      else if(a.kind==='dice'){s.lastRandom=`サイコロ：${Math.floor(Math.random()*6)+1}`;}
      else fail('ランダム操作が不正です');
      log(s,`${p.name} の ${s.lastRandom}`);break;
    }
    case 'nextPhase': {
      assert(ownTurn&&!s.pending,'今は進められません');
      if(s.phase==='draw'){if(s.turnNo>1)draw(p,1,s);if(s.status==='playing')s.phase='main1';}
      else if(s.phase==='main1')s.phase=s.turnNo===1?'main2':'battle';
      else if(s.phase==='battle')s.phase='main2';
      else fail('次はターン終了です');
      log(s,`${p.name}：${PHASES[s.phase]}。`);break;
    }
    case 'endTurn':{
      assert(ownTurn&&!s.pending,'今はターンを終了できません');endTurn(s);break;
    }
    case 'discard':{
      assert(ownTurn&&!s.pending,'今は捨てられません');
      assert(p.hand.length>6,'手札が6枚以下なので捨てる必要はありません');
      assert(arrayIndex(p.hand,a.hand),'手札の位置が不正です');
      p.grave.push(p.hand.splice(a.hand,1)[0]);log(s,`${p.name} が手札を1枚捨てました。`);break;
    }
    case 'surrender':{
      s.status='finished';s.winner=1-seat;log(s,`${p.name} が降参しました。`);break;
    }
    default:fail('不明な操作です');
  }
  s.undoSnapshot=before;s.undoActor=seat;s.undoRequest=null;
  s.revision=(s.revision||0)+1;
  if(s.status==='finished'&&current.status!=='finished'){cueType='win';cueCard=null;}
  if(cueType){
    const damage=lpBefore.reduce((v,old,i)=>v+Math.max(0,old-s.players[i].lp),0);
    s.lastEvent={id:s.revision,type:cueType,cardId:cueCard||null,actor:seat,damage};
  }
  return s;
}
