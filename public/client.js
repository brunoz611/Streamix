const joinPanel = document.getElementById("joinPanel");
const roomPanel = document.getElementById("roomPanel");
const joinForm = document.getElementById("joinForm");
const roomIdInput = document.getElementById("roomIdInput");
const userNameInput = document.getElementById("userNameInput");
const roomTitle = document.getElementById("roomTitle");
const controllerLabel = document.getElementById("controllerLabel");
const usersList = document.getElementById("usersList");
const messages = document.getElementById("messages");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const playBtn = document.getElementById("playBtn");
const pauseBtn = document.getElementById("pauseBtn");
const seekBtn = document.getElementById("seekBtn");
const timeInput = document.getElementById("timeInput");
const clock = document.getElementById("clock");
const resyncBtn = document.getElementById("resyncBtn");
const claimControlBtn = document.getElementById("claimControlBtn");
const djSelect = document.getElementById("djSelect");
const assignDjBtn = document.getElementById("assignDjBtn");
const platformSelect = document.getElementById("platformSelect");
const episodeUrlInput = document.getElementById("episodeUrlInput");
const delayInput = document.getElementById("delayInput");
const launchBtn = document.getElementById("launchBtn");
const countdownLabel = document.getElementById("countdownLabel");
const resyncAllBtn = document.getElementById("resyncAllBtn");
const streamUrlInput = document.getElementById("streamUrlInput");
const setStreamBtn = document.getElementById("setStreamBtn");
const demoStreamBtn = document.getElementById("demoStreamBtn");
const clearStreamBtn = document.getElementById("clearStreamBtn");
const streamStatus = document.getElementById("streamStatus");
const roomVideo = document.getElementById("roomVideo");

const DEMO_STREAM_URL = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";

const STORAGE_USER_ID_KEY = "plugd_user_id";

const state = {
  roomId: "",
  userId: localStorage.getItem(STORAGE_USER_ID_KEY) || "",
  users: [],
  messages: [],
  launch: null,
  stream: {
    url: "",
    updatedAt: Date.now(),
  },
  playback: {
    isPlaying: false,
    currentTime: 0,
    updatedAt: Date.now(),
    serverNow: Date.now(),
  },
  countdownTimer: null,
  heartbeatTimer: null,
  pollTimer: null,
  lastDriftFixAt: 0,
  lastLaunchId: "",
  autoPollInFlight: false,
  // When set, polls cannot override playback until server confirms the expected state.
  // { isPlaying: bool, expiresAt: timestamp }
  playbackIntent: null,
  syncingVideo: false,
  lastVideoSyncAt: 0,
};

const streamEngine = {
  hls: null,
};

function destroyStreamEngine() {
  if (streamEngine.hls) {
    streamEngine.hls.destroy();
    streamEngine.hls = null;
  }
}

function normalizeUrl(value) {
  try {
    return new URL(String(value || "").trim());
  } catch {
    return null;
  }
}

function isDrmPlatform(urlObject) {
  if (!urlObject) return false;
  const host = urlObject.hostname.toLowerCase();
  return [
    "crunchyroll.com",
    "primevideo.com",
    "amazon.com",
    "netflix.com",
    "disneyplus.com",
    "max.com",
  ].some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function getMediaType(urlObject) {
  if (!urlObject) return "unknown";
  const path = urlObject.pathname.toLowerCase();
  if (path.endsWith(".m3u8")) return "hls";
  if (path.endsWith(".mp4") || path.endsWith(".webm") || path.endsWith(".ogg") || path.endsWith(".ogv")) {
    return "file";
  }
  return "unknown";
}

function formatTime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const s = String(seconds % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function getController() {
  return state.users.find((u) => u.isController);
}

function isController() {
  const controller = getController();
  return Boolean(controller && controller.userId === state.userId);
}

function isHost() {
  const self = state.users.find((u) => u.userId === state.userId);
  return Boolean(self && self.isHost);
}

function estimatedTime(playback) {
  if (!playback.isPlaying) {
    return playback.currentTime;
  }

  const elapsed = (Date.now() - playback.updatedAt) / 1000;
  return playback.currentTime + Math.max(0, elapsed);
}

function appendMessage(message) {
  state.messages.push(message);
}

function renderMessages() {
  messages.innerHTML = "";
  state.messages.forEach((message) => {
    const li = document.createElement("li");
    if (message.system) {
      li.className = "system";
      li.textContent = `[SYSTEM] ${message.text}`;
    } else {
      li.textContent = `${message.userName}: ${message.text}`;
    }
    messages.appendChild(li);
  });
  messages.scrollTop = messages.scrollHeight;
}

function renderUsers() {
  usersList.innerHTML = "";
  state.users.forEach((u) => {
    const li = document.createElement("li");
    const badges = [];
    if (u.isHost) badges.push("host");
    if (u.isController) badges.push("DJ");
    li.textContent = badges.length ? `${u.name} (${badges.join(" / ")})` : u.name;
    usersList.appendChild(li);
  });

  const controller = getController();
  controllerLabel.textContent = controller
    ? `Controle: ${controller.name}${controller.isHost ? " (host)" : " (DJ)"}`
    : "Controle: aucun";

  const canPress = isController();
  const host = isHost();
  playBtn.disabled = !canPress;
  pauseBtn.disabled = !canPress;
  seekBtn.disabled = !canPress;
  launchBtn.disabled = !canPress;
  resyncAllBtn.disabled = !canPress;
  setStreamBtn.disabled = !canPress;
  demoStreamBtn.disabled = !canPress;
  clearStreamBtn.disabled = !canPress;
  assignDjBtn.disabled = !host;
  claimControlBtn.disabled = !host;

  const previousSelection = djSelect.value;
  djSelect.innerHTML = "";

  state.users
    .filter((u) => !u.isHost)
    .forEach((u) => {
      const opt = document.createElement("option");
      opt.value = u.userId;
      opt.textContent = u.name;
      djSelect.appendChild(opt);
    });

  if (previousSelection) {
    djSelect.value = previousSelection;
  }

  if (!djSelect.value && djSelect.options.length > 0) {
    djSelect.selectedIndex = 0;
  }
}

function showError(message) {
  appendMessage({ system: true, text: message });
  renderMessages();
}

async function apiGetState() {
  if (!state.roomId) return null;

  const params = new URLSearchParams({
    roomId: state.roomId,
    userId: state.userId,
  });

  const response = await fetch(`/api/room?${params.toString()}`);
  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.error || "Erreur serveur");
  }
  return data.data;
}

async function apiAction(action, payload) {
  const response = await fetch("/api/room", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, payload }),
  });
  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.error || "Erreur serveur");
  }
  return data.data;
}

function applyRoomState(roomData, { forcePb = false } = {}) {
  state.users = roomData.users || [];
  state.messages = roomData.messages || [];
  state.launch = roomData.launch || null;
  applyStream(roomData.stream || state.stream);

  const pb = roomData.playback || state.playback;
  const intent = state.playbackIntent;

  if (forcePb) {
    // Authoritative response from our own action — always apply.
    // If server already matches our intent, clear the lock.
    if (intent && pb.isPlaying === intent.isPlaying) {
      state.playbackIntent = null;
    }
    applyPlayback(pb);
  } else if (intent) {
    if (Date.now() > intent.expiresAt) {
      // Lock expired — accept server state and give up waiting.
      state.playbackIntent = null;
      applyPlayback(pb);
    } else if (pb.isPlaying === intent.isPlaying) {
      // Server confirmed our intent — clear lock and apply.
      state.playbackIntent = null;
      applyPlayback(pb);
    }
    // else: server disagrees AND lock is active — ignore this poll's playback.
  } else {
    applyPlayback(pb);
  }

  renderUsers();
  renderMessages();
  maybeHandleLaunch(roomData.launch);
}

function startSyncLoops() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
  }
  if (state.heartbeatTimer) {
    clearInterval(state.heartbeatTimer);
  }

  state.pollTimer = setInterval(async () => {
    if (!state.roomId || state.autoPollInFlight) {
      return;
    }

    state.autoPollInFlight = true;
    try {
      const roomData = await apiGetState();
      if (roomData) {
        const local = estimatedTime(state.playback);
        const remote = estimatedTime({
          ...roomData.playback,
          updatedAt: Number(roomData.playback.updatedAt) || Date.now(),
        });
        const drift = Math.abs(local - remote);
        const hadBigDrift = drift > 1.2 && Date.now() - state.lastDriftFixAt > 8000;

        applyRoomState(roomData);

        if (hadBigDrift) {
          state.lastDriftFixAt = Date.now();
          appendMessage({ system: true, text: `Correction drift (${drift.toFixed(1)}s).` });
          renderMessages();
        }
      }
    } catch (error) {
      showError(error.message || "Poll impossible");
    } finally {
      state.autoPollInFlight = false;
    }
  }, 1200);

  state.heartbeatTimer = setInterval(async () => {
    if (!state.roomId || !state.userId) {
      return;
    }
    try {
      await apiAction("heartbeat", {
        roomId: state.roomId,
        userId: state.userId,
      });
    } catch {
      // Heartbeat failures are recovered on next successful poll.
    }
  }, 10_000);
}

function maybeHandleLaunch(launch) {
  if (!launch || !launch.id || launch.id === state.lastLaunchId) {
    return;
  }

  state.lastLaunchId = launch.id;
  window.open(addLaunchFlags(launch.url), "_blank", "noopener,noreferrer");

  if (state.countdownTimer) {
    clearInterval(state.countdownTimer);
  }

  const label = launch.platform === "prime-video" ? "Prime Video" : "Crunchyroll";
  state.countdownTimer = setInterval(() => {
    const msLeft = launch.launchAt - Date.now();
    if (msLeft <= 0) {
      countdownLabel.textContent = `${label}: PLAY maintenant`;
      clearInterval(state.countdownTimer);
      state.countdownTimer = null;
      return;
    }

    const seconds = (msLeft / 1000).toFixed(1);
    countdownLabel.textContent = `${label}: lancement dans ${seconds}s`;
  }, 100);
}

function addLaunchFlags(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.set("plugd_start", "0");
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function applyStream(stream) {
  const nextUrl = stream && stream.url ? String(stream.url).trim() : "";
  const currentUrl = state.stream && state.stream.url ? state.stream.url : "";

  state.stream = {
    url: nextUrl,
    updatedAt: Number(stream && stream.updatedAt) || Date.now(),
  };

  if (document.activeElement !== streamUrlInput) {
    streamUrlInput.value = nextUrl;
  }

  streamStatus.textContent = nextUrl ? "Flux actif" : "Aucun flux";

  if (nextUrl === currentUrl) {
    return;
  }

  destroyStreamEngine();

  if (!nextUrl) {
    roomVideo.removeAttribute("src");
    roomVideo.load();
    streamStatus.textContent = "Aucun flux";
    return;
  }

  const parsed = normalizeUrl(nextUrl);
  const mediaType = getMediaType(parsed);

  if (isDrmPlatform(parsed)) {
    roomVideo.removeAttribute("src");
    roomVideo.load();
    streamStatus.textContent = "Plateforme DRM: flux direct impossible";
    return;
  }

  if (mediaType === "hls") {
    if (roomVideo.canPlayType("application/vnd.apple.mpegurl")) {
      roomVideo.src = nextUrl;
      roomVideo.load();
      streamStatus.textContent = "Flux HLS actif";
      return;
    }

    if (window.Hls && window.Hls.isSupported()) {
      streamEngine.hls = new window.Hls({
        lowLatencyMode: true,
      });
      streamEngine.hls.loadSource(nextUrl);
      streamEngine.hls.attachMedia(roomVideo);
      streamStatus.textContent = "Flux HLS actif";
      return;
    }

    roomVideo.removeAttribute("src");
    roomVideo.load();
    streamStatus.textContent = "HLS non supporte sur ce navigateur";
    return;
  }

  if (mediaType === "unknown") {
    roomVideo.removeAttribute("src");
    roomVideo.load();
    streamStatus.textContent = "URL non reconnue (utilisez .mp4/.webm/.m3u8)";
    return;
  }

  roomVideo.src = nextUrl;
  roomVideo.load();
  streamStatus.textContent = "Flux actif";
}

async function syncVideoToPlayback() {
  if (!roomVideo || !state.stream.url || state.syncingVideo) {
    return;
  }

  state.syncingVideo = true;
  try {
    const targetTime = Math.max(0, estimatedTime(state.playback));
    const current = Number(roomVideo.currentTime) || 0;

    if (Math.abs(current - targetTime) > 1.0) {
      roomVideo.currentTime = targetTime;
    }

    if (state.playback.isPlaying) {
      if (roomVideo.paused) {
        await roomVideo.play().catch(() => null);
      }
    } else if (!roomVideo.paused) {
      roomVideo.pause();
    }
  } finally {
    state.syncingVideo = false;
  }
}

function applyPlayback(playback) {
  state.playback = {
    isPlaying: Boolean(playback.isPlaying),
    currentTime: Number(playback.currentTime) || 0,
    updatedAt: Number(playback.updatedAt) || Date.now(),
    serverNow: Number(playback.serverNow) || Date.now(),
  };

  const uiTime = state.playback.currentTime;
  if (document.activeElement !== timeInput) {
    timeInput.value = String(Math.floor(uiTime));
  }
  clock.textContent = formatTime(uiTime);
  syncVideoToPlayback().catch(() => null);
}

function tickClock() {
  if (state.playback.isPlaying) {
    const elapsed = (Date.now() - state.playback.updatedAt) / 1000;
    clock.textContent = formatTime(state.playback.currentTime + Math.max(0, elapsed));
  }

  if (state.stream.url && Date.now() - state.lastVideoSyncAt > 1200) {
    state.lastVideoSyncAt = Date.now();
    syncVideoToPlayback().catch(() => null);
  }
}

async function sendPlayback(action, extra = {}) {
  const baseTime = estimatedTime(state.playback);

  // Apply optimistic local state immediately.
  if (action === "pause") {
    applyPlayback({
      ...state.playback,
      isPlaying: false,
      currentTime: baseTime,
      updatedAt: Date.now(),
      serverNow: Date.now(),
    });
  } else if (action === "play") {
    applyPlayback({
      ...state.playback,
      isPlaying: true,
      currentTime: baseTime,
      updatedAt: Date.now(),
      serverNow: Date.now(),
    });
  }

  // Lock polls until the server confirms the expected state (max 20s).
  if (action === "pause") state.playbackIntent = { isPlaying: false, expiresAt: Date.now() + 20000 };
  if (action === "play")  state.playbackIntent = { isPlaying: true,  expiresAt: Date.now() + 20000 };
  if (action === "seek")  state.playbackIntent = null; // seek just applies immediately

  const result = await apiAction("playback", {
    roomId: state.roomId,
    userId: state.userId,
    action,
    currentTime: action === "seek" ? Number(timeInput.value || 0) : baseTime,
    ...extra,
  });

  // The server returns the authoritative room directly — no second fetch needed.
  // This avoids landing on a different serverless instance with stale in-memory state.
  if (result && result.room) {
    applyRoomState(result.room, { forcePb: true });
  }
}

function setRoomVisible() {
  joinPanel.classList.add("hidden");
  roomPanel.classList.remove("hidden");
}

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  apiAction("join", {
    roomId: roomIdInput.value,
    userName: userNameInput.value,
    userId: state.userId,
  })
    .then((result) => {
      state.roomId = result.room.roomId;
      state.userId = result.userId;
      localStorage.setItem(STORAGE_USER_ID_KEY, state.userId);
      roomTitle.textContent = `Room: ${state.roomId}`;
      applyRoomState(result.room);
      setRoomVisible();
      startSyncLoops();
    })
    .catch((error) => {
      showError(error.message || "Join impossible");
    });
});

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  apiAction("chat", {
    roomId: state.roomId,
    userId: state.userId,
    text,
  })
    .then(async () => {
      chatInput.value = "";
      const roomData = await apiGetState();
      if (roomData) {
        applyRoomState(roomData);
      }
    })
    .catch((error) => {
      showError(error.message || "Message impossible");
    });
});

playBtn.addEventListener("click", () => {
  sendPlayback("play").catch((error) => showError(error.message || "Play impossible"));
});

pauseBtn.addEventListener("click", () => {
  sendPlayback("pause").catch((error) => showError(error.message || "Pause impossible"));
});

seekBtn.addEventListener("click", () => {
  sendPlayback("seek", {
    shouldPlay: state.playback.isPlaying,
  }).catch((error) => showError(error.message || "Seek impossible"));
});

resyncBtn.addEventListener("click", () => {
  apiGetState()
    .then((roomData) => {
      if (!roomData) return;
      applyRoomState(roomData);
      appendMessage({ system: true, text: `Resync sur ${formatTime(roomData.playback.currentTime)}.` });
      renderMessages();
    })
    .catch((error) => showError(error.message || "Resync impossible"));
});

claimControlBtn.addEventListener("click", () => {
  apiAction("controller-claim", {
    roomId: state.roomId,
    userId: state.userId,
  }).catch((error) => showError(error.message || "Action host refusee"));
});

assignDjBtn.addEventListener("click", () => {
  if (!djSelect.value) return;
  apiAction("controller-transfer", {
    roomId: state.roomId,
    userId: state.userId,
    targetUserId: djSelect.value,
  }).catch((error) => showError(error.message || "Transfer DJ refuse"));
});

resyncAllBtn.addEventListener("click", () => {
  apiAction("playback", {
    roomId: state.roomId,
    userId: state.userId,
    action: "resync-all",
  })
    .then(() => apiGetState())
    .then((roomData) => {
      if (roomData) applyRoomState(roomData);
    })
    .catch((error) => showError(error.message || "Resync all impossible"));
});

launchBtn.addEventListener("click", () => {
  const url = episodeUrlInput.value.trim();
  if (!url) return;

  apiAction("launch", {
    roomId: state.roomId,
    userId: state.userId,
    url,
    platform: platformSelect.value,
    delayMs: Number(delayInput.value || 5000),
  }).catch((error) => showError(error.message || "Launch impossible"));
});

setStreamBtn.addEventListener("click", () => {
  const url = streamUrlInput.value.trim();
  if (!url) {
    showError("Entrez une URL de flux video.");
    return;
  }

  const parsed = normalizeUrl(url);
  if (!parsed) {
    showError("URL invalide.");
    return;
  }

  if (isDrmPlatform(parsed)) {
    showError("Crunchyroll/Prime/Netflix ne fournissent pas de flux video direct lisible ici (DRM). Utilisez une URL .mp4/.m3u8.");
    return;
  }

  apiAction("stream-set", {
    roomId: state.roomId,
    userId: state.userId,
    url: parsed.toString(),
  })
    .then((result) => {
      if (result && result.room) {
        applyRoomState(result.room, { forcePb: true });
      }
    })
    .catch((error) => showError(error.message || "Flux video impossible"));
});

demoStreamBtn.addEventListener("click", () => {
  streamUrlInput.value = DEMO_STREAM_URL;
  setStreamBtn.click();
});

clearStreamBtn.addEventListener("click", () => {
  apiAction("stream-set", {
    roomId: state.roomId,
    userId: state.userId,
    url: "",
  })
    .then((result) => {
      if (result && result.room) {
        applyRoomState(result.room, { forcePb: true });
      }
    })
    .catch((error) => showError(error.message || "Suppression du flux impossible"));
});

roomVideo.addEventListener("loadedmetadata", () => {
  syncVideoToPlayback().catch(() => null);
});

roomVideo.addEventListener("error", () => {
  streamStatus.textContent = "Flux non lisible (CORS/DRM/format)";
});

setInterval(tickClock, 250);
