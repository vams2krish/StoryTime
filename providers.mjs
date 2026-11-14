import { InferenceClient } from '@huggingface/inference';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const audioCache = new Map();

export const providers = {
  openrouter: Boolean(process.env.OPENROUTER_API_KEY),
  elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
  media: Boolean(process.env.HF_TOKEN)
};

async function postJson(url, headers, body, name) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', ...headers},
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(45000)
  });
  if (!response.ok) throw new Error(`${name} returned HTTP ${response.status}`);
  return response;
}

export async function cloudStory(prompt, schema) {
  const response = await postJson('https://openrouter.ai/api/v1/chat/completions', {
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`
  }, {
    model: process.env.OPENROUTER_MODEL || 'openrouter/free',
    messages: [{role: 'user', content: prompt}],
    response_format: {type: 'json_schema', json_schema: {name: 'story_chapter', strict: true, schema}},
    provider: {require_parameters: true},
    max_tokens: 2500
  }, 'OpenRouter');
  return (await response.json()).choices?.[0]?.message?.content;
}

export function cloudSpeech(text) {
  const voice = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';
  const model = process.env.ELEVENLABS_MODEL || 'eleven_flash_v2_5';
  const id = createHash('sha256').update(JSON.stringify([text, voice, model, 0.85, 0.65, 0.7, 'mp3_44100_128'])).digest('hex');
  if (!audioCache.has(id)) {
    audioCache.set(id, (async () => {
      const dir = '.storytime-cache';
      const file = join(dir, id + '.mp3');
      try { return await readFile(file); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const audio = await generateSpeech(text, voice, model);
      await mkdir(dir, {recursive: true});
      await writeFile(file, audio);
      return audio;
    })().finally(() => audioCache.delete(id)));
  }
  return audioCache.get(id);
}

async function generateSpeech(text, voice, model) {
  const response = await postJson(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
    'xi-api-key': process.env.ELEVENLABS_API_KEY
  }, {
    text,
    model_id: model,
    voice_settings: {speed: 0.85, stability: 0.65, similarity_boost: 0.7}
  }, 'ElevenLabs');
  if (!response.headers.get('content-type')?.startsWith('audio/')) throw new Error('ElevenLabs returned no audio');
  return Buffer.from(await response.arrayBuffer());
}

export async function cloudMedia(kind, prompt) {
  const client = new InferenceClient(process.env.HF_TOKEN);
  const options = {signal: AbortSignal.timeout(kind === 'video' ? 240000 : 60000)};
  if (kind === 'video') {
    return client.textToVideo({
      provider: 'fal-ai', model: process.env.HF_VIDEO_MODEL || 'Wan-AI/Wan2.2-TI2V-5B',
      inputs: prompt
    }, options);
  }
  return client.textToImage({
    provider: 'fal-ai', model: process.env.HF_IMAGE_MODEL || 'black-forest-labs/FLUX.1-schnell',
    inputs: prompt, parameters: {width: 512, height: 640}
  }, options);
}
