const { Redis } = require("@upstash/redis");

const ROOM_TTL_SECONDS = 60 * 60 * 8;

const memoryRooms = new Map();

const hasRedisConfig =
  Boolean(process.env.UPSTASH_REDIS_REST_URL) &&
  Boolean(process.env.UPSTASH_REDIS_REST_TOKEN);

const redis = hasRedisConfig ? Redis.fromEnv() : null;

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
