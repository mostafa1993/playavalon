/**
 * PHASE 0 SPIKE — prove the "mouth": Azure TTS → LiveKit publish.   (THROWAWAY)
 *
 * Joins a LiveKit room as "AI Player (spike)" and speaks a hardcoded Persian
 * sentence three times. Success = a human in the room HEARS it.
 *
 * Run (from agents/reviewer/, with a human in the room listening):
 *   set -a; . ../../.env.local; set +a   # or export the vars by hand
 *   export AZURE_SPEECH_KEY=... AZURE_SPEECH_REGION=...   # if not in the env file
 *   npx tsx spike-tts.ts <ROOM_NAME> [voice]
 *
 * <ROOM_NAME> = the LiveKit room — for a game room it's the room CODE (e.g. ABCDEF).
 * [voice]     = Azure neural voice, default fa-IR-DilaraNeural (male: fa-IR-FaridNeural).
 *
 * Needs env: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET,
 *            AZURE_SPEECH_KEY, AZURE_SPEECH_REGION
 *
 * Delete this file once the spike is proven (plan: docs/2026-06-10-llm-voice-player-plan.md).
 */

import {
  AudioFrame,
  AudioSource,
  LocalAudioTrack,
  Room,
  TrackPublishOptions,
  TrackSource,
} from '@livekit/rtc-node';
import { AccessToken } from 'livekit-server-sdk';

const SAMPLE_RATE = 48000; // WebRTC-native; Azure emits raw PCM at this rate directly
const CHANNELS = 1;
const SENTENCE =
  'سلام دوستان! من بازیکن هوش مصنوعی هستم. صدای من را می‌شنوید؟ به‌زودی با شما آوالون بازی خواهم کرد.';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env var: ${name}`);
    console.error('Needed: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, AZURE_SPEECH_KEY, AZURE_SPEECH_REGION');
    process.exit(1);
  }
  return v;
}

/** Azure TTS REST: SSML in → raw 48kHz 16-bit mono PCM out. */
async function synthesize(text: string, voice: string): Promise<Int16Array> {
  const key = requireEnv('AZURE_SPEECH_KEY');
  const region = requireEnv('AZURE_SPEECH_REGION');
  const ssml =
    `<speak version='1.0' xml:lang='fa-IR'>` +
    `<voice name='${voice}'>${text}</voice></speak>`;

  const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'raw-48khz-16bit-mono-pcm',
      'User-Agent': 'playavalon-spike-tts',
    },
    body: ssml,
  });
  if (!res.ok) {
    throw new Error(`Azure TTS failed: ${res.status} ${res.statusText} — ${await res.text()}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`TTS ok: ${buf.length} bytes (${(buf.length / 2 / SAMPLE_RATE).toFixed(1)}s of audio)`);
  return new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
}

/** Push PCM into the AudioSource in 100ms frames. */
async function speak(source: AudioSource, pcm: Int16Array): Promise<void> {
  const samplesPerFrame = SAMPLE_RATE / 10;
  for (let off = 0; off < pcm.length; off += samplesPerFrame) {
    const chunk = pcm.subarray(off, Math.min(off + samplesPerFrame, pcm.length));
    await source.captureFrame(new AudioFrame(chunk, SAMPLE_RATE, CHANNELS, chunk.length));
  }
  await source.waitForPlayout();
}

async function main(): Promise<void> {
  const roomName = process.argv[2];
  const voice = process.argv[3] || 'fa-IR-DilaraNeural';
  if (!roomName) {
    console.error('Usage: npx tsx spike-tts.ts <ROOM_NAME> [azure-voice]');
    process.exit(1);
  }

  // 1. Synthesize first — fail fast on Azure problems before touching LiveKit.
  const pcm = await synthesize(SENTENCE, voice);

  // 2. Join the room (publish-capable, visible — players must see/hear it).
  const token = new AccessToken(requireEnv('LIVEKIT_API_KEY'), requireEnv('LIVEKIT_API_SECRET'), {
    identity: 'spike-tts-bot',
    name: 'AI Player (spike)',
    ttl: '10m',
  });
  token.addGrant({ room: roomName, roomJoin: true, canPublish: true, canSubscribe: false });

  const room = new Room();
  await room.connect(requireEnv('LIVEKIT_URL'), await token.toJwt(), { autoSubscribe: false, dynacast: false });
  console.log(`joined room "${roomName}" as "AI Player (spike)"`);

  // 3. Publish a mic-like audio track fed from our PCM source.
  const source = new AudioSource(SAMPLE_RATE, CHANNELS);
  const track = LocalAudioTrack.createAudioTrack('spike-voice', source);
  await room.localParticipant?.publishTrack(
    track,
    new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE })
  );
  console.log('audio track published — speaking 3× ...');

  // 4. Speak three times with pauses so a human has time to notice.
  for (let i = 1; i <= 3; i += 1) {
    console.log(`  speaking (${i}/3)`);
    await speak(source, pcm);
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log('done — disconnecting');
  await room.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('SPIKE FAILED:', err);
  process.exit(1);
});
