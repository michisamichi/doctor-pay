import {LIMITS,cardLimit,isValidAbility,abilityText} from './rules.js?v=80';
// オリジナルカード。データを追加すればカードプールを拡張できます。
export const CARDS = [
  {id:'m01',name:'紅蓮の剣士',type:'monster',level:4,atk:1800,def:1100,emoji:'⚔️',desc:'炎の剣で戦う勇敢な戦士。'},
  {id:'m02',name:'火山の番兵',type:'monster',level:4,atk:1600,def:1700,emoji:'🌋',desc:'熱い岩肌で敵の攻撃を防ぐ。'},
  {id:'m03',name:'焔の小竜',type:'monster',level:3,atk:1500,def:900,emoji:'🐉',desc:'小さくても強い炎の竜。'},
  {id:'m04',name:'陽炎の魔術師',type:'monster',level:4,atk:1700,def:1200,emoji:'🔥',desc:'幻影を操る炎の術師。'},
  {id:'m05',name:'赤銅の騎士',type:'monster',level:4,atk:1400,def:2000,emoji:'🛡️',desc:'鋼の盾で味方を守る。'},
  {id:'m06',name:'燃える狼',type:'monster',level:3,atk:1300,def:1000,emoji:'🐺',desc:'炎をまとう俊敏な狼。'},
  {id:'m07',name:'蒼海の騎士',type:'monster',level:4,atk:1750,def:1300,emoji:'🔱',desc:'青い海を守る剣士。'},
  {id:'m08',name:'深海の守護者',type:'monster',level:4,atk:1400,def:2100,emoji:'🐢',desc:'頑丈な甲羅を持つ守護者。'},
  {id:'m09',name:'しずくの精霊',type:'monster',level:3,atk:1200,def:1600,emoji:'💧',desc:'水流を自在に操る精霊。'},
  {id:'m10',name:'氷晶の剣士',type:'monster',level:4,atk:1900,def:800,emoji:'❄️',desc:'氷の刃で敵を切り裂く。'},
  {id:'m11',name:'真珠の魔導士',type:'monster',level:4,atk:1650,def:1600,emoji:'🪄',desc:'神秘的な真珠から力を得る。'},
  {id:'m12',name:'潮騒の海獣',type:'monster',level:3,atk:1500,def:1100,emoji:'🐬',desc:'大波と共に現れる海獣。'},
  {id:'m13',name:'灼熱の巨人',type:'monster',level:6,atk:2400,def:1800,emoji:'🗿',desc:'召喚にはモンスター1体のリリースが必要。'},
  {id:'m14',name:'炎翼の獅子',type:'monster',level:5,atk:2200,def:1600,emoji:'🦁',desc:'召喚にはモンスター1体のリリースが必要。'},
  {id:'m15',name:'深淵のクジラ',type:'monster',level:6,atk:2450,def:1900,emoji:'🐋',desc:'召喚にはモンスター1体のリリースが必要。'},
  {id:'m16',name:'白波の巨兵',type:'monster',level:5,atk:2100,def:2300,emoji:'🌊',desc:'召喚にはモンスター1体のリリースが必要。'},
  {id:'m17',name:'紅蓮王ドラゴン',type:'monster',level:8,atk:3000,def:2500,emoji:'🐲',desc:'召喚にはモンスター2体のリリースが必要。'},
  {id:'m18',name:'蒼天の海竜',type:'monster',level:8,atk:2900,def:2600,emoji:'🐉',desc:'召喚にはモンスター2体のリリースが必要。'},
  {id:'m19',name:'鉄のゴーレム',type:'monster',level:4,atk:1000,def:2200,emoji:'🤖',desc:'守備力に優れた鉄の巨人。'},
  {id:'m20',name:'風読みのフクロウ',type:'monster',level:2,atk:900,def:1400,emoji:'🦉',desc:'風の変化を読み取る。'},
  {id:'m21',name:'星霜の魔導士',type:'monster',subtype:'effect',level:4,atk:1400,def:1200,emoji:'🌠',monsterEffect:{kind:'trigger',code:'draw1'},desc:'召喚に成功した時、カードを1枚ドローする。'},
  {id:'m22',name:'熾火の使者',type:'monster',subtype:'effect',level:3,atk:1200,def:1000,emoji:'🔥',monsterEffect:{kind:'ignition',code:'burn500'},desc:'1ターンに1度、自分のメインフェイズに相手に500ダメージ。'},
  {id:'m23',name:'金剛の守護獣',type:'monster',subtype:'effect',level:4,atk:1500,def:1800,emoji:'🦁',monsterEffect:{kind:'continuous',code:'atk500'},desc:'このカードの攻撃力は500アップする。'},
  {id:'m24',name:'蒼雷の賢者',type:'monster',subtype:'effect',level:4,atk:1600,def:1400,emoji:'⚡',monsterEffect:{kind:'ignition',code:'destroy1'},desc:'1ターンに1度、相手のモンスター1体を破壊できる。'},
  {id:'s01',name:'知恵の巻物',type:'spell',emoji:'📜',effect:'draw2',desc:'カードを2枚ドローする。'},
  {id:'s02',name:'回復の泉',type:'spell',emoji:'💚',effect:'heal1000',desc:'自分のLPを1000回復する。'},
  {id:'s03',name:'雷の一撃',type:'spell',emoji:'⚡',effect:'destroy',desc:'相手のモンスター1体を破壊する。'},
  {id:'s04',name:'勇気の紋章',type:'spell',emoji:'💪',effect:'boost500',desc:'自分の表側モンスター1体の攻撃力を、このターンだけ500上げる。'},
  {id:'s05',name:'火球の呪文',type:'spell',emoji:'☄️',effect:'burn800',desc:'相手に800ダメージを与える。'},
  {id:'s06',name:'閃光の障壁',type:'spell',spellKind:'quick',emoji:'✨',ability:{when:'main',operation:'heal',target:'self',amount:500},desc:'自分のターンは手札から、セット後は次のターン以降にも使える。LP500回復。'},
  {id:'s07',name:'守護の紋章',type:'spell',spellKind:'continuous',emoji:'🪬',ability:{when:'continuous',operation:'boost',target:'ownMonster',amount:300},desc:'指定した自分モンスター1体の攻撃力を300アップ。'},
  {id:'s08',name:'雷刃の剣',type:'spell',spellKind:'equip',emoji:'⚔️',ability:{when:'continuous',operation:'boost',target:'ownMonster',amount:500},desc:'装備モンスターの攻撃力を500アップ。'},
  {id:'s09',name:'星界の祭壇',type:'spell',spellKind:'field',emoji:'🌌',ability:{when:'continuous',operation:'boost',target:'ownMonster',amount:300},desc:'自分フィールドの表側モンスターの攻撃力を300アップ。'},
  {id:'t01',name:'緊急防御',type:'trap',emoji:'🛡️',effect:'negate',desc:'相手の攻撃時に任意発動。その攻撃を無効にする。'},
  {id:'t02',name:'逆襲の落とし穴',type:'trap',emoji:'🕳️',effect:'counterdestroy',desc:'相手の攻撃時に任意発動。攻撃したモンスターを破壊する。'},
  {id:'t03',name:'反撃の炎',type:'trap',emoji:'💥',effect:'counterburn',desc:'相手の攻撃時に任意発動。攻撃を無効にし、相手に700ダメージ。'},
];
export const SPELL_KINDS={normal:'通常魔法',quick:'速攻魔法',continuous:'永続魔法',equip:'装備魔法',field:'フィールド魔法'};
export const spellKind=c=>c?.type==='spell'&&Object.hasOwn(SPELL_KINDS,c.spellKind)?c.spellKind:'normal';
export const persistentSpell=c=>['continuous','equip','field'].includes(spellKind(c));
export const RARITIES={N:'ノーマル',R:'レア',SR:'スーパーレア',UR:'ウルトラレア',SEC:'シークレット'};
const DEFAULT_RARITY={
  m17:'SEC',m18:'SEC',m21:'UR',m24:'UR',m13:'SR',m15:'SR',
  m23:'SR',m10:'SR',s01:'SR',s03:'SR',t02:'SR',
  m14:'R',m16:'R',m22:'R',s02:'R',s04:'R',t03:'R',m08:'R',m19:'R'
};
for(const c of CARDS)c.rarity=DEFAULT_RARITY[c.id]||'N';
export const CARD = Object.fromEntries(CARDS.map(c => [c.id,c]));
const ORIGINAL_CARDS = CARDS.map(c=>({...c}));
export const MONSTER_EFFECTS = {
  continuous: {atk300:'自分の攻撃力＋300（永続）',atk500:'自分の攻撃力＋500（永続）'},
  ignition: {burn500:'相手に500ダメージ',heal500:'自分のLPを500回復',draw1:'1枚ドロー',destroy1:'相手のモンスター1体を破壊',atk500:'自分の攻撃力＋500（ターン終了まで）'},
  trigger: {draw1:'召喚成功時に1枚ドロー',heal500:'召喚成功時にLP500回復',burn500:'召喚成功時に相手に500ダメージ',atk500:'召喚成功時に攻撃力＋500（ターン終了まで）'},
};
export function effectText(c){
  const e=c?.monsterEffect;
  if(!e&&!c?.ability)return '';
  return c.ability?abilityText(c.ability):(MONSTER_EFFECTS[e.kind]?.[e.code]||'');
}
/** Firebase の共有カード帳から更新。既存カードは上書き表示可能、削除時には初期値に戻す。 */
export function replaceCustomCards(cards) {
  const all=ORIGINAL_CARDS.map(c=>({...c}));
  const indexes=new Map(all.map((c,i)=>[c.id,i]));
  for(const c of Object.values(cards||{})){
    if(!isSafeCustomCard(c))continue;
    const copy={...c};
    if(indexes.has(c.id))all[indexes.get(c.id)]=copy;
    else {indexes.set(c.id,all.length);all.push(copy);}
  }
  for(const id of Object.keys(CARD))delete CARD[id];
  CARDS.splice(0,CARDS.length,...all);
  for(const c of CARDS)CARD[c.id]=c;
}
export function isSafeCustomCard(c){
  if(!c || typeof c!=='object'||!/^([a-z][0-9]{2}|u_[0-9a-f]{16,32})$/.test(c.id||''))return false;
  if(typeof c.name!=='string'||!c.name.trim()||c.name.length>32||typeof c.desc!=='string'||c.desc.length>250)return false;
  if(typeof c.owner!=='string'||c.owner.length<2||c.owner.length>150)return false;
  if(c.rarity!==undefined&&!Object.hasOwn(RARITIES,c.rarity))return false;
  if(c.limit!==undefined&&!Object.hasOwn(LIMITS,c.limit))return false;
  if(c.ability!==undefined&&!isValidAbility(c.ability,c.type,c.spellKind||'normal'))return false;
  if(c.type==='spell'&&c.spellKind!==undefined&&!Object.hasOwn(SPELL_KINDS,c.spellKind))return false;
  if(c.fx && (typeof c.fx!=='object'||!['auto','flame','lightning','slash','aqua','shadow','star','heal','none'].includes(c.fx.visual)||!['auto','slash','spark','boom','chime','water','heal','none'].includes(c.fx.sound)))return false;
  if(c.image && (typeof c.image!=='string'||!/^data:image\/(jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(c.image)||c.image.length>90000))return false;
  if(c.type==='monster'){
    if(!Number.isInteger(c.level)||c.level<1||c.level>12||![c.atk,c.def].every(n=>Number.isInteger(n)&&n>=0&&n<=5000))return false;
    if(c.subtype==='effect')return !!(c.ability||MONSTER_EFFECTS[c.monsterEffect?.kind]?.[c.monsterEffect?.code]);
    return c.subtype==='normal';
  }
  if(c.type==='spell')return !!c.ability||['draw2','heal1000','destroy','boost500','burn800'].includes(c.effect);
  if(c.type==='trap')return !!c.ability||['negate','counterdestroy','counterburn'].includes(c.effect);
  return false;
}
export const ORIGINAL_IDS = new Set(ORIGINAL_CARDS.map(c=>c.id));

// 各デッキ40枚・同一カード3枚まで。
const RED_COUNTS = {
  m01:3,m02:3,m03:3,m04:3,m05:3,m06:3,
  m13:2,m14:2,m17:1,m19:1,
  s01:3,s02:2,s03:2,s04:2,s05:1,
  t01:2,t02:2,t03:2,
};
const BLUE_COUNTS = {
  m07:3,m08:3,m09:3,m10:3,m11:3,m12:3,
  m15:2,m16:2,m18:1,m20:1,
  s01:3,s02:2,s03:2,s04:2,s05:1,
  t01:2,t02:2,t03:2,
};
export const PRESETS = {
  red: {name:'紅蓮デッキ',counts:RED_COUNTS},
  blue:{name:'蒼海デッキ',counts:BLUE_COUNTS},
};
export function expandDeck(counts) {
  return Object.entries(counts).flatMap(([id,n])=>Array(Number(n)||0).fill(id));
}
export function validDeck(counts,rules={deckSize:40}) {
  if(!counts||typeof counts!=='object')return false;
  return Object.values(counts).reduce((a,b)=>a+Number(b||0),0)===(rules.deckSize||40) &&
    Object.entries(counts).every(([id,n]) => !!CARD[id] && Number.isInteger(n) && n>=1 && n<=cardLimit(CARD[id]));
}
export function copyPreset(id) { return {...PRESETS[id].counts}; }
export function shuffle(xs) {
  const a=[...xs]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;
}
