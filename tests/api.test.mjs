import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
let child,mock,origin,prompts=[];
before(async()=>{
 mock=http.createServer(async(req,res)=>{let text='';for await(const c of req)text+=c;const body=text?JSON.parse(text):{};res.setHeader('Content-Type','application/json');if(req.url==='/api/tags')return res.end(JSON.stringify({models:[{name:'local:7b',capabilities:['completion']},{name:'remote:cloud',remote_host:'https://ollama.com'},{name:'embed',capabilities:['embedding']}]}));if(req.url==='/api/chat'){prompts.push(body.messages[0].content);return res.end(JSON.stringify({message:{content:JSON.stringify({title:'A soft adventure',paragraphs:['Mia and her blue fox found a star.'],choices:['Follow the stream','Help the owl'],coverPrompt:'A blue fox under the moon'})}}))}if(req.url==='/sdapi/v1/txt2img')return res.end(JSON.stringify({images:['YWJj']}));res.end('{}')});
 await new Promise(r=>mock.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${mock.address().port}`;
 child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4189'},stdio:'pipe'});
 await new Promise((resolve,reject)=>{child.stdout.on('data',resolve);child.on('error',reject);child.on('exit',code=>reject(Error('Server exited '+code)))})
});
after(async()=>{child?.kill();await new Promise(r=>mock?.close(r))});
const post=async(path,body)=>{const r=await fetch('http://127.0.0.1:4189/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json()}};
test('model discovery excludes cloud and embedding models',async()=>{const r=await post('models',{ollama:origin});assert.deepEqual(r.data.models,['local:7b'])});
test('hero preferences and selected adventure path reach model; final chapter closes choices',async()=>{const data={ollama:origin,model:'local:7b',hero:{name:'Mia',color:'Blue',animal:'Fox'},theme:'Forest',adventure:true};const a=await post('story',data);assert.equal(a.status,200);assert.equal(a.data.choices.length,2);assert.match(prompts.at(-1),/Mia/);assert.match(prompts.at(-1),/Blue/);assert.match(prompts.at(-1),/Fox/);const b=await post('story',{...data,history:[a.data,a.data],choice:'Help the owl'});assert.deepEqual(b.data.choices,[]);assert.match(prompts.at(-1),/The child chose: Help the owl/)});
test('rejects nonlocal service origins',async()=>{const r=await post('models',{ollama:'https://example.com'});assert.equal(r.status,502);assert.match(r.data.error,/localhost/)});
test('cover output is an embeddable PNG data URL',async()=>{const r=await post('cover',{automatic:origin,prompt:'A friendly fox'});assert.equal(r.data.image,'data:image/png;base64,YWJj')});
