const { Redis } = require("@upstash/redis");

const ROOM_TTL_SECONDS = 60 * 60 * 8;

const memoryRooms = new Map();

function firstEnv(keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

const redisUrl = firstEnv([
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_REDIS_URL",
  "UPSTASH_REDIS_REST_KV_REST_API_URL",
]);

const redisToken = firstEnv([
  "UPSTASH_REDIS_REST_TOKEN",
  "UPSTASH_REDIS_REST_KV_REST_API_TOKEN",
  "UPSTASH_REDIS_REST_KV_REST_API_READ_ONLY_TOKEN",
]);

const hasRedisConfig = Boolean(redisUrl) && Boolean(redisToken);

const redis = hasRedisConfig
  ? new Redis({
      url: redisUrl,
      token: redisToken,
    })
  : null;

function roomKey(roomId) {
  return `plugd:room:${roomId}`;
}

function defaultRoom(roomId) {
  const now = Date.now();
  return {
    id: roomId,
    users: [],
    controllerUserId: null,
    playback: {
      isPlaying: false,
      currentTime: 0,
      updatedAt: now,
    },
    messages: [],
    launch: null,
    updatedAt: now,
  };
}

async function getRoom(roomId) {
  if (redis) {
    const key = roomKey(roomId);
    const room = await redis.get(key);
    if (room && typeof room === "object") {
      return room;
    }
    return defaultRoom(roomId);
  }

  if (!memoryRooms.has(roomId)) {
    memoryRooms.set(roomId, defaultRoom(roomId));
  }
  return memoryRooms.get(roomId);
}

async function saveRoom(roomId, room) {
  room.updatedAt = Date.now();
  if (redis) {
    const key = roomKey(roomId);
    await redis.set(key, room, { ex: ROOM_TTL_SECONDS });
    return;
  }

  memoryRooms.set(roomId, room);
}

module.exports = {
  getRoom,
  saveRoom,
};
