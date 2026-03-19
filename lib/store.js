"use strict";

// Uses the Upstash Redis REST API directly via fetch() — no SDK needed.
// This avoids all ESM/CJS module-format conflicts on Vercel.

const ROOM_TTL_SECONDS = 60 * 60 * 8;

const memoryRooms = new Map();

function firstEnv(keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

const redisUrl = firstEnv([
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_KV_REST_API_URL",
  "UPSTASH_REDIS_REST_KV_URL",
  "KV_REST_API_URL",
]);

const redisToken = firstEnv([
  "UPSTASH_REDIS_REST_TOKEN",
  "UPSTASH_REDIS_REST_KV_REST_API_TOKEN",
  "KV_REST_API_TOKEN",
]);

const hasRedis = Boolean(redisUrl) && Boolean(redisToken);

// Run a Redis pipeline via the Upstash REST API.
// commands: array of Redis command arrays, e.g. [["GET", "key"]]
// Returns array of { result } objects.
async function redisPipeline(commands) {
  const res = await fetch(`${redisUrl}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${redisToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });
  if (!res.ok) {
    throw new Error(`Upstash REST error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

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
  if (hasRedis) {
    try {
      const results = await redisPipeline([["GET", roomKey(roomId)]]);
      const raw = results[0] && results[0].result;
      if (raw) {
        return typeof raw === "object" ? raw : JSON.parse(raw);
      }
    } catch (e) {
      console.error("Redis getRoom error:", e.message);
    }
  }

  if (!memoryRooms.has(roomId)) {
    memoryRooms.set(roomId, defaultRoom(roomId));
  }
  return memoryRooms.get(roomId);
}

async function saveRoom(roomId, room) {
  room.updatedAt = Date.now();

  if (hasRedis) {
    try {
      await redisPipeline([
        ["SET", roomKey(roomId), JSON.stringify(room), "EX", ROOM_TTL_SECONDS],
      ]);
      return;
    } catch (e) {
      console.error("Redis saveRoom error:", e.message);
    }
  }

  memoryRooms.set(roomId, room);
}

module.exports = {
  getRoom,
  saveRoom,
};
