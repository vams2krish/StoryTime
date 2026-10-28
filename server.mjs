import express from 'express';
const app = express();
app.use(express.json({limit:'2mb'}));
app.use(express.static('public'));
app.use('/vendor',express.static('node_modules/jspdf/dist'));
function localURL(value, fallback) {
  const u=new URL(value||fallback);
  if(!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||!['http:','https:'].includes(u.protocol)) throw Error('Use a localhost service URL.');
  return u.origin;
}
async function request(url, body, timeout=180000) {
 const r=await fetch(url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeout)});
 if(!r.ok) throw Error(`Local service returned ${r.status}. Check that its API is enabled.`);
 return r;
}
app.post('/api/models',async(req,res,next)=>{try{const r=await request(localURL(req.body.ollama,'http://localhost:11434')+'/api/tags'); const data=await r.json();res.json({models:data.models.filter(m=>!m.remote_host&&!m.name.includes(':cloud')&&(!m.capabilities||m.capabilities.includes('completion'))).map(m=>m.name)});}catch(e){next(e)}});
app.post('/api/story',async(req,res,next)=>{try{
 const {hero,theme,adventure,history=[],choice,model}=req.body;
 if(!hero?.name||!hero?.color||!hero?.animal||!model) throw Error('Choose a hero and a local model first.');
 if(history.length>4) throw Error('This adventure has reached its ending.');
 const ending=!adventure||history.length>=2;
 const prompt=`Write a gentle bedtime story for children ages 4–8. No violence, frightening content, or adult subjects. Main hero: ${JSON.stringify(hero)}. Include their favorite color and animal naturally. Theme: ${String(theme).slice(0,100)}. ${adventure?'This is an interactive adventure.':'Write a complete story with a comforting ending.'} ${history.length?`Previous story chapters and choices: ${JSON.stringify(history).slice(0,18000)}. The child chose: ${String(choice).slice(0,200)}. Continue directly and make that choice change events.`:''} ${ending?'Finish with a warm, satisfying ending. Return no choices.':'End at a decision and give exactly 2 or 3 short, distinct child-friendly choices.'} Return JSON only: {"title":"story title", "paragraphs":["paragraph", "paragraph", "paragraph"], "choices":["choice"], "coverPrompt":"brief illustration description with no text"}. Each chapter should be 180–280 words. Do not include markdown.`;
 const r=await request(localURL(req.body.ollama,'http://localhost:11434')+'/api/chat',{model,stream:false,format:'json',messages:[{role:'user',content:prompt}],options:{temperature:0.8,num_predict:1600,num_ctx:4096}});
 const data=await r.json();const story=JSON.parse(data.message.content);
 if(typeof story.title!=='string'||!Array.isArray(story.paragraphs)||!story.paragraphs.length||!story.paragraphs.every(p=>typeof p==='string'&&p.trim())) throw Error('The model returned an incomplete story. Please try again.');
 story.choices=ending?[]:(story.choices||[]).filter(c=>typeof c==='string').slice(0,3);
 if(!ending&&story.choices.length<2) throw Error('The model did not provide adventure choices. Please try again.');
 res.json(story);
 }catch(e){next(e)}});
app.post('/api/cover',async(req,res,next)=>{try{const r=await request(localURL(req.body.automatic,'http://localhost:7860')+'/sdapi/v1/txt2img',{prompt:`children's picture book illustration, soft watercolor, warm moonlight, cozy, whimsical, ${String(req.body.prompt).slice(0,1200)}`,negative_prompt:'text, letters, watermark, scary, violence, nudity',steps:20,width:512,height:640,batch_size:1});const data=await r.json();if(!data.images?.[0])throw Error('No image returned.');res.json({image:'data:image/png;base64,'+data.images[0]});}catch(e){next(e)}});
app.post('/api/speech',async(req,res,next)=>{try{const r=await request(localURL(req.body.tts,'http://localhost:8880')+'/v1/audio/speech',{model:'kokoro',input:String(req.body.text).slice(0,20000),voice:req.body.voice||'af_heart',speed:0.85,response_format:'mp3'});res.type('audio/mpeg').send(Buffer.from(await r.arrayBuffer()));}catch(e){next(e)}});
app.use((e,req,res,next)=>res.status(502).json({error:e.name==='TimeoutError'?'The local model took too long. Try a smaller model in Settings, or check the service logs.':e.cause?.code==='ECONNREFUSED'?'Local AI service is offline. Start it and check the address in Settings.':e.message}));
app.listen(Number(process.env.PORT)||4173,'127.0.0.1',()=>console.log(`StoryTime: http://127.0.0.1:${Number(process.env.PORT)||4173}`));
