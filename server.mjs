import express from 'express';
import {providers, cloudStory, cloudSpeech, cloudMedia} from './providers.mjs';
const app = express();
const storyGpuLayers = process.env.STORYTIME_OLLAMA_GPU_LAYERS;
const chapterFormat = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: {type: 'string'},
    paragraphs: {type: 'array', minItems: 2, maxItems: 5, items: {type: 'string'}},
    choices: {type: 'array', maxItems: 3, items: {type: 'string'}},
    coverPrompt: {type: 'string'}
  },
  required: ['title', 'paragraphs', 'choices', 'coverPrompt']
};
app.use(express.json({limit:'2mb'}));
// Guard authenticated local routes against requests from unrelated web origins.
app.use('/api', (req, res, next) => {
  const origin = req.get('origin');
  if (origin && origin !== `http://${req.get('host')}`) return res.sendStatus(403);
  if (req.method === 'POST' && !req.is('application/json')) return res.sendStatus(415);
  next();
});
app.get('/api/providers', (req, res) => res.json({...providers, defaults:{openrouterModel:process.env.OPENROUTER_MODEL||'openrouter/free',speechModel:process.env.ELEVENLABS_MODEL||'eleven_flash_v2_5',imageModel:process.env.HF_IMAGE_MODEL||'black-forest-labs/FLUX.1-schnell',videoModel:process.env.HF_VIDEO_MODEL||'Wan-AI/Wan2.2-TI2V-5B'}}));
app.use(express.static('public'));
app.use('/vendor',express.static('node_modules/jspdf/dist'));
function localURL(value, fallback) {
  const u=new URL(value||fallback);
  if(!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||!['http:','https:'].includes(u.protocol)) throw Error('Use a localhost service URL.');
  return u.origin;
}
async function request(url, body, timeout=180000) {
 const r=await fetch(url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(timeout)});
 if(!r.ok) throw Error(`Local service returned ${r.status}. Check that its API is enabled.`);
 return r;
}
app.post('/api/models',async(req,res,next)=>{try{const r=await request(localURL(req.body.ollama,'http://localhost:11434')+'/api/tags'); const data=await r.json();res.json({models:data.models.filter(m=>!m.remote_host&&!m.name.includes(':cloud')&&(!m.capabilities||m.capabilities.includes('completion'))).map(m=>m.name)});}catch(e){next(e)}});
function storyLocale(value) {
  const code = String(value || 'en');
  return /^[a-z]{2,3}$/.test(code) ? code : 'en';
}
app.post('/api/story',async(req,res,next)=>{try{
 const {hero,theme,language,adventure,history=[],choice,model}=req.body;
 if(!hero?.name||!hero?.color||!hero?.animal) throw Error('Choose a hero first.');
 if(history.length>4) throw Error('This adventure has reached its ending.');
 const ending=!adventure||history.length>=2;
 const locale=storyLocale(language);
 const prompt=`Write the title, prose and all choices in the native script of ${new Intl.DisplayNames(['en'],{type:'language'}).of(locale)}. Keep coverPrompt in English for the illustration model. If the theme is Surprise me, pick a comforting setting. Write a gentle bedtime story for children ages 4–8. No violence, frightening content, or adult subjects. Main hero: ${JSON.stringify(hero)}. Include their favorite color and animal naturally. Theme: ${String(theme).slice(0,100)}. ${adventure?'This is an interactive adventure.':'Write a complete story with a comforting ending.'} ${history.length?`Previous story chapters and choices: ${JSON.stringify(history).slice(0,18000)}. The child chose: ${String(choice).slice(0,200)}. Continue directly and make that choice change events.`:''} ${ending?'Finish with a warm, satisfying ending. Return no choices.':'End at a decision and give exactly 2 or 3 short, distinct child-friendly choices.'} Fill the structured fields with original content. Write 2–4 prose paragraphs totaling about 180 words. The choices must be specific actions tied to the scene, such as following a trail or asking a character for help. Put choice actions only in choices. Write a short visual description in coverPrompt. Do not include markdown.`;
 function parseChapter(content) {
 const cleaned=String(content||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
 const first=cleaned.indexOf('{'),last=cleaned.lastIndexOf('}');
 const story=JSON.parse(first>=0&&last>=first?cleaned.slice(first,last+1):cleaned);
 if(typeof story?.title!=='string'||!story.title.trim()||!Array.isArray(story.paragraphs)||!story.paragraphs.length||!story.paragraphs.every(p=>typeof p==='string'&&p.trim())) throw Error('The model returned an incomplete story. Please try again.');
 const expectedScript = {zh:/\p{Script=Han}/gu,te:/\p{Script=Telugu}/gu,hi:/\p{Script=Devanagari}/gu,ta:/\p{Script=Tamil}/gu}[locale];
 const prose = story.paragraphs.join(' ');
 if(expectedScript && (prose.match(expectedScript)?.length || 0) < (prose.match(/\p{L}/gu)?.length || 1) * .55) throw Error('The model did not write in the selected language. Please retry.');
 story.paragraphs=story.paragraphs.filter(paragraph=>!/^choices[\s:\[\](){},]*$/i.test(paragraph.trim()));
 if(!story.paragraphs.length) throw Error('The model returned an incomplete story. Please try again.');
 story.choices=ending?[]:[...new Set((Array.isArray(story.choices)?story.choices:[])
   .filter(choice=>typeof choice==='string')
   .map(choice=>choice.trim())
   .filter(choice=>choice && !/^(?:choice|option)\s*\d*$/i.test(choice)))].slice(0,3);
 if(!ending&&story.choices.length<3&&(locale==='en'||['zh','te','hi','ta'].includes(locale))) {
   const scene=story.paragraphs.at(-1);
   const localized = {
     zh:['在附近找线索','请好朋友帮忙','停下来想个办法'],
     te:['దగ్గరలో ఆధారాన్ని వెతుకు','స్నేహితుడిని సహాయం అడుగు','ఒక్క క్షణం ఆగి ఆలోచించు'],
     hi:['आसपास कोई सुराग ढूँढो','किसी दोस्त से मदद माँगो','रुककर एक योजना बनाओ'],
     ta:['அருகில் ஒரு தடயத்தைத் தேடு','நண்பரிடம் உதவி கேள்','சற்று நின்று யோசி']
   };
   const suggestions=localized[locale] || (/forest|woods|tree/i.test(scene)?['Follow the trail between the trees','Ask a woodland friend for help','Pause and listen to the forest']:/sea|ocean|shore/i.test(scene)?['Explore along the shore','Ask a sea creature for help','Look for clues by the water']:['Look nearby for a clue','Ask a friend what they noticed','Take a quiet moment to make a plan']);
   const combined=[...new Set([...story.choices,...suggestions])].slice(0,3);
   story.choices=combined;
 }
 if(!ending&&story.choices.length<2) throw Error('The model did not return enough choices in the selected language. Try again.');
 return story;
 }
 if(providers.openrouter && req.body.textProvider!=='ollama'){
   const selected = req.body.openrouterModel;
   const multilingual = locale!=='en';
   const preferred = selected || (multilingual ? process.env.MULTILINGUAL_STORY_MODEL || 'baidu/ernie-5.5-flash-preview:free' : undefined);
   try {return res.json({...parseChapter(await cloudStory(prompt,chapterFormat,preferred,!multilingual)),provider:'OpenRouter'});}
   catch {
     if(multilingual){
       try {return res.json({...parseChapter(await cloudStory(prompt,chapterFormat,selected,true)),provider:'OpenRouter'});}
       catch {console.warn('OpenRouter retry did not return a usable localized chapter.');}
     }
     console.warn('OpenRouter did not return a usable chapter. Trying Ollama.');
   }
 }
 if(!model || /:cloud$/i.test(model)) throw Error('Choose an installed Ollama fallback model in Settings.');
 const r=await request(localURL(req.body.ollama,'http://localhost:11434')+'/api/chat',{
   model, stream: false, think: false, format: chapterFormat,
   messages: [{role: 'user', content: prompt}],
   options: {
     temperature: 0.65, num_predict: 1200, num_ctx: 4096,
     ...(/^\d+$/.test(storyGpuLayers ?? '') ? {num_gpu: Number(storyGpuLayers)} : {})
   }
 });
 const data=await r.json();
 try {res.json({...parseChapter(data.message.content),provider:'Ollama'});}
 catch(e){if(e instanceof SyntaxError) throw Error('The model returned an incomplete story. Retry or choose another local story model in Settings.');throw e;}
 }catch(e){next(e)}});
app.post('/api/cover',async(req,res,next)=>{try{if(providers.media && req.body.imageProvider!=='automatic'){try{const image=await cloudMedia('image', (req.body.scene?'Gentle child-friendly watercolor scene, no text. ':'Gentle child-friendly watercolor picture book cover, no text. ')+String(req.body.prompt).slice(0,1200),req.body.imageModel);if(!['image/png','image/jpeg','image/webp'].includes(image.type))throw Error('Missing cover');return res.json({image:'data:'+image.type+';base64,'+Buffer.from(await image.arrayBuffer()).toString('base64'),provider:'Hugging Face'});}catch{console.warn('Hugging Face cover unavailable. Trying Automatic1111.');}}const r=await request(localURL(req.body.automatic,'http://localhost:7860')+'/sdapi/v1/txt2img',{prompt:`children's picture book illustration, soft watercolor, warm moonlight, cozy, whimsical, ${String(req.body.prompt).slice(0,1200)}`,negative_prompt:'text, letters, watermark, scary, violence, nudity',steps:20,width:req.body.scene?640:512,height:req.body.scene?384:640,batch_size:1});const data=await r.json();if(!data.images?.[0])throw Error('No image returned.');res.json({image:'data:image/png;base64,'+data.images[0]});}catch(e){next(e)}});
app.post('/api/speech', async (req, res, next) => {
  try {
    const text = String(req.body.text || '').slice(0, 10000);
    if (!text.trim()) return res.status(400).json({error:'No story text to narrate.'});
    if (providers.elevenlabs && !['kokoro','device'].includes(req.body.speechProvider)) {
      try {return res.type('audio/mpeg').send(await cloudSpeech(text,{voice:req.body.elevenVoice,model:req.body.speechModel,language:storyLocale(req.body.language),speed:[0.8,0.95,1.08].includes(req.body.speed)?req.body.speed:undefined}));}
      catch {console.warn('ElevenLabs narration unavailable. Trying local narration.');}
    }
    if (!req.body.tts) return res.status(503).json({error:'Cloud narration unavailable. Use a device voice.'});
    const local = await request(localURL(req.body.tts, 'http://localhost:8880') + '/v1/audio/speech', {
      model:'kokoro', input:text, voice:req.body.voice || 'af_heart', speed:[0.8,0.95,1.08].includes(req.body.speed)?req.body.speed:0.85, response_format:'mp3'
    });
    res.type('audio/mpeg').send(Buffer.from(await local.arrayBuffer()));
  } catch (error) {next(error);}
});
app.post('/api/video', async (req, res) => {
  if (!providers.media) return res.status(503).json({error:'Video requires an HF_TOKEN on the server.'});
  const scene = String(req.body.prompt || '').trim().slice(0, 1200);
  if (!scene) return res.status(400).json({error:'A scene description is required.'});
  try {
    const result = await cloudMedia('video', `Gentle child-friendly storybook animation, no text. ${scene}`, req.body.videoModel);
    if (!result.type?.startsWith('video/')) throw new Error('Missing video');
    res.type(result.type).send(Buffer.from(await result.arrayBuffer()));
  } catch {
    res.status(502).json({error:'Video generation is unavailable. Check the Hugging Face model, token permissions, and remaining credits.'});
  }
});
app.get(['/create','/heroes','/bookshelf','/rewards','/settings','/story/:id'], (req,res) => {
  res.sendFile('index.html', {root:'public'});
});
app.use((e,req,res,next)=>res.status(502).json({error:e.name==='TimeoutError'?'The local model took too long. Try a smaller model in Settings, or check the service logs.':e.cause?.code==='ECONNREFUSED'?'Local AI service is offline. Start it and check the address in Settings.':e.message}));
app.listen(Number(process.env.PORT)||4173,'127.0.0.1',()=>console.log(`StoryTime: http://127.0.0.1:${Number(process.env.PORT)||4173}`));
