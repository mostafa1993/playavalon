/**
 * Standalone LiveKit connectivity smoke test.
 *
 * Generates a short-lived token, opens a LiveKit room connection via
 * @livekit/rtc-node (same SDK the agent uses), then disconnects.
 *
 * Run inside the agent container:
 *   docker compose exec agent node scripts/test-livekit-connect.mjs
 */

import { AccessToken } from 'livekit-server-sdk';
import { Room, RoomEvent } from '@livekit/rtc-node';

const url = process.env.LIVEKIT_URL;
const apiKey = process.env.LIVEKIT_API_KEY;
const apiSecret = process.env.LIVEKIT_API_SECRET;

if (!url || !apiKey || !apiSecret) {
  console.error('missing LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET');
  process.exit(2);
}

console.log(`[probe] LIVEKIT_URL=${url}`);

const roomName = `probe-${Date.now()}`;
const identity = `probe-${Math.random().toString(36).slice(2, 8)}`;

const at = new AccessToken(apiKey, apiSecret, { identity, ttl: 60 });
at.addGrant({ room: roomName, roomJoin: true, canSubscribe: true });
const token = await at.toJwt();

const room = new Room();
room.on(RoomEvent.Connected, () => console.log('[probe] connected event fired'));
room.on(RoomEvent.Disconnected, (reason) =>
  console.log('[probe] disconnected event fired, reason:', reason)
);

const t0 = Date.now();
try {
  await room.connect(url, token);
  console.log(`[probe] OK — connected in ${Date.now() - t0}ms`);
  await room.disconnect();
  console.log('[probe] clean shutdown');
  process.exit(0);
} catch (err) {
  console.error(`[probe] FAILED after ${Date.now() - t0}ms`);
  console.error(err);
  process.exit(1);
}
