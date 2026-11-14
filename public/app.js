const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initial={heroes:[],stories:[],completed:[],settings:{ollama:'http://localhost:11434',automatic:'http://localhost:7860',model:'llama3.2:latest',tts:'',voice:'af_heart'}};
let state;try{state={...initial,...JSON.parse(localStorage.getItem('storytime')||'{}')}}catch{state=structuredClone(initial)}
const voicePresets={female:{label:'Female · Sarah, warm storyteller',id:'EXAVITQu4vr4xnSDxMaL',device:/zira|heera|female|hazel/i},male:{label:'Male · Adam, deep storyteller',id:'pNInz6obpgDQGcFmaJgB',device:/david|ravi|mark|male/i}};
const narrationStyles={gentle:{label:'Gentle bedtime',speed:0.8},natural:{label:'Natural storyteller',speed:0.95},bright:{label:'Bright adventure',speed:1.08}};
let cloud={}, mediaBusy=false, video=null, narrationRun=0;
let page='home',active=null,busy=false,speaking=false,audio=null,models=[],utterance;
const themes=[['🌲','Enchanted forest','A little wonder among the trees','#dce8d6'],['🚀','Space explorers','Big dreams beyond the stars','#e4dff3'],['🐚','Ocean wonders','Dive into a world of discovery','#d9e9ec'],['🏰','Magical kingdoms','Where kindness is the real magic','#f2e1d5']];
const save=()=>{try{localStorage.setItem('storytime',JSON.stringify(state))}catch{toast('Storage is full. Download your books before adding more covers.')}};
function toast(t){$('#toast').textContent=t;$('#toast').classList.add('show');setTimeout(()=>$('#toast').classList.remove('show'),6000)}
async function api(path,data){const r=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...state.settings,...data})});const result=await r.json();if(!r.ok)throw Error(result.error);return result}
function art(extra=''){return `<div class="storybook-art ${extra}"><div class="stars">✦ · ✧ · ✦</div><div class="moon"></div><div class="hill h1"></div><div class="hill h2"></div><div class="tree t1">♠</div><div class="tree t2">♠</div><div class="cottage"><span>▦</span><span>▦</span><i></i></div><div class="path"></div><div class="little-star">✧</div></div>`}
const routes={home:'/',create:'/create',heroes:'/heroes',library:'/bookshelf',rewards:'/rewards',settings:'/settings'};
function readRoute(){
  const path=location.pathname;
  const story=path.match(/^\/story\/([a-f0-9-]+)$/i);
  active=story?.[1] || null;
  page=active?'reader':Object.keys(routes).find(key=>routes[key]===path)||'home';
}
function navigate(next,id=null){
  stop();
  page=next;
  active=id;
  const path=next==='reader'?'/story/'+id:routes[next];
  if(location.pathname!==path)history.pushState(null,'',path);
  render();
  if(next==='reader') turnPage();
  window.scrollTo(0,0);
}
window.addEventListener('popstate',()=>{stop();readRoute();render();turnPage();});
function turnPage(){document.querySelector('.book-paper')?.classList.add('book-opening')}
function progress(message){
  return '<div class="work-progress" role="status"><span>'+esc(message)+'</span><progress aria-label="'+esc(message)+'"></progress></div>';
}
const sceneJobs = new Map();
const sceneText = chapter => chapter.paragraphs[1] || chapter.paragraphs[0];
for (const story of state.stories) for (const chapter of story.chapters) {
  chapter.paragraphs = chapter.paragraphs.filter(p => !/^choices[\s:\[\](){},]*$/i.test(p.trim()));
}
save();

function scenePrompt(chapter, hero) {
  return 'Depict the characters, actions and setting in this exact moment, without text: ' + sceneText(chapter).slice(0,820) + ' Character details for continuity: ' + chapter.paragraphs[0].slice(0,220) + ' Hero: ' + hero.name + '.';
}

function sceneImage(chapter, hero) {
  const prompt = scenePrompt(chapter, hero);
  const key = JSON.stringify([prompt,state.settings.imageProvider,state.settings.imageModel,state.settings.automatic]);
  if (!sceneJobs.has(key)) sceneJobs.set(key, (async () => {
    const hash = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));
    const url = '/scene-cache/' + Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2,'0')).join('');
    const cache = await window.caches?.open('storytime-scenes-v1').catch(() => null);
    const saved = await cache?.match(url);
    if (saved) return saved.text();
    const {image} = await api('cover',{prompt,scene:true});
    await cache?.put(url,new Response(image)).catch(() => {});
    return image;
  })().finally(() => sceneJobs.delete(key)));
  return sceneJobs.get(key);
}

async function loadScenes() {
  const story = state.stories.find(item => item.id === active);
  if (!story) return;
  for (const figure of document.querySelectorAll('[data-scene]')) {
    if (!figure.isConnected) break;
    const chapter = story.chapters[Number(figure.dataset.scene)];
    const [label,retry] = figure.children;
    const fill = async () => {
      retry.hidden = true;
      label.textContent = 'Illustrating this scene…';
      try {
        const image = new Image();
        image.alt = sceneText(chapter);
        image.src = await sceneImage(chapter, story.hero);
        await image.decode();
        figure.replaceChildren(image);
      } catch {
        label.textContent = 'Scene illustration unavailable.';
        retry.hidden = false;
      }
    };
    retry.onclick = fill;
    await fill();
  }
}

async function makeNarratedVideo(story,context) {
  const canvas = Object.assign(document.createElement('canvas'),{width:960,height:540});
  if (!canvas.captureStream || !window.MediaRecorder) throw Error('This browser cannot record story videos.');
  const ctx = canvas.getContext('2d');
  const settings = {...state.settings};
  const style = narrationStyles[settings.readerStyle] || narrationStyles.gentle;
  const scenes = [];
  for (const chapter of story.chapters) {
    const image = new Image();
    image.src = await sceneImage(chapter, story.hero);
    await image.decode();
    const narration = [];
    for (const text of chapter.paragraphs) {
      const response = await fetch('/api/speech',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...settings,text,elevenVoice:voicePresets[settings.readerVoice]?.id || settings.elevenVoice,speed:style.speed})
      });
      if (!response.ok) throw Error('Video narration requires ElevenLabs or a configured Kokoro service.');
      narration.push(await context.decodeAudioData(await response.arrayBuffer()));
    }
    scenes.push({image,narration});
  }
  let motion;
  let motionUrl;
  if (cloud.media && settings.videoProvider !== 'local') {
    try {
      const response = await fetch('/api/video',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({prompt:scenePrompt(story.chapters[0],story.hero),videoModel:settings.videoModel})});
      if (!response.ok) throw Error('Cloud motion unavailable');
      motionUrl = URL.createObjectURL(await response.blob());
      motion = Object.assign(document.createElement('video'),{src:motionUrl,muted:true,loop:true});
      await motion.play();
    } catch {
      motion = null;
      toast('Cloud motion unavailable. Using animated illustrations with narration.');
    }
  }
  const stream = canvas.captureStream(24);
  const output = context.createMediaStreamDestination();
  for (const track of output.stream.getAudioTracks()) stream.addTrack(track);
  try {
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    return await new Promise((resolve,reject) => {
      let frameTimer;
      recorder.ondataavailable = e => {if (e.data.size) chunks.push(e.data);};
      recorder.onerror = () => {clearTimeout(frameTimer);reject(Error('Video recording failed.'));};
      recorder.onstop = () => resolve(new Blob(chunks,{type:recorder.mimeType}));
      recorder.start();
      const start = context.currentTime + .12;
      let duration = 0;
      for (const scene of scenes) {
        scene.start = duration;
        for (const buffer of scene.narration) {
          const source = context.createBufferSource();
          source.buffer = buffer;
          source.connect(output);
          source.start(start + duration);
          duration += buffer.duration;
        }
        scene.duration = duration - scene.start;
      }
      const status = document.querySelector('#video-progress');
      if (status) status.innerHTML = progress('Recording narrated video · about ' + Math.ceil(duration) + ' seconds…');
      function frame() {
        const elapsed = Math.max(0,context.currentTime-start);
        const scene = scenes.findLast(item => item.start <= elapsed);
        const clip = scene === scenes[0] && motion;
        const art = clip || scene.image;
        const width = clip ? art.videoWidth : art.width;
        const height = clip ? art.videoHeight : art.height;
        const fraction = Math.min(1,(elapsed-scene.start)/scene.duration);
        const scale = Math.max(960/width,540/height)*(1+fraction*.12);
        ctx.drawImage(art,(960-width*scale)/2,(540-height*scale)/2,width*scale,height*scale);
        if (elapsed < duration + .15) frameTimer = setTimeout(frame,1000/24);
        else recorder.stop();
      }
      frame();
    });
  } finally {
    stream.getTracks().forEach(track => track.stop());
    motion?.pause();
    if (motionUrl) URL.revokeObjectURL(motionUrl);
  }
}
function markNarration(index,word=-1){
  document.querySelectorAll('.reading-active').forEach(el=>el.classList.remove('reading-active'));
  document.querySelectorAll('.reading-word').forEach(el=>el.classList.remove('reading-word'));
  const paragraph=document.querySelector('[data-read-index="'+index+'"]');
  paragraph?.classList.add('reading-active');
  if(word>=0)paragraph?.querySelectorAll('[data-word]')[word]?.classList.add('reading-word');
  return paragraph;
}
async function generateVideo(){
  const savedStory=state.stories.find(item=>item.id===active);
  if(!savedStory||mediaBusy)return;
  const story=structuredClone(savedStory);
  stop();
  mediaBusy=true;
  render();
  let context;
  try{
    context = new AudioContext();
    await context.resume();
    const result = await makeNarratedVideo(story,context);
    if(savedStory.chapters.length!==story.chapters.length) throw Error('The story continued during recording. Generate a new video for the latest ending.');
    if(video)URL.revokeObjectURL(video.url);
    video={id:story.id,url:URL.createObjectURL(result),type:result.type};
  }catch(error){toast(error.message);}
  finally{await context?.close();mediaBusy=false;render();}
}
function render(){const done=state.completed.length;$('#app').innerHTML=`<aside><a class="brand" href="#" data-page="home"><span class="brand-icon">☾</span> StoryTime<span class="brand-dot">✦</span></a><p class="aside-caption">A LITTLE MAGIC, EVERY NIGHT</p><nav>${[['home','⌂','Our story nook'],['create','✧','Create a story'],['heroes','♡','My Little Heroes'],['library','▤','Our bookshelf'],['rewards','☆','Reading Rewards']].map(([id,icon,label])=>`<button data-page="${id}" class="${page===id?'selected':''}"><span>${icon}</span>${label}${id==='heroes'?'<small>NEW</small>':''}</button>`).join('')}</nav><div class="aside-bottom"><div class="bedtime"><span>☾</span><b>Made for little dreamers</b><p>And the grown-ups who love them.</p></div><button data-page="settings" class="settings">⚙ &nbsp; AI settings</button><div class="parent"><span>☀</span><div><b>Our family</b><small>A world of stories awaits</small></div></div></div></aside><main><header><span>Little stories. <i>Big dreams.</i></span><div><span class="local-dot"></span> StoryTime <button data-page="heroes" class="avatar">☀</button></div></header><div class="content ${page==='reader'?'book-paper':''}">${page==='home'?home(done):page==='heroes'?heroes():page==='create'?create():page==='library'?library():page==='reader'?reader():page==='rewards'?rewards():settings()}</div><footer>Made with a little wonder & a whole lot of love <span>✦</span> StoryTime</footer></main>`;bind();if(page==='reader')loadScenes();}
function heading(k,t,p){return `<div class="page-heading"><div class="eyebrow">${k}</div><h1>${t}</h1><p>${p}</p></div>`}
function home(done){return `<section class="welcome"><div class="welcome-copy"><div class="eyebrow">✦ &nbsp; WELCOME TO YOUR STORY NOOK</div><h1>A little story.<br>A little closer.<br><em>A little more magic.</em></h1><p>Turn your little one's big imagination into stories<br class="desktop"> you'll love sharing, night after night.</p><button class="primary" data-page="create">✧ &nbsp; Let's make a story <span>↗</span></button><div class="handnote">Imagined by them. Treasured by you. <span>⤴</span></div></div><div class="hero-art">${art()}<div class="art-label">Once upon a bedtime… <span>☾</span></div><div class="floating-star">✦</div></div></section><section class="hero-banner"><span class="banner-icon">🧸</span><div><span class="eyebrow">THE HERO OF EVERY ADVENTURE</span><h3>Big adventures start with little heroes.</h3><p>Save their name, favorite color, and animal. Let their story begin.</p></div><button class="outline" data-page="heroes">Meet My Little Heroes <span>→</span></button></section><section class="section-top"><div><div class="eyebrow">WHERE SHALL WE WANDER?</div><h2>A world of wonder awaits</h2></div><span class="subtle">One imagination. Endless possibilities.</span></section><div class="theme-grid">${themes.map(([icon,title,desc,color],i)=>`<button class="theme-card" data-theme="${i}"><div class="theme-art" style="--tint:${color}"><span>${icon}</span><i>✦</i></div><h3>${title}</h3><p>${desc}</p><span class="theme-arrow">↗</span></button>`).join('')}</div><section class="bottom-grid"><div class="adventure-callout"><span>🧭</span><div><div class="eyebrow">THEY CHOOSE. THE MAGIC FOLLOWS.</div><h3>A story with their own little twist</h3><p>Take the winding path or follow the fireflies?<br>Every choice opens a new adventure.</p><button class="text-button" id="adventure-start">Try an interactive adventure →</button></div></div><div class="reward-callout"><span>🌟</span><div><div class="eyebrow">LITTLE PAGES. BIG ACHIEVEMENTS.</div><h3>Every story is a little milestone</h3><p>${done} stories finished. So much wonder ahead.</p><button class="text-button" data-page="rewards">See reading rewards →</button></div></div></section>`}
function heroes(){return heading('THEIR IMAGINATION STARTS HERE','My Little Heroes','A familiar friend for every brand-new adventure.')+`<div class="heroes-grid">${state.heroes.map(h=>`<article class="hero-card"><div class="hero-avatar" style="background:${esc(h.color)}33">${animalEmoji(h.animal)}</div><h2>${esc(h.name)}</h2><p>Loves ${esc(h.color)} & ${esc(h.animal)}</p><div class="actions"><button class="primary" data-use="${h.id}">Tell my story ✧</button><button class="icon-button" data-edit="${h.id}" aria-label="Edit ${esc(h.name)}">✎</button><button class="icon-button" data-delete="${h.id}" aria-label="Delete ${esc(h.name)}">×</button></div></article>`).join('')}<button class="add-hero" id="add-hero"><span>＋</span><h3>A new little hero</h3><p>Make them the heart of the story</p></button></div>`}
function animalEmoji(a){return /cat/i.test(a)?'🐱':/rabbit|bunny/i.test(a)?'🐰':/bear/i.test(a)?'🐻':/fox/i.test(a)?'🦊':/dog/i.test(a)?'🐶':'🦁'}
function create(){return heading('A NEW CHAPTER OF WONDER','Let’s make a little magic','Personal stories, lovingly imagined by your local AI.')+`<form id="create-form" class="form-card"><div class="form-grid"><label>Who is our little hero?<select name="hero" required><option value="">Choose a saved hero</option>${state.heroes.map(h=>`<option value="${h.id}" ${sessionStorage.hero===h.id?'selected':''}>${esc(h.name)}</option>`).join('')}</select></label><button type="button" class="outline" id="add-hero">＋ Create a hero</button></div><label>Where will the story take us?<div class="theme-options">${themes.map(([icon,t],i)=>`<label class="radio-card"><input type="radio" name="theme" value="${esc(t)}" ${Number(sessionStorage.theme||0)===i?'checked':''}>${icon} ${t}</label>`).join('')}</div></label><label>One little wish for the story <span class="subtle">(optional)</span><input name="wish" maxlength="300" placeholder="A shy dragon learning to make friends…"></label><label class="check-card"><input name="adventure" type="checkbox" ${sessionStorage.adventure==='yes'?'checked':''}><div><b>Choose your own adventure</b><p>Three chapters, little choices, and an ending they help create.</p></div><span>🧭</span></label><label class="check-line"><input name="cover" type="checkbox" checked> Illustrate the cover with Automatic1111</label><button class="primary" type="submit" ${busy?'disabled':''}>${busy?'✧ Imagining your story…':'✧ Create our story'}</button><p class="form-note">${cloud.openrouter?'OpenRouter writes your story, with Ollama as a fallback.':'Stories are generated locally with '+esc(state.settings.model)+'.'} A grown-up can preview each story before reading together.</p><div id="generation-status" role="status"></div></form>`}
function library(){return heading('KEEP THE MAGIC CLOSE','Our bookshelf','Little adventures to return to, again and again.')+(!state.stories.length?`<div class="empty">📚<h2>Your next favorite story is waiting</h2><p>Create your first story and it will find a home right here.</p><button class="primary" data-page="create">Make our first story ✧</button></div>`:`<div class="books-grid">${state.stories.map(s=>`<button class="book" data-story="${s.id}">${s.cover?`<img alt="Cover of ${esc(s.title)}" src="${s.cover}">`:art('mini')}<span class="eyebrow">${esc(s.theme)} ${s.adventure?'· INTERACTIVE':''}</span><h3>${esc(s.title)}</h3><p>Starring ${esc(s.hero.name)} · ${s.chapters.length} chapter${s.chapters.length>1?'s':''}</p><span class="text-button">${s.finished?'Read again':'Continue the adventure'} →</span></button>`).join('')}</div>`)}
function reader(){const s=state.stories.find(s=>s.id===active);if(!s)return library();const last=s.chapters.at(-1);let readIndex=0;return `<button class="text-button" data-page="library">← Back to our bookshelf</button><article class="reader"><div class="reader-cover">${s.cover?`<img src="${s.cover}" alt="${esc(s.title)} cover">`:art()}<div><div class="eyebrow">A STORY FOR ${esc(s.hero.name.toUpperCase())}</div><h1>${esc(s.title)}</h1><p>${esc(s.theme)} · ${s.adventure?'An interactive adventure':'A bedtime story'}</p><div class="reader-actions"><button class="primary" id="listen">${speaking?'■ Stop narration':'♫ Listen to Story'}</button><button class="outline" id="pdf">↓ Download as PDF</button></div><label class="voice-select">Reading voice <select id="voice-select"><option value="">Provider default</option>${Object.entries(voicePresets).map(([id,v])=>`<option value="${id}" ${state.settings.readerVoice===id?'selected':''}>${v.label}</option>`).join('')}<optgroup label="Installed device voices">${(window.speechSynthesis?.getVoices()||[]).filter(v=>v.lang.startsWith('en')).map(v=>`<option value="${esc(v.name)}" ${state.settings.readerVoice===v.name?'selected':''}>${esc(v.name)}</option>`).join('')}</optgroup></select></label><label class="voice-select">Narration style <select id="voice-style">${Object.entries(narrationStyles).map(([id,v])=>`<option value="${id}" ${(state.settings.readerStyle||'gentle')===id?'selected':''}>${v.label}</option>`).join('')}</select></label>${!s.cover?'<button class="text-button" id="cover-retry">✧ Illustrate this cover</button>':''}<small>${cloud.elevenlabs?'ElevenLabs narration · device fallback':state.settings.tts?'Local AI narration':'Device narration · gentle pace'}</small></div></div><div id="reader-progress"></div>${`<div class="reader-actions"><button class="outline" id="make-video" ${mediaBusy?'disabled':''}>Generate story video</button></div>${mediaBusy?'<div id="video-progress">'+progress('Preparing artwork and narration…')+'</div>':''}${video?.id===s.id?`<video class="story-video" controls playsinline src="${video.url}"></video><a href="${video.url}" download="story-video.${video.type.includes('mp4')?'mp4':'webm'}">Download video</a>`:''}`}<div class="story-text">${s.chapters.map((c,i)=>`<section><div class="chapter-label">${s.adventure?`CHAPTER ${i+1}`:'ONCE UPON A TIME'}</div>${c.paragraphs.map((p,j)=>`${(j===1||c.paragraphs.length===1)?`<figure class="scene-figure" data-scene="${i}"><figcaption>Illustrating this scene…</figcaption><button class="outline" hidden>Retry illustration</button></figure>`:''}<p data-read-index="${readIndex++}">${p.split(/(\s+)/).map(w=>/^\s+$/.test(w)?w:`<span data-word>${esc(w)}</span>`).join('')}</p>`).join('')}${s.path[i]?`<div class="chosen-path">✧ ${esc(s.path[i])}</div>`:''}</section>`).join('')}<div id="story-end">${s.finished?`<div class="the-end">✦<h2>Sweet dreams, little hero.</h2><button id="finish" class="primary">${state.completed.includes(s.id)?'✓ Story finished · reward earned':'☆ We finished this story!'}</button></div>`:`<div class="choice-box"><span class="eyebrow">WHAT SHOULD ${esc(s.hero.name.toUpperCase())} DO?</span><h2>A little choice. A new adventure.</h2>${last.choices.map((c,i)=>`<button class="outline choice" data-choice="${i}" ${busy?'disabled':''}>${esc(c)} <span>→</span></button>`).join('')}${busy?progress('Writing the next chapter…'):''}</div>`}</div></div></article>`}
const badges=[['🌱','First chapter','Finish your first story',1],['⭐','Bedtime dreamer','Finish 5 different stories',5],['👑','Storybook star','Finish 10 different stories',10],['🌈','Wonder wanderer','Read 3 different themes',3]];
function rewards(){const completed=state.stories.filter(s=>state.completed.includes(s.id)), count=completed.length,themeCount=new Set(completed.map(s=>s.theme)).size;return heading('EVERY PAGE IS A LITTLE VICTORY','Reading Rewards','A growing collection of moments to be proud of.')+`<div class="stats"><div><strong>${count}</strong><span>Stories finished</span></div><div><strong>${themeCount}</strong><span>Worlds explored</span></div><div><strong>${badges.filter((b,i)=>(i===3?themeCount:count)>=b[3]).length}</strong><span>Stickers collected</span></div></div><h2>Your little wall of wonder</h2><div class="badge-grid">${badges.map(([icon,title,desc,target],i)=>{const n=i===3?themeCount:count,unlocked=n>=target;return `<article class="badge ${unlocked?'earned':''}"><span>${icon}</span><small>${unlocked?'✦ UNLOCKED':'STILL GROWING'}</small><h3>${title}</h3><p>${desc}</p><progress value="${Math.min(n,target)}" max="${target}"></progress><small>${Math.min(n,target)} / ${target}</small></article>`}).join('')}</div>`}
const providerFields=[["textProvider","Story text",[["auto","OpenRouter → Ollama"],["ollama","Ollama only"]]],["openrouterModel","OpenRouter model"],["speechProvider","Speech",[["auto","ElevenLabs → Kokoro → device"],["kokoro","Kokoro → device"],["device","Device only"]]],["speechModel","ElevenLabs model"],["elevenVoice","Default ElevenLabs voice ID"],["imageProvider","Images",[["auto","Hugging Face → Automatic1111"],["automatic","Automatic1111 only"]]],["imageModel","Cloud image model"],["videoProvider","Video",[["auto","Hugging Face → narrated illustrated video"],["local","Narrated illustrated video only"]]],["videoModel","Cloud video model"]];
function providerSettings(){return "<fieldset><legend>Providers and models</legend>"+providerFields.map(([name,label,options])=>"<label>"+label+(options?"<select name=\""+name+"\">"+options.map(([id,text])=>"<option value=\""+id+"\" "+((state.settings[name]||"auto")===id?"selected":"")+">"+text+"</option>").join("")+"</select>":"<input name=\""+name+"\" value=\""+esc(state.settings[name]||"")+"\" placeholder=\""+esc(cloud.defaults?.[name]||"Server default")+"\">")+"</label>").join("")+"<p class=\"form-note\">BYOK keys are loaded server-side from .env.local.</p></fieldset>"}
function settings(){return heading('YOUR COZY CREATIVE CORNER','AI settings','Choose cloud or local defaults for each generation category.')+`<form id="settings-form" class="form-card">${providerSettings()}<label>Ollama address<input name="ollama" type="url" value="${esc(state.settings.ollama)}" required></label><label>Ollama fallback model<select name="model">${[...new Set([state.settings.model,...models])].map(m=>`<option ${m===state.settings.model?'selected':''}>${esc(m)}</option>`).join('')}</select></label><button type="button" id="refresh-models" class="outline">↻ Find local models</button><label>Automatic1111 address<input name="automatic" type="url" value="${esc(state.settings.automatic)}" required></label><p class="form-note">Start the WebUI with <code>--api</code> to enable cover illustration. The currently loaded checkpoint is used.</p><label>Local AI speech address <span class="subtle">(optional)</span><input name="tts" type="url" value="${esc(state.settings.tts)}" placeholder="http://localhost:8880"></label><label>AI speech voice<input name="voice" value="${esc(state.settings.voice)}" required></label><p class="form-note">Supports a local Kokoro-compatible /v1/audio/speech service. Leave the address empty to use installed device voices. A specific grandparent-like voice depends on the voice models you install.</p><button class="primary">Save settings</button><p class="form-note">Only localhost addresses are supported. Heroes, stories, and rewards are saved in this browser on this device.</p></form>`}
function heroDialog(id){const h=state.heroes.find(h=>h.id===id)||{name:'',color:'Lavender',animal:''};$('#modal').innerHTML=`<form id="hero-form"><button type="button" class="close" aria-label="Close">×</button><div class="eyebrow">A SMALL HERO. A BIG IMAGINATION.</div><h2>${id?'Edit your little hero':'Meet your little hero'}</h2><label>Their name<input name="name" maxlength="40" value="${esc(h.name)}" placeholder="e.g. Oliver" required></label><label>Favorite color<select name="color">${['Lavender','Blue','Green','Pink','Yellow','Orange','Red','Purple'].map(c=>`<option ${c===h.color?'selected':''}>${c}</option>`).join('')}</select></label><label>Favorite animal<input name="animal" maxlength="40" value="${esc(h.animal)}" placeholder="e.g. a curious fox" required></label><button class="primary">Save my little hero ♡</button></form>`;$('#modal').showModal();$('.close').onclick=()=>$('#modal').close();$('#hero-form').onsubmit=e=>{e.preventDefault();const values=Object.fromEntries(new FormData(e.target));if(!values.name.trim()||!values.animal.trim())return;const hero={...values,id:id||crypto.randomUUID()};if(id)state.heroes=state.heroes.map(x=>x.id===id?hero:x);else state.heroes.push(hero);sessionStorage.hero=hero.id;save();$('#modal').close();render()}}
function stop(){narrationRun++;speaking=false;markNarration(-1);$("#reader-progress")?.replaceChildren();window.speechSynthesis?.cancel();audio?.pause();if(audio?.src)URL.revokeObjectURL(audio.src);audio=null;speaking=false;const b=$('#listen');if(b)b.textContent='♫ Listen to Story'}
async function listen(){
  if(speaking){stop();return;}
  const story=state.stories.find(item=>item.id===active);
  if(!story)return;
  const paragraphs=story.chapters.flatMap(chapter=>chapter.paragraphs);
  const selection=state.settings.readerVoice;
  const preset=voicePresets[selection];
  const style=narrationStyles[state.settings.readerStyle]||narrationStyles.gentle;
  const voices=window.speechSynthesis?.getVoices()||[];
  const device=voices.find(voice=>voice.name===selection)||voices.find(voice=>voice.lang.startsWith('en')&&preset?.device.test(voice.name));
  let remote=!voices.some(voice=>voice.name===selection)&&state.settings.speechProvider!=='device'&&(cloud.elevenlabs||state.settings.tts);
  const run=++narrationRun;
  speaking=true;
  $('#listen').textContent='■ Stop narration';
  function next(index){
    if(run!==narrationRun)return;
    if(index>=paragraphs.length){stop();return;}
    play(index).catch(error=>{if(run===narrationRun){stop();toast(error.message);}});
  }
  async function play(index){
    const text=paragraphs[index];
    const node=markNarration(index);
    node?.scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
    if(remote){
      try{
        $('#reader-progress').innerHTML=progress('Preparing narration…');
        const response=await fetch('/api/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...state.settings,text,elevenVoice:preset?.id||state.settings.elevenVoice,speed:style.speed})});
        if(!response.ok)throw Error('Cloud narration unavailable.');
        const blob=await response.blob();
        if(run!==narrationRun)return;
        $('#reader-progress')?.replaceChildren();
        audio=new Audio(URL.createObjectURL(blob));
        const clip=audio;
        clip.ontimeupdate=()=>{if(run===narrationRun&&clip.duration)markNarration(index,Math.min(text.trim().split(/\s+/).length-1,Math.floor(clip.currentTime/clip.duration*text.trim().split(/\s+/).length)));};
        clip.onended=()=>{URL.revokeObjectURL(clip.src);audio=null;next(index+1);};
        await clip.play();
        return;
      }catch{
        if(run!==narrationRun)return;
        if(audio?.src)URL.revokeObjectURL(audio.src);
        audio=null;remote=false;
        $('#reader-progress')?.replaceChildren();
        toast('Using a device voice.');
      }
    }
    if(!window.speechSynthesis)throw Error('Device narration unavailable.');
    utterance=new SpeechSynthesisUtterance(text);
    if(device)utterance.voice=device;
    utterance.rate=style.speed;
    utterance.onboundary=event=>{if(run===narrationRun)markNarration(index,text.slice(0,event.charIndex).trim().split(/\s+/).filter(Boolean).length);};
    utterance.onend=()=>next(index+1);
    utterance.onerror=event=>{if(run===narrationRun&&!['canceled','interrupted'].includes(event.error)){stop();toast('Device narration stopped.');}};
    speechSynthesis.speak(utterance);
  }
  next(0);
}
async function cover(s){const pane=$('#reader-progress');if(pane)pane.innerHTML=progress('Illustrating your cover…');try{const result=await api('cover',{prompt:s.chapters[0].coverPrompt||s.title});s.cover=result.image;save();if(page==='reader'&&active===s.id&&!speaking)render()}catch(e){toast('Your story is saved. Cover unavailable: '+e.message)}finally{pane?.replaceChildren()}}
async function generate(form){if(busy)return;busy=true;const submitButton=$("#create-form button[type=submit]");if(submitButton){submitButton.disabled=true;submitButton.textContent="✧ Imagining your story…"}$("#generation-status").innerHTML=progress("Writing your story…");try{const hero=state.heroes.find(h=>h.id===form.hero),theme=form.theme;const chapter=await api('story',{hero,textProvider:state.settings.textProvider||'auto',theme:theme+(form.wish?'. '+form.wish:''),adventure:!!form.adventure,history:[]});const s={id:crypto.randomUUID(),title:chapter.title,hero:structuredClone(hero),theme,adventure:!!form.adventure,chapters:[chapter],path:[],finished:!chapter.choices.length,created:Date.now()};state.stories.unshift(s);save();navigate('reader',s.id);if(form.cover){toast('Your story is ready. Illustrating the cover…');queueMicrotask(()=>cover(s))}}catch(e){toast(e.message)}finally{busy=false;if(submitButton?.isConnected){submitButton.disabled=false;submitButton.textContent='✧ Create our story';const status=document.getElementById('generation-status');if(status)status.textContent=''}else render()}}
async function choose(index){if(busy)return;const s=state.stories.find(s=>s.id===active),choice=s.chapters.at(-1).choices[index];busy=true;stop();render();try{const c=await api('story',{hero:s.hero,theme:s.theme,textProvider:state.settings.textProvider||'auto',adventure:true,history:s.chapters.map((c,i)=>({...c,chosen:s.path[i]})),choice});s.path.push(choice);s.chapters.push(c);s.finished=!c.choices.length;if(video?.id===s.id){URL.revokeObjectURL(video.url);video=null}save()}catch(e){toast(e.message)}finally{busy=false;render();turnPage();$('#story-end')?.scrollIntoView({behavior:'smooth',block:'center'})}}
function pdf(){const s=state.stories.find(s=>s.id===active);const {jsPDF}=window.jspdf,doc=new jsPDF({unit:'mm',format:'a5'}),w=148,h=210;const bg=()=>{doc.setFillColor('#fbf6ea');doc.rect(0,0,w,h,'F');doc.setDrawColor('#d7bb89');doc.rect(8,8,w-16,h-16)};bg();doc.setTextColor('#344e47');doc.setFont('times','bold');doc.setFontSize(23);const title=doc.splitTextToSize(s.title,115);doc.text(title,w/2,24,{align:'center'});const y=30+title.length*8;if(s.cover){doc.addImage(s.cover,s.cover.startsWith('data:image/jpeg')?'JPEG':s.cover.startsWith('data:image/webp')?'WEBP':'PNG',24,y,100,125)}else{doc.setFillColor('#dce6db');doc.roundedRect(24,y,100,112,5,5,'F');doc.setFontSize(60);doc.text('*',w/2,y+65,{align:'center'})}doc.setFontSize(12);doc.text(`A little adventure for ${s.hero.name}`,w/2,185,{align:'center'});let pageNum=0;const newPage=()=>{doc.addPage();bg();pageNum++;doc.setFont('times','normal');doc.setFontSize(9);doc.setTextColor('#99866b');doc.text('StoryTime',w/2,199,{align:'center'});doc.text(String(pageNum),132,199);doc.setTextColor('#344e47');return 28};let cy=newPage();s.chapters.forEach((c,index)=>{if(index){cy=newPage()}doc.setFont('times','bold');doc.setFontSize(14);doc.text(s.adventure?`Chapter ${index+1}`:'Once upon a time',18,cy);cy+=13;doc.setFont('times','normal');doc.setFontSize(13);c.paragraphs.forEach(p=>{const lines=doc.splitTextToSize(p,110);for(const line of lines){if(cy>183){cy=newPage();doc.setFontSize(13)}doc.text(line,19,cy);cy+=6.6}cy+=6});if(s.path[index]){doc.setFontSize(10);for(const line of doc.splitTextToSize('Our choice: '+s.path[index],110)){if(cy>183){cy=newPage();doc.setFontSize(10)}doc.text(line,19,cy);cy+=6}}});if(cy>166)cy=newPage();doc.setFont('times','italic');doc.setFontSize(16);doc.text(s.finished?'Sweet dreams, little hero.':'To be continued...',w/2,cy+10,{align:'center'});doc.save(s.title.replace(/[^a-z0-9 -]/gi,'').slice(0,70)+'.pdf')}
function bind(){if($('#voice-style'))$('#voice-style').onchange=e=>{stop();state.settings.readerStyle=e.target.value;save()};if($('#make-video'))$('#make-video').onclick=generateVideo;document.querySelectorAll('[data-page]').forEach(b=>b.onclick=e=>{e.preventDefault();navigate(b.dataset.page)});document.querySelectorAll('[data-theme]').forEach(b=>b.onclick=()=>{sessionStorage.theme=b.dataset.theme;sessionStorage.adventure='no';navigate('create')});document.querySelectorAll('[data-use]').forEach(b=>b.onclick=()=>{sessionStorage.hero=b.dataset.use;page='create';render()});document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>heroDialog(b.dataset.edit));document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>{if(confirm('Remove this hero? Their saved stories will stay on the bookshelf.')){state.heroes=state.heroes.filter(h=>h.id!==b.dataset.delete);save();render()}});document.querySelectorAll('[data-story]').forEach(b=>b.onclick=()=>{navigate('reader',b.dataset.story)});document.querySelectorAll('[data-choice]').forEach(b=>b.onclick=()=>choose(Number(b.dataset.choice)));if($('#add-hero'))$('#add-hero').onclick=()=>heroDialog();if($('#adventure-start'))$('#adventure-start').onclick=()=>{sessionStorage.adventure='yes';page='create';render()};if($('#create-form'))$('#create-form').onsubmit=e=>{e.preventDefault();generate(Object.fromEntries(new FormData(e.target)))};if($('#settings-form'))$('#settings-form').onsubmit=e=>{e.preventDefault();state.settings={...state.settings,...Object.fromEntries(new FormData(e.target))};save();toast('Your local AI settings are saved.')};if($('#refresh-models'))$('#refresh-models').onclick=async()=>{const b=$('#refresh-models');b.disabled=true;try{const result=await api('models',{ollama:$('#settings-form [name=ollama]').value});models=result.models;state.settings.ollama=$('#settings-form [name=ollama]').value;render();toast(`Found ${models.length} local models.`)}catch(e){toast(e.message);b.disabled=false}};if($('#listen'))$('#listen').onclick=listen;if($('#voice-select'))$('#voice-select').onchange=e=>{state.settings.readerVoice=e.target.value;save();stop()};if($('#pdf'))$('#pdf').onclick=pdf;if($('#cover-retry'))$('#cover-retry').onclick=async()=>{const b=$('#cover-retry');b.disabled=true;b.textContent='✧ Illustrating…';await cover(state.stories.find(s=>s.id===active));if(b.isConnected){b.disabled=false;b.textContent='✧ Illustrate this cover'}};if($('#finish'))$('#finish').onclick=()=>{if(!state.completed.includes(active)){state.completed.push(active);save();toast('A little milestone! Your reading rewards have been updated.');render()}}}
readRoute();render();turnPage();fetch('/api/providers').then(r=>r.json()).then(data=>{cloud=data;if(!busy&&!speaking&&page!=='reader')render()}).catch(()=>{});api('models',{}).then(r=>{models=r.models;if(!models.includes(state.settings.model)&&models.length){state.settings.model=models[0];save()}}).catch(()=>{});window.addEventListener('beforeunload',stop);
