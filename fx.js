/** DUEL CRAFT / original audiovisual effects. All sounds are synthesized locally. */
export const VISUAL_CHOICES={auto:'自動（カード種類に合わせる）',flame:'炎',lightning:'雷',slash:'斬撃',aqua:'水・波',shadow:'闇',star:'星・光',heal:'回復',none:'演出なし'};
export const SOUND_CHOICES={auto:'自動（カード種類に合わせる）',slash:'剣の音',spark:'雷の音',boom:'衝撃音',chime:'魔法の音',water:'水の音',heal:'回復音',none:'音なし'};
const defaultSettings={visuals:true,sound:true,bgm:false,volume:55};
export function readFxSettings(){
  try{const data=JSON.parse(localStorage.getItem('duel-fx-settings')||'{}');return {
    visuals:data.visuals!==false,sound:data.sound!==false,bgm:data.bgm===true,
    volume:Number.isFinite(Number(data.volume))?Math.max(0,Math.min(100,Number(data.volume))):55,
  };}catch{return {...defaultSettings};}
}
export function writeFxSettings(value){const v={...defaultSettings,...value};try{localStorage.setItem('duel-fx-settings',JSON.stringify(v));}catch{/* private browsing: keep the game running */}return v;}
let ctx=null;let latestSequence=0;
export function unlockAudio(){
  try{const Type=window.AudioContext||window.webkitAudioContext;if(!Type)return;
    if(!ctx)ctx=new Type();return ctx.state==='suspended'?ctx.resume().catch(()=>{}):Promise.resolve();
  }catch{/* Older browsers can still display effects. */}return Promise.resolve();
}
function selectedPreset(type,card){
  const fx=card?.fx||{};
  const title=String(card?.name||'')+String(card?.emoji||'');
  const inferred=type==='trap'?'shadow':type==='impact'||type==='attack'?'slash':type==='win'?'star':
    /回復|泉|癒/.test(title)||card?.effect==='heal1000'?'heal':
    /雷|⚡/.test(title)?'lightning':/海|水|氷|蒼|しずく|潮|波|🌊|❄️|💧/.test(title)?'aqua':
    /炎|紅|火|焔|🔥|🌋/.test(title)?'flame':'star';
  const visual=VISUAL_CHOICES[fx.visual]&&fx.visual!=='auto'?fx.visual:inferred;
  const sound=SOUND_CHOICES[fx.sound]&&fx.sound!=='auto'?fx.sound:
    (type==='impact'||type==='attack'?'slash':visual==='aqua'?'water':visual==='heal'?'heal':
      visual==='lightning'?'spark':type==='trap'||visual==='flame'?'boom':'chime');
  return {visual,sound};
}
function tone(audio,frequency,start,duration,shape,gain,frequencyEnd){
  const osc=audio.createOscillator(),amp=audio.createGain();
  osc.type=shape||'sine';osc.frequency.setValueAtTime(frequency,start);
  if(frequencyEnd)osc.frequency.exponentialRampToValueAtTime(Math.max(20,frequencyEnd),start+duration);
  amp.gain.setValueAtTime(.0001,start);
  amp.gain.exponentialRampToValueAtTime(Math.max(.00011,gain),start+.015);
  amp.gain.exponentialRampToValueAtTime(.0001,start+duration);
  osc.connect(amp).connect(audio.destination);osc.start(start);osc.stop(start+duration+.018);
}
function noise(audio,start,duration,gain){
  const frames=Math.max(1,Math.ceil(audio.sampleRate*duration));
  const buffer=audio.createBuffer(1,frames,audio.sampleRate),data=buffer.getChannelData(0);
  for(let i=0;i<frames;i++)data[i]=(Math.random()*2-1)*(1-i/frames);
  const source=audio.createBufferSource(),filter=audio.createBiquadFilter(),amp=audio.createGain();
  source.buffer=buffer;filter.type='bandpass';filter.frequency.value=950;filter.Q.value=.6;
  amp.gain.value=gain;source.connect(filter).connect(amp).connect(audio.destination);source.start(start);source.stop(start+duration);
}
function playSynth(preset,volume){
  if(!ctx||ctx.state!=='running'||preset==='none'||volume<=0||document.visibilityState==='hidden')return;
  try{
    const at=ctx.currentTime+.012,v=Math.min(.28,.24*volume/100);
    switch(preset){
      case 'slash':tone(ctx,750,at,.17,'sawtooth',v,125);noise(ctx,at,.12,v*.5);break;
      case 'spark':tone(ctx,910,at,.10,'square',v*.37,420);tone(ctx,630,at+.08,.17,'triangle',v*.6,160);break;
      case 'boom':tone(ctx,185,at,.33,'triangle',v,46);noise(ctx,at,.23,v*.6);break;
      case 'chime':tone(ctx,523,at,.22,'sine',v);tone(ctx,784,at+.105,.27,'sine',v*.7);tone(ctx,1047,at+.21,.29,'sine',v*.4);break;
      case 'water':tone(ctx,405,at,.15,'sine',v*.65,650);tone(ctx,340,at+.13,.23,'sine',v*.5,550);break;
      case 'heal':tone(ctx,396,at,.24,'sine',v*.8,528);tone(ctx,528,at+.15,.28,'sine',v*.75,660);break;
    }
  }catch{/* Rendering should still work if sound is unsupported. */}
}
const palettes={
  flame:{glyph:'🔥',title:'炎の力',color:'#ff9b45'},lightning:{glyph:'⚡',title:'雷鳴',color:'#9edaff'},
  slash:{glyph:'⚔️',title:'アタック！',color:'#ffc28e'},aqua:{glyph:'🌊',title:'水の力',color:'#8fdfff'},
  shadow:{glyph:'✦',title:'罠が発動！',color:'#d7a2ff'},star:{glyph:'✧',title:'カード発動！',color:'#fce3a3'},
  heal:{glyph:'💚',title:'回復',color:'#a4f5bb'},none:{glyph:'',title:'',color:'#ffffff'},
};
let clearTimer=null;
/** A room's lastEvent determines the same animation on both iPhones; audio remains local. */
export function playCue(event,card,settings=readFxSettings()){
  if(!event)return;
  const {visual,sound}=selectedPreset(event.type,card);
  if(settings.sound)playSynth(sound,settings.volume);
  const overlay=document.getElementById('fx-overlay');
  if(!settings.visuals||!overlay||visual==='none')return;
  const preset=palettes[visual]||palettes.star;
  if(clearTimer)clearTimeout(clearTimer);
  const token=++latestSequence;
  overlay.replaceChildren();overlay.className='fx-overlay';
  const backdrop=document.createElement('div');backdrop.className='fx-light';
  const burst=document.createElement('div');burst.className='fx-burst';
  const mark=document.createElement('span');mark.className='fx-glyph';mark.textContent=preset.glyph;
  const title=document.createElement('strong');title.className='fx-title';
  const typeName={summon:'召喚！',attack:'攻撃宣言！',impact:'攻撃！',trap:'罠カード発動！',spell:'魔法カード発動！',effect:'モンスター効果！',win:'デュエル決着！',set:'カードをセット'};
  title.textContent=typeName[event.type]||preset.title;
  const subtitle=document.createElement('span');subtitle.className='fx-subtitle';subtitle.textContent=card?.name||'';
  if(event.damage>0){subtitle.textContent+=(subtitle.textContent?'　':'')+`${event.damage} DAMAGE`;} 
  burst.append(mark,title,subtitle);overlay.append(backdrop,burst);
  overlay.style.setProperty('--fx-color',preset.color);overlay.dataset.style=visual;
  // Reflow starts a fresh CSS transition after every action.
  void overlay.offsetWidth;overlay.classList.add('active');
  clearTimer=setTimeout(()=>{if(token===latestSequence){overlay.className='fx-overlay';overlay.replaceChildren();}},950);
}

// Generated ambient BGM: simple original arpeggio, no copyrighted audio assets.
let bgmTimer=null,bgmStep=0;
function bgmNote(){if(!ctx||ctx.state!=='running'||document.visibilityState==='hidden')return;
 try {const notes=[196,293.66,392,493.88,220,329.63,440,523.25];
   const n=notes[bgmStep++%notes.length];tone(ctx,n,ctx.currentTime+.02,.47,'sine',.006*Math.max(0,Math.min(1,readFxSettings().volume/55)),n*1.005);
 }catch{/* Sound is optional. */}}
export function setBgmPlaying(on){
 if(!on){if(bgmTimer)clearInterval(bgmTimer);bgmTimer=null;return;}
 unlockAudio();if(bgmTimer)return;
 bgmNote();bgmTimer=setInterval(bgmNote,580);
}
