const { getRoom, saveRoom, getStoreInfo } = require("./store");

const ROOM_ID_REGEX = /^[a-z0-9-_]{3,40}$/;
const USERNAME_MAX_LEN = 24;
const CHAT_MAX_LEN = 300;
const USER_TIMEOUT_MS = 120_000;

function sanitizeRoomId(value) {
  return String(value || "").trim().toLowerCase();
}

function sanitizeName(value) {
  return String(value || "").trim().slice(0, USERNAME_MAX_LEN);
}

function makeId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function now() {
  return Date.now();
}

function pruneUsers(room) {
  if (!room.stream || typeof room.stream !== "object") {
    room.stream = {
      url: "",
      updatedAt: now(),
      announcedBy: null,
    };
  }

  const limit = now() - USER_TIMEOUT_MS;
  room.users = room.users.filter((u) => u.lastSeen >= limit);

  if (!room.users.some((u) => u.isHost)) {
    if (room.users[0]) {
      room.users[0].isHost = true;
    }
  }

  if (!room.users.some((u) => u.userId === room.controllerUserId)) {
    const host = room.users.find((u) => u.isHost);
    room.controllerUserId = host ? host.userId : null;
  }
}

function getPlaybackTime(playback) {
  if (!playback.isPlaying) {
    return playback.currentTime;
  }

  const elapsed = (now() - playback.updatedAt) / 1000;
  return playback.currentTime + Math.max(0, elapsed);
}

function userById(room, userId) {
  return room.users.find((u) => u.userId === userId) || null;
}

function canControl(room, userId) {
  const user = userById(room, userId);
  if (!user) {
    return false;
  }
  return user.isHost || room.controllerUserId === userId;
}

function compactRoom(room) {
  const snapshotNow = now();
  const snapshotTime = getPlaybackTime(room.playback);

  return {
    roomId: room.id,
    users: room.users.map((u) => ({
      userId: u.userId,
      name: u.name,
      isHost: Boolean(u.isHost),
      isController: room.controllerUserId === u.userId,
      lastSeen: u.lastSeen,
    })),
    playback: {
      isPlaying: room.playback.isPlaying,
      currentTime: snapshotTime,
      // Snapshot time and timestamp are aligned to avoid client-side double counting.
      updatedAt: snapshotNow,
      serverNow: snapshotNow,
    },
    messages: room.messages,
    launch: room.launch,
    stream: {
      url: room.stream && typeof room.stream.url === "string" ? room.stream.url : "",
      updatedAt: Number(room.stream && room.stream.updatedAt) || snapshotNow,
      announcedBy: room.stream && room.stream.announcedBy ? room.stream.announcedBy : null,
    },
    updatedAt: room.updatedAt,
  };
}

function addSystemMessage(room, text) {
  room.messages.push({
    id: makeId("m"),
    system: true,
    text: String(text),
    createdAt: now(),
  });
  room.messages = room.messages.slice(-120);
}

async function joinRoom({ roomId, userName, userId }) {
  const safeRoomId = sanitizeRoomId(roomId);
  const safeName = sanitizeName(userName);

  if (!safeRoomId || !safeName) {
    throw new Error("Room et pseudo sont requis.");
  }
  if (!ROOM_ID_REGEX.test(safeRoomId)) {
    throw new Error("Room invalide (3-40 caracteres: a-z, 0-9, -, _)." );
  }

  const room = await getRoom(safeRoomId);
  pruneUsers(room);

  const safeUserId = String(userId || makeId("u")).slice(0, 42);
  let user = userById(room, safeUserId);

  if (!user) {
    user = {
      userId: safeUserId,
      name: safeName,
      isHost: room.users.length === 0,
      lastSeen: now(),
    };
    room.users.push(user);
    addSystemMessage(room, `${safeName} a rejoint la room.`);
  } else {
    user.name = safeName;
    user.lastSeen = now();
  }

  if (!room.controllerUserId) {
    room.controllerUserId = user.isHost ? user.userId : (room.users.find((u) => u.isHost) || user).userId;
  }

  await saveRoom(safeRoomId, room);

  return {
    userId: user.userId,
    room: compactRoom(room),
  };
}

async function heartbeat({ roomId, userId }) {
  const safeRoomId = sanitizeRoomId(roomId);
  if (!safeRoomId || !userId) {
    throw new Error("roomId et userId requis.");
  }

  const room = await getRoom(safeRoomId);
  pruneUsers(room);
  const user = userById(room, userId);
  if (user) {
    user.lastSeen = now();
    await saveRoom(safeRoomId, room);
  }

  return { ok: true };
}

async function getState({ roomId, userId }) {
  const safeRoomId = sanitizeRoomId(roomId);
  if (!safeRoomId) {
    throw new Error("roomId requis.");
  }

  const room = await getRoom(safeRoomId);
  pruneUsers(room);

  if (userId) {
    const user = userById(room, userId);
    if (user) {
      user.lastSeen = now();
    }
  }

  if (room.launch && room.launch.launchAt < now() - 15_000) {
    room.launch = null;
  }

  await saveRoom(safeRoomId, room);

  return compactRoom(room);
}

async function sendChat({ roomId, userId, text }) {
  const safeRoomId = sanitizeRoomId(roomId);
  const cleanText = String(text || "").trim().slice(0, CHAT_MAX_LEN);
  if (!safeRoomId || !userId || !cleanText) {
    throw new Error("Message invalide.");
  }

  const room = await getRoom(safeRoomId);
  pruneUsers(room);

  const user = userById(room, userId);
  if (!user) {
    throw new Error("Utilisateur introuvable.");
  }

  user.lastSeen = now();
  room.messages.push({
    id: makeId("m"),
    system: false,
    userId: user.userId,
    userName: user.name,
    text: cleanText,
    createdAt: now(),
  });
  room.messages = room.messages.slice(-120);

  await saveRoom(safeRoomId, room);

  return { ok: true };
}

async function playbackAction({ roomId, userId, action, currentTime, shouldPlay }) {
  const safeRoomId = sanitizeRoomId(roomId);
  if (!safeRoomId || !userId) {
    throw new Error("roomId et userId requis.");
  }

  const room = await getRoom(safeRoomId);
  pruneUsers(room);

  if (!canControl(room, userId)) {
    throw new Error("Seul host/DJ peut controler la lecture.");
  }

  const safeTime = Number(currentTime);
  const resolvedTime = Number.isFinite(safeTime) ? Math.max(0, safeTime) : getPlaybackTime(room.playback);

  if (action === "play") {
    room.playback.currentTime = resolvedTime;
    room.playback.isPlaying = true;
    room.playback.updatedAt = now();
  } else if (action === "pause") {
    room.playback.currentTime = resolvedTime;
    room.playback.isPlaying = false;
    room.playback.updatedAt = now();
  } else if (action === "seek") {
    room.playback.currentTime = resolvedTime;
    room.playback.isPlaying = Boolean(shouldPlay);
    room.playback.updatedAt = now();
  } else if (action === "resync-all") {
    // No playback mutation, clients will refresh from state.
  } else {
    throw new Error("Action playback inconnue.");
  }

  await saveRoom(safeRoomId, room);

  // Return the authoritative room so the client doesn't need a second fetch.
  return { ok: true, room: compactRoom(room) };
}

async function claimController({ roomId, userId }) {
  const safeRoomId = sanitizeRoomId(roomId);
  const room = await getRoom(safeRoomId);
  pruneUsers(room);

  const user = userById(room, userId);
  if (!user || !user.isHost) {
    throw new Error("Seul le host peut attribuer/reprendre le role DJ.");
  }

  room.controllerUserId = user.userId;
  addSystemMessage(room, `${user.name} reprend le controle (host).`);
  await saveRoom(safeRoomId, room);

  return { ok: true };
}

async function transferController({ roomId, userId, targetUserId }) {
  const safeRoomId = sanitizeRoomId(roomId);
  const room = await getRoom(safeRoomId);
  pruneUsers(room);

  const actor = userById(room, userId);
  if (!actor || !actor.isHost) {
    throw new Error("Seul le host peut donner le role DJ.");
  }

  const target = userById(room, targetUserId);
  if (!target) {
    throw new Error("Utilisateur DJ introuvable.");
  }

  room.controllerUserId = target.userId;
  addSystemMessage(room, `${target.name} controle la lecture (DJ).`);
  await saveRoom(safeRoomId, room);

  return { ok: true };
}

async function launchSession({ roomId, userId, url, platform, delayMs }) {
  const safeRoomId = sanitizeRoomId(roomId);
  const cleanUrl = String(url || "").trim();
  if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) {
    throw new Error("URL episode invalide.");
  }

  const room = await getRoom(safeRoomId);
  pruneUsers(room);

  if (!canControl(room, userId)) {
    throw new Error("Seul host/DJ peut lancer la session.");
  }

  const safeDelay = Number.isFinite(Number(delayMs))
    ? Math.min(30_000, Math.max(2_000, Number(delayMs)))
    : 5_000;

  const launchAt = now() + safeDelay;
  const actor = userById(room, userId);

  room.launch = {
    id: makeId("launch"),
    platform: String(platform || "external"),
    url: cleanUrl,
    launchAt,
    announcedBy: actor ? actor.name : "Host",
  };

  // A new launch always starts from episode time 0.
  room.playback.currentTime = 0;
  room.playback.isPlaying = false;
  room.playback.updatedAt = now();

  addSystemMessage(room, `Countdown ${room.launch.platform} lance par ${room.launch.announcedBy}.`);
  await saveRoom(safeRoomId, room);

  return { ok: true };
}

async function setStream({ roomId, userId, url }) {
  const safeRoomId = sanitizeRoomId(roomId);
  if (!safeRoomId || !userId) {
    throw new Error("roomId et userId requis.");
  }

  const room = await getRoom(safeRoomId);
  pruneUsers(room);

  if (!canControl(room, userId)) {
    throw new Error("Seul host/DJ peut modifier le flux video.");
  }

  const cleanUrl = String(url || "").trim();
  const actor = userById(room, userId);

  if (!cleanUrl) {
    room.stream = {
      url: "",
      updatedAt: now(),
      announcedBy: actor ? actor.name : "Host",
    };
    addSystemMessage(room, `${room.stream.announcedBy} a retire le flux video.`);
  } else {
    let parsed;
    try {
      parsed = new URL(cleanUrl);
    } catch {
      throw new Error("URL de flux invalide.");
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Le flux doit utiliser http:// ou https://.");
    }

    room.stream = {
      url: parsed.toString(),
      updatedAt: now(),
      announcedBy: actor ? actor.name : "Host",
    };
    addSystemMessage(room, `${room.stream.announcedBy} a charge un flux video.`);
  }

  await saveRoom(safeRoomId, room);
  return { ok: true, room: compactRoom(room) };
}

async function debugInfo() {
  const info = getStoreInfo();
  let redisPing = null;
  if (info.hasRedis) {
    try {
      const { getRoom: gr } = require("./store");
      await gr("__debug_ping__");
      redisPing = "ok";
    } catch (e) {
      redisPing = e.message;
    }
  }
  return { store: info, redisPing, now: Date.now() };
}

async function handleAction({ action, payload }) {
  if (action === "join") return joinRoom(payload);
  if (action === "heartbeat") return heartbeat(payload);
  if (action === "state") return getState(payload);
  if (action === "chat") return sendChat(payload);
  if (action === "playback") return playbackAction(payload);
  if (action === "controller-claim") return claimController(payload);
  if (action === "controller-transfer") return transferController(payload);
  if (action === "launch") return launchSession(payload);
  if (action === "stream-set") return setStream(payload);
  if (action === "debug") return debugInfo();
  throw new Error("Action inconnue.");
}

module.exports = {
  handleAction,
};
