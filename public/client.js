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

const STORAGE_USER_ID_KEY = "plugd_user_id";

const state = {
  roomId: "",
  userId: localStorage.getItem(STORAGE_USER_ID_KEY) || "",
  users: [],
  messages: [],
  launch: null,
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
};

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

function applyRoomState(roomData) {
  state.users = roomData.users || [];
  state.messages = roomData.messages || [];
  state.launch = roomData.launch || null;
  applyPlayback(roomData.playback || state.playback);
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
  window.open(launch.url, "_blank", "noopener,noreferrer");

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
}

function tickClock() {
  if (state.playback.isPlaying) {
    const elapsed = (Date.now() - state.playback.updatedAt) / 1000;
    clock.textContent = formatTime(state.playback.currentTime + Math.max(0, elapsed));
  }
}

async function sendPlayback(action, extra = {}) {
  const baseTime = estimatedTime(state.playback);

  if (action === "pause") {
    applyPlayback({
      ...state.playback,
      isPlaying: false,
      currentTime: baseTime,
      updatedAt: Date.now(),
      serverNow: Date.now(),
    });
  }

  if (action === "play") {
    applyPlayback({
      ...state.playback,
      isPlaying: true,
      currentTime: baseTime,
      updatedAt: Date.now(),
      serverNow: Date.now(),
    });
  }

  await apiAction("playback", {
    roomId: state.roomId,
    userId: state.userId,
    action,
    currentTime: action === "seek" ? Number(timeInput.value || 0) : baseTime,
    ...extra,
  });

  const roomData = await apiGetState();
  if (roomData) {
    applyRoomState(roomData);
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

setInterval(tickClock, 250);
