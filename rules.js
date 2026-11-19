// Duel Craft v0.5. Extensible simple effect vocabulary; not a full OCG rules interpreter.
export const LIMITS={unlimited:{label:'無制限',max:3},semi:{label:'準制限',max:2},limited:{label:'制限',max:1},banned:{label:'禁止',max:0}};
export const RULE_DEFAULT={lp:8000,deckSize:40};
export const TRIGGERS={main:'自分メインで発動',summon:'召喚したとき',continuous:'表側の間ずっと',attack:'相手の攻撃に対応',response:'相手の効果にチェーン'};
export const TARGETS={none:'対象なし',self:'自分のLP / デッキ',opponent:'相手のLP',ownMonster:'自分のモンスター1体',enemyMonster:'相手のモンスター1体',attacker:'攻撃モンスター'};
export const OPERATIONS={draw:'カードを引く',heal:'LPを回復',damage:'LPダメージ',destroy:'モンスター破壊',banish:'モンスター除外',boost:'攻撃力アップ',negateAttack:'攻撃を無効化'};
export const EFFECT_VALUES={draw:[1,2,3],heal:[300,500,800,1000,1500],damage:[300,500,800,1000,1500],boost:[300,500,800,1000,1500],destroy:[0],banish:[0],negateAttack:[0]};
export function normalizeRuleSettings(input){const lp=Number(input?.lp),deckSize=Number(input?.deckSize);return {lp:Number.isInteger(lp)&&lp>=1000&&lp<=20000&&lp%500===0?lp:8000,deckSize:Number.isInteger(deckSize)&&deckSize>=20&&deckSize<=60?deckSize:40};}
export function cardLimit(c){return LIMITS[c?.limit]?.max??3;}
export function isValidAbility(a,type='monster',spellKind='normal'){
  if(!a||typeof a!=='object'||!Object.hasOwn(TRIGGERS,a.when)||!Object.hasOwn(TARGETS,a.target)||!Object.hasOwn(OPERATIONS,a.operation))return false;
  if(!EFFECT_VALUES[a.operation].includes(a.amount))return false;
  if(type==='monster'&&!['main','summon','continuous'].includes(a.when))return false;
  if(type==='spell'&&a.when!=='main'&&!(a.when==='continuous'&&['continuous','equip','field'].includes(spellKind)))return false;
  if(type==='trap'&&!['attack','response'].includes(a.when))return false;
  if(a.when==='continuous'&&!(a.operation==='boost'&&a.target==='ownMonster'))return false;
  if(a.operation==='draw'&&a.target!=='self')return false;
  if(a.operation==='heal'&&a.target!=='self')return false;
  if(a.operation==='damage'&&a.target!=='opponent')return false;
  if(['destroy','banish'].includes(a.operation)&&!['ownMonster','enemyMonster','attacker'].includes(a.target))return false;
  if(a.operation==='boost'&&a.target!=='ownMonster')return false;
  if(a.operation==='negateAttack'&&!(a.when==='attack'&&a.target==='none'))return false;
  if(a.target==='attacker'&&a.when!=='attack')return false;
  return true;
}
export function abilityText(a){if(!a)return '';
  const condition=TRIGGERS[a.when]||'効果';const target=TARGETS[a.target]||'';
  const detail={draw:`${a.amount}枚ドロー`,heal:`${a.amount}LP回復`,damage:`${a.amount}ダメージ`,destroy:'破壊する',banish:'除外する',boost:`ATK＋${a.amount}`,negateAttack:'攻撃を無効'}[a.operation]||'';
  return `${condition}：${target} ${detail}。`;
}
export function readRuleSettings(storage){try{return normalizeRuleSettings(JSON.parse(storage.getItem('duel-rules-v5')||'{}'));}catch{return {...RULE_DEFAULT};}}
export function writeRuleSettings(storage,value){const r=normalizeRuleSettings(value);storage.setItem('duel-rules-v5',JSON.stringify(r));return r;}
