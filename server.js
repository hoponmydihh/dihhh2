const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const MAX_ROOM_SIZE = 10;
const rooms = new Map();

function getOrCreateRoom(roomName) {
  if (!rooms.has(roomName)) {
    rooms.set(roomName, {
      clients: new Set(),
      chat: []
    });
  }
  return rooms.get(roomName);
}

function getRoomUsers(roomName) {
  const room = rooms.get(roomName);
  if (!room) return [];
  return [...room.clients].map((client) => ({
    id: client.clientId,
    name: client.userName || "Unknown"
  }));
}

function getLobbyList() {
  return [...rooms.entries()]
    .map(([roomName, room]) => ({
      room: roomName,
      count: room.clients.size
    }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count || a.room.localeCompare(b.room))
    .slice(0, 50);
}

function broadcastLobbyList() {
  const payload = JSON.stringify({
    type: "lobby-list",
    rooms: getLobbyList()
  });

  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

function broadcastRoomUsers(roomName) {
  const room = rooms.get(roomName);
  if (!room) return;

  const payload = JSON.stringify({
    type: "room-users",
    users: getRoomUsers(roomName),
    count: room.clients.size
  });

  for (const client of room.clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

function broadcastToRoom(roomName, payload, excludeClient = null) {
  const room = rooms.get(roomName);
  if (!room) return;

  const message = JSON.stringify(payload);
  for (const client of room.clients) {
    if (client !== excludeClient && client.readyState === 1) {
      client.send(message);
    }
  }
}

function sendToClient(targetId, roomName, payload) {
  const room = rooms.get(roomName);
  if (!room) return false;

  for (const client of room.clients) {
    if (client.clientId === targetId && client.readyState === 1) {
      client.send(JSON.stringify(payload));
      return true;
    }
  }
  return false;
}

function removeClientFromRoom(ws) {
  const roomName = ws.room;
  if (!roomName || !rooms.has(roomName)) return;

  const room = rooms.get(roomName);
  room.clients.delete(ws);

  broadcastToRoom(roomName, {
    type: "user-left",
    id: ws.clientId,
    name: ws.userName || "Unknown"
  });

  if (room.clients.size === 0) {
    rooms.delete(roomName);
  } else {
    broadcastRoomUsers(roomName);
  }

  ws.room = null;
  broadcastLobbyList();
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Orbit Call</title>
  <style>
    * {
      box-sizing: border-box;
    }

    :root {
      --bg: #eef2f7;
      --bg2: #e9edf5;
      --panel: rgba(255,255,255,0.72);
      --panel-strong: rgba(255,255,255,0.88);
      --text: #0f172a;
      --muted: #64748b;
      --line: rgba(15, 23, 42, 0.08);
      --primary: #4f46e5;
      --primary-soft: rgba(79, 70, 229, 0.12);
      --success: #0f766e;
      --danger: #dc2626;
      --warning: #b45309;
      --shadow: 0 18px 50px rgba(15, 23, 42, 0.10);
      --radius: 24px;
    }

    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--text);
      min-height: 100vh;
      background:
        radial-gradient(circle at top left, rgba(99,102,241,0.08), transparent 28%),
        radial-gradient(circle at top right, rgba(14,165,233,0.08), transparent 24%),
        linear-gradient(180deg, var(--bg), var(--bg2));
      padding: 24px;
    }

    .shell {
      max-width: 1600px;
      margin: 0 auto;
    }

    .hero {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 18px;
    }

    .brand h1 {
      margin: 0;
      font-size: 30px;
      letter-spacing: -0.04em;
    }

    .brand p {
      margin: 6px 0 0;
      color: var(--muted);
      font-size: 14px;
    }

    .glass {
      background: var(--panel);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
      border: 1px solid rgba(255,255,255,0.6);
      box-shadow: var(--shadow);
      border-radius: var(--radius);
    }

    .topbar {
      padding: 16px;
      margin-bottom: 18px;
    }

    .top-grid {
      display: grid;
      grid-template-columns: 1fr 1fr auto auto;
      gap: 12px;
    }

    .layout {
      display: grid;
      grid-template-columns: 1.9fr 1fr;
      gap: 18px;
    }

    .left-stack,
    .right-stack {
      display: grid;
      gap: 18px;
    }

    .panel {
      padding: 18px;
    }

    .panel-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
      font-weight: 700;
      font-size: 15px;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 28px;
      height: 28px;
      padding: 0 10px;
      border-radius: 999px;
      background: var(--primary-soft);
      color: var(--primary);
      font-size: 12px;
      font-weight: 700;
    }

    input,
    button {
      border: 0;
      border-radius: 16px;
      padding: 13px 14px;
      font-size: 15px;
      font-family: inherit;
    }

    input {
      background: rgba(255,255,255,0.92);
      color: var(--text);
      outline: 1px solid rgba(15,23,42,0.08);
    }

    input:focus {
      outline: 2px solid rgba(79,70,229,0.22);
    }

    button {
      cursor: pointer;
      font-weight: 650;
      transition: transform 0.12s ease, opacity 0.12s ease, box-shadow 0.12s ease;
    }

    button:hover {
      transform: translateY(-1px);
    }

    button:disabled {
      opacity: 0.55;
      cursor: not-allowed;
      transform: none;
    }

    .btn-primary {
      background: var(--primary);
      color: white;
      box-shadow: 0 12px 26px rgba(79, 70, 229, 0.20);
    }

    .btn-soft {
      background: rgba(255,255,255,0.92);
      color: var(--text);
      outline: 1px solid rgba(15,23,42,0.08);
    }

    .btn-danger {
      background: rgba(220,38,38,0.10);
      color: var(--danger);
      outline: 1px solid rgba(220,38,38,0.12);
    }

    .btn-success {
      background: rgba(15,118,110,0.12);
      color: var(--success);
      outline: 1px solid rgba(15,118,110,0.12);
    }

    .btn-warn {
      background: rgba(180,83,9,0.12);
      color: var(--warning);
      outline: 1px solid rgba(180,83,9,0.12);
    }

    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }

    .status-box {
      display: grid;
      gap: 8px;
    }

    .status {
      color: var(--text);
      font-size: 14px;
      line-height: 1.5;
      white-space: pre-line;
    }

    .substatus {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
    }

    .videos {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(270px, 1fr));
      gap: 14px;
      align-items: start;
    }

    .video-card {
      background: var(--panel-strong);
      border: 1px solid rgba(255,255,255,0.7);
      border-radius: 24px;
      padding: 12px;
      box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08);
      min-height: 240px;
    }

    .video-card.screen-share {
      grid-column: 1 / -1;
      min-height: 320px;
      resize: both;
      overflow: auto;
    }

    .video-frame {
      background: linear-gradient(180deg, #dce4f2, #cad6ea);
      border-radius: 18px;
      overflow: hidden;
      min-height: 190px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .video-card.screen-share .video-frame {
      min-height: 360px;
    }

    video {
      width: 100%;
      height: 100%;
      min-height: 190px;
      max-height: 78vh;
      object-fit: contain;
      background: #d7e0ef;
    }

    .video-card.screen-share video {
      min-height: 340px;
    }

    .video-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 2px 2px;
    }

    .video-name {
      font-size: 14px;
      font-weight: 650;
      color: var(--text);
      word-break: break-word;
    }

    .video-pill {
      font-size: 11px;
      font-weight: 700;
      color: var(--primary);
      background: var(--primary-soft);
      border-radius: 999px;
      padding: 6px 8px;
    }

    .list,
    .chat-list,
    .log-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-height: 280px;
      overflow: auto;
    }

    .list-item,
    .chat-item,
    .log-item,
    .lobby-item {
      background: rgba(255,255,255,0.7);
      border: 1px solid rgba(255,255,255,0.7);
      border-radius: 18px;
      padding: 12px 13px;
      font-size: 14px;
      color: var(--text);
    }

    .lobby-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }

    .lobby-info {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .lobby-room {
      font-weight: 650;
    }

    .lobby-count {
      color: var(--muted);
      font-size: 12px;
    }

    .chat-item,
    .log-item {
      line-height: 1.45;
      word-break: break-word;
    }

    .chat-time,
    .log-time {
      color: var(--muted);
      font-size: 12px;
      margin-right: 8px;
    }

    .chat-name {
      font-weight: 700;
      color: var(--primary);
      margin-right: 6px;
    }

    .chat-controls {
      display: grid;
      gap: 10px;
      margin-top: 10px;
    }

    .chat-input-row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 10px;
    }

    .emoji-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .emoji-btn {
      background: rgba(255,255,255,0.92);
      outline: 1px solid rgba(15,23,42,0.08);
      padding: 9px 10px;
      font-size: 18px;
      line-height: 1;
    }

    .muted {
      color: var(--muted);
    }

    @media (max-width: 1180px) {
      .layout {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 900px) {
      .top-grid {
        grid-template-columns: 1fr;
      }

      .hero {
        flex-direction: column;
        align-items: flex-start;
      }

      .video-card.screen-share {
        min-width: 0;
      }

      .chat-input-row {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="hero">
      <div class="brand">
        <h1>Orbit Call</h1>
        <p>Soft modern rooms for voice, video, screen share, and chat.</p>
      </div>
      <button id="enableAudioBtn" class="btn-soft">Enable sound</button>
    </div>

    <div class="glass topbar">
      <div class="top-grid">
        <input id="nameInput" placeholder="Your name" />
        <input id="roomInput" placeholder="Room name, e.g. yle" />
        <button id="joinBtn" class="btn-primary">Join room</button>
        <button id="copyBtn" class="btn-soft">Copy room link</button>
      </div>
    </div>

    <div class="layout">
      <div class="left-stack">
        <div class="glass panel">
          <div class="controls">
            <button id="toggleMicBtn" class="btn-soft">Mute mic</button>
            <button id="toggleCamBtn" class="btn-soft">Turn off camera</button>
            <button id="shareScreenBtn" class="btn-success">Share screen</button>
            <button id="stopShareBtn" class="btn-warn" disabled>Stop sharing</button>
            <button id="leaveBtn" class="btn-danger">Leave</button>
          </div>
        </div>

        <div class="glass panel">
          <div class="status-box">
            <div class="status" id="status">Not connected</div>
            <div class="substatus" id="substatus">Stable handling mode enabled. Browser voice processing is used for better reliability.</div>
          </div>
        </div>

        <div class="videos" id="videosGrid">
          <div class="video-card" id="localCard">
            <div class="video-frame">
              <video id="localVideo" autoplay playsinline muted></video>
            </div>
            <div class="video-meta">
              <div class="video-name" id="localLabel">You</div>
              <div class="video-pill" id="localPill">Local</div>
            </div>
          </div>
        </div>
      </div>

      <div class="right-stack">
        <div class="glass panel">
          <div class="panel-title">
            <span>Online rooms</span>
            <span class="badge" id="lobbyBadge">0</span>
          </div>
          <div class="list" id="lobbyList">
            <div class="list-item muted">No active rooms</div>
          </div>
        </div>

        <div class="glass panel">
          <div class="panel-title">
            <span>Users in room</span>
            <span class="badge" id="countBadge">0</span>
          </div>
          <div class="list" id="usersList">
            <div class="list-item muted">No one connected yet</div>
          </div>
        </div>

        <div class="glass panel">
          <div class="panel-title">
            <span>Chat</span>
          </div>
          <div class="chat-list" id="chatMessages"></div>
          <div class="chat-controls">
            <div class="emoji-row">
              <button class="emoji-btn" data-emoji="😀">😀</button>
              <button class="emoji-btn" data-emoji="😂">😂</button>
              <button class="emoji-btn" data-emoji="🔥">🔥</button>
              <button class="emoji-btn" data-emoji="❤️">❤️</button>
              <button class="emoji-btn" data-emoji="👍">👍</button>
              <button class="emoji-btn" data-emoji="🎉">🎉</button>
            </div>
            <div class="chat-input-row">
              <input id="chatInput" placeholder="Write a message..." maxlength="500" />
              <button id="sendChatBtn" class="btn-primary">Send</button>
            </div>
          </div>
        </div>

        <div class="glass panel">
          <div class="panel-title">
            <span>Activity</span>
          </div>
          <div class="log-list" id="logs"></div>
        </div>
      </div>
    </div>
  </div>

<script>
(() => {
  const MAX_ROOM_SIZE = 10;

  const nameInput = document.getElementById("nameInput");
  const roomInput = document.getElementById("roomInput");
  const joinBtn = document.getElementById("joinBtn");
  const copyBtn = document.getElementById("copyBtn");
  const leaveBtn = document.getElementById("leaveBtn");
  const toggleMicBtn = document.getElementById("toggleMicBtn");
  const toggleCamBtn = document.getElementById("toggleCamBtn");
  const shareScreenBtn = document.getElementById("shareScreenBtn");
  const stopShareBtn = document.getElementById("stopShareBtn");
  const enableAudioBtn = document.getElementById("enableAudioBtn");

  const statusEl = document.getElementById("status");
  const substatusEl = document.getElementById("substatus");
  const localVideo = document.getElementById("localVideo");
  const localLabel = document.getElementById("localLabel");
  const localCard = document.getElementById("localCard");
  const videosGrid = document.getElementById("videosGrid");
  const usersList = document.getElementById("usersList");
  const countBadge = document.getElementById("countBadge");
  const lobbyBadge = document.getElementById("lobbyBadge");
  const lobbyList = document.getElementById("lobbyList");
  const chatMessages = document.getElementById("chatMessages");
  const chatInput = document.getElementById("chatInput");
  const sendChatBtn = document.getElementById("sendChatBtn");
  const logs = document.getElementById("logs");

  let ws = null;
  let room = "";
  let myName = "";
  let myId = null;
  let joined = false;
  let cleaningUp = false;

  let micEnabled = true;
  let camEnabled = true;
  let hasCamera = true;
  let isScreenSharing = false;

  let localStream = null;
  let cameraTrack = null;
  let screenTrack = null;

  const peerConnections = new Map();
  const remoteStreams = new Map();
  const remoteNames = new Map();
  const remoteMeta = new Map(); // peerId -> { isScreenSharing: false }
  let currentUsers = [];

  const params = new URLSearchParams(window.location.search);
  const roomFromUrl = params.get("room");
  if (roomFromUrl) roomInput.value = roomFromUrl;

  const savedName = localStorage.getItem("orbit_call_name");
  if (savedName) nameInput.value = savedName;

  function nowTime() {
    return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function addLog(text) {
    const el = document.createElement("div");
    el.className = "log-item";
    el.innerHTML = '<span class="log-time">' + nowTime() + '</span>' + escapeHtml(text);
    logs.prepend(el);
  }

  function addChatMessage(name, text, time, mine = false) {
    const el = document.createElement("div");
    el.className = "chat-item";
    el.innerHTML =
      '<span class="chat-time">' + escapeHtml(time || nowTime()) + '</span>' +
      '<span class="chat-name">' + escapeHtml(name) + (mine ? " (you)" : "") + ':</span>' +
      escapeHtml(text);
    chatMessages.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function clearChat() {
    chatMessages.innerHTML = "";
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function setSubstatus(text) {
    substatusEl.textContent = text;
  }

  function renderLobby(rooms) {
    const list = rooms || [];
    lobbyBadge.textContent = String(list.length);

    if (!list.length) {
      lobbyList.innerHTML = '<div class="list-item muted">No active rooms</div>';
      return;
    }

    lobbyList.innerHTML = "";
    for (const item of list) {
      const row = document.createElement("div");
      row.className = "lobby-item";

      const info = document.createElement("div");
      info.className = "lobby-info";
      info.innerHTML =
        '<div class="lobby-room">' + escapeHtml(item.room) + '</div>' +
        '<div class="lobby-count">' + item.count + ' online</div>';

      const btn = document.createElement("button");
      btn.className = "btn-soft";
      btn.textContent = "Use";
      btn.onclick = () => {
        roomInput.value = item.room;
      };

      row.appendChild(info);
      row.appendChild(btn);
      lobbyList.appendChild(row);
    }
  }

  function renderUsers(users) {
    currentUsers = users || [];
    countBadge.textContent = String(currentUsers.length);

    if (!currentUsers.length) {
      usersList.innerHTML = '<div class="list-item muted">No one connected yet</div>';
      return;
    }

    usersList.innerHTML = currentUsers.map((user) => {
      const me = user.id === myId ? " (you)" : "";
      return '<div class="list-item">' + escapeHtml(user.name + me) + '</div>';
    }).join("");

    remoteNames.clear();
    for (const user of currentUsers) {
      if (user.id !== myId) {
        remoteNames.set(user.id, user.name);
      }
    }
    updateRemoteLabels();
  }

  function updateRemoteLabels() {
    for (const [peerId, name] of remoteNames.entries()) {
      const label = document.getElementById("label-" + peerId);
      const pill = document.getElementById("pill-" + peerId);
      if (!label || !pill) continue;

      const meta = remoteMeta.get(peerId) || { isScreenSharing: false };
      label.textContent = name;
      pill.textContent = meta.isScreenSharing ? "Screen" : "Remote";
    }
  }

  function createRemoteCard(peerId, name) {
    if (document.getElementById("card-" + peerId)) return;

    const card = document.createElement("div");
    card.className = "video-card";
    card.id = "card-" + peerId;

    const frame = document.createElement("div");
    frame.className = "video-frame";

    const video = document.createElement("video");
    video.id = "video-" + peerId;
    video.autoplay = true;
    video.playsInline = true;

    frame.appendChild(video);

    const meta = document.createElement("div");
    meta.className = "video-meta";

    const label = document.createElement("div");
    label.className = "video-name";
    label.id = "label-" + peerId;
    label.textContent = name || "User";

    const pill = document.createElement("div");
    pill.className = "video-pill";
    pill.id = "pill-" + peerId;
    pill.textContent = "Remote";

    meta.appendChild(label);
    meta.appendChild(pill);

    card.appendChild(frame);
    card.appendChild(meta);
    videosGrid.appendChild(card);
  }

  function applyScreenShareStyleToCard(card, enabled) {
    if (!card) return;
    if (enabled) card.classList.add("screen-share");
    else card.classList.remove("screen-share");
  }

  function removeRemoteCard(peerId) {
    const card = document.getElementById("card-" + peerId);
    if (card) card.remove();
  }

  function getCurrentVideoTrack() {
    if (isScreenSharing && screenTrack) return screenTrack;
    if (cameraTrack && camEnabled) return cameraTrack;
    return null;
  }

  async function resumeRemoteMediaPlayback() {
    const videos = document.querySelectorAll("video");
    for (const video of videos) {
      try {
        await video.play();
      } catch {}
    }
  }

  async function startLocalMedia() {
    if (localStream) return localStream;

    let audioStream;
    try {
      audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
    } catch (err) {
      throw new Error("Could not access microphone.");
    }

    let videoStream = null;
    try {
      videoStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
    } catch {
      videoStream = null;
    }

    localStream = new MediaStream();

    const audioTrack = audioStream.getAudioTracks()[0];
    if (audioTrack) {
      localStream.addTrack(audioTrack);
    }

    cameraTrack = videoStream ? (videoStream.getVideoTracks()[0] || null) : null;
    hasCamera = !!cameraTrack;

    if (cameraTrack) {
      localStream.addTrack(cameraTrack);
    }

    localVideo.srcObject = localStream;
    applyScreenShareStyleToCard(localCard, false);

    if (!hasCamera) {
      toggleCamBtn.disabled = true;
      toggleCamBtn.textContent = "No camera found";
      setSubstatus("Audio-only mode. Camera was not found, but voice should still work.");
    } else {
      toggleCamBtn.disabled = false;
      toggleCamBtn.textContent = "Turn off camera";
      setSubstatus("Voice processing is enabled through the browser for more reliable audio.");
    }

    return localStream;
  }

  function countConnectedPeers() {
    let connected = 0;
    for (const pc of peerConnections.values()) {
      if (pc.connectionState === "connected") connected++;
    }
    return connected;
  }

  function updateGlobalStatus() {
    const others = Math.max(0, currentUsers.length - (myId ? 1 : 0));
    const connected = countConnectedPeers();

    let text = joined
      ? "Joined room: " + room + "\\nConnected peers: " + connected + "/" + others
      : "Not connected";

    if (!hasCamera && !isScreenSharing) {
      text += "\\nAudio-only mode";
    }

    if (isScreenSharing) {
      text += "\\nScreen sharing is active";
    }

    if (joined && others > 0 && connected < others) {
      text += "\\nSome users may still be connecting...";
    }

    setStatus(text);
  }

  function createPeerConnection(peerId, peerName, shouldInitiate) {
    if (peerConnections.has(peerId)) {
      return peerConnections.get(peerId);
    }

    remoteNames.set(peerId, peerName || "User");
    if (!remoteMeta.has(peerId)) {
      remoteMeta.set(peerId, { isScreenSharing: false });
    }

    createRemoteCard(peerId, peerName || "User");

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
      ]
    });

    peerConnections.set(peerId, pc);

    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      const videoTrack = getCurrentVideoTrack();

      if (audioTrack) {
        pc.addTrack(audioTrack, localStream);
      }
      if (videoTrack) {
        pc.addTrack(videoTrack, localStream);
      }
    }

    pc.onicecandidate = (event) => {
      if (!event.candidate || !ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({
        type: "candidate",
        room,
        target: peerId,
        candidate: event.candidate
      }));
    };

    pc.ontrack = async (event) => {
      let stream = remoteStreams.get(peerId);
      if (!stream) {
        stream = new MediaStream();
        remoteStreams.set(peerId, stream);
      }

      const exists = stream.getTracks().some((t) => t.id === event.track.id);
      if (!exists) {
        stream.addTrack(event.track);
      }

      const video = document.getElementById("video-" + peerId);
      if (video) {
        video.srcObject = stream;
        video.autoplay = true;
        video.playsInline = true;
        video.muted = false;
        try {
          await video.play();
        } catch {}
      }

      addLog("Receiving " + event.track.kind + " from " + (remoteNames.get(peerId) || "User"));
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      const peerDisplayName = remoteNames.get(peerId) || "User";

      if (state === "connected") {
        addLog("Connected with " + peerDisplayName);
      } else if (state === "failed") {
        addLog("Connection failed with " + peerDisplayName);
      } else if (state === "disconnected") {
        addLog("Disconnected from " + peerDisplayName);
      } else if (state === "closed") {
        addLog("Connection closed with " + peerDisplayName);
      }

      updateGlobalStatus();
    };

    if (shouldInitiate) {
      (async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);

          ws.send(JSON.stringify({
            type: "offer",
            room,
            target: peerId,
            sdp: pc.localDescription
          }));
        } catch (error) {
          addLog("Could not start connection with " + (peerName || "User"));
        }
      })();
    }

    return pc;
  }

  function closePeer(peerId) {
    const pc = peerConnections.get(peerId);
    if (pc) {
      try {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.onconnectionstatechange = null;
        pc.close();
      } catch {}
      peerConnections.delete(peerId);
    }

    remoteStreams.delete(peerId);
    remoteNames.delete(peerId);
    remoteMeta.delete(peerId);
    removeRemoteCard(peerId);
    updateGlobalStatus();
  }

  async function handleOffer(data) {
    const peerId = data.from;
    const peerName = data.name || "User";
    const pc = createPeerConnection(peerId, peerName, false);

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      ws.send(JSON.stringify({
        type: "answer",
        room,
        target: peerId,
        sdp: pc.localDescription
      }));
    } catch {
      addLog("Could not answer " + peerName);
    }
  }

  async function handleAnswer(data) {
    const pc = peerConnections.get(data.from);
    if (!pc) return;

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    } catch {}
  }

  async function handleCandidate(data) {
    const pc = peerConnections.get(data.from);
    if (!pc) return;

    try {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch {}
  }

  function syncPeerConnections(users) {
    const others = users.filter((u) => u.id !== myId);

    for (const user of others) {
      if (!peerConnections.has(user.id)) {
        const shouldInitiate = myId > user.id;
        createPeerConnection(user.id, user.name, shouldInitiate);
      }
    }

    for (const peerId of [...peerConnections.keys()]) {
      if (!others.find((u) => u.id === peerId)) {
        closePeer(peerId);
      }
    }
  }

  async function replaceVideoTrackForAllPeers(newTrack) {
    for (const pc of peerConnections.values()) {
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
      if (sender) {
        await sender.replaceTrack(newTrack);
      } else if (newTrack && localStream) {
        pc.addTrack(newTrack, localStream);
      }
    }
  }

  function broadcastScreenState(isSharing) {
    if (!ws || ws.readyState !== WebSocket.OPEN || !joined) return;
    ws.send(JSON.stringify({
      type: "screen-state",
      room,
      isScreenSharing: isSharing
    }));
  }

  async function startScreenShare() {
    if (!joined) {
      alert("Join a room first");
      return;
    }

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      });

      const newTrack = displayStream.getVideoTracks()[0];
      if (!newTrack) return;

      screenTrack = newTrack;
      isScreenSharing = true;

      await replaceVideoTrackForAllPeers(screenTrack);

      const preview = new MediaStream();
      const localAudio = localStream ? localStream.getAudioTracks()[0] : null;
      if (localAudio) preview.addTrack(localAudio);
      preview.addTrack(screenTrack);

      localVideo.srcObject = preview;
      applyScreenShareStyleToCard(localCard, true);

      shareScreenBtn.disabled = true;
      stopShareBtn.disabled = false;
      toggleCamBtn.disabled = true;

      localLabel.textContent = myName + " (you)";
      addLog("Started screen sharing");
      broadcastScreenState(true);
      updateGlobalStatus();

      screenTrack.onended = async () => {
        await stopScreenShare();
      };
    } catch {
      addLog("Screen sharing canceled or failed");
    }
  }

  async function stopScreenShare() {
    if (!isScreenSharing) return;

    isScreenSharing = false;

    if (screenTrack) {
      try { screenTrack.stop(); } catch {}
    }
    screenTrack = null;

    const restoredTrack = cameraTrack && camEnabled ? cameraTrack : null;
    await replaceVideoTrackForAllPeers(restoredTrack);

    const restored = new MediaStream();
    if (localStream) {
      const localAudio = localStream.getAudioTracks()[0];
      if (localAudio) restored.addTrack(localAudio);
    }
    if (restoredTrack) restored.addTrack(restoredTrack);

    localVideo.srcObject = restored;
    applyScreenShareStyleToCard(localCard, false);

    shareScreenBtn.disabled = false;
    stopShareBtn.disabled = true;

    if (hasCamera) {
      toggleCamBtn.disabled = false;
      toggleCamBtn.textContent = camEnabled ? "Turn off camera" : "Turn on camera";
    } else {
      toggleCamBtn.disabled = true;
      toggleCamBtn.textContent = "No camera found";
    }

    addLog("Stopped screen sharing");
    broadcastScreenState(false);
    updateGlobalStatus();
  }

  function sendChat() {
    const text = chatInput.value.trim();
    if (!text || !joined || !ws || ws.readyState !== WebSocket.OPEN) return;

    ws.send(JSON.stringify({
      type: "chat-message",
      room,
      text
    }));
    chatInput.value = "";
  }

  async function joinRoom() {
    if (joined || cleaningUp) return;

    myName = nameInput.value.trim();
    room = roomInput.value.trim();

    if (!myName) {
      alert("Enter your name");
      return;
    }

    if (!room) {
      alert("Enter a room name");
      return;
    }

    localStorage.setItem("orbit_call_name", myName);
    localLabel.textContent = myName + " (you)";

    try {
      await startLocalMedia();
      await resumeRemoteMediaPlayback();
    } catch (err) {
      alert(err.message || "Could not access your microphone.");
      return;
    }

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(protocol + "//" + location.host);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: "join",
        room,
        name: myName
      }));
    };

    ws.onmessage = async (msg) => {
      const data = JSON.parse(msg.data);

      if (data.type === "joined-ok") {
        joined = true;
        myId = data.yourId;
        clearChat();
        history.replaceState({}, "", "?room=" + encodeURIComponent(room));
        addLog("You joined room: " + room);
        updateGlobalStatus();
        return;
      }

      if (data.type === "room-history") {
        clearChat();
        for (const message of data.chat || []) {
          addChatMessage(message.name, message.text, message.time, message.id === myId);
        }
        return;
      }

      if (data.type === "room-users") {
        renderUsers(data.users);
        syncPeerConnections(data.users);
        updateGlobalStatus();
        return;
      }

      if (data.type === "lobby-list") {
        renderLobby(data.rooms);
        return;
      }

      if (data.type === "user-joined") {
        addLog(data.name + " joined the room");
        return;
      }

      if (data.type === "user-left") {
        addLog(data.name + " left the room");
        closePeer(data.id);
        return;
      }

      if (data.type === "screen-state") {
        const meta = remoteMeta.get(data.id) || { isScreenSharing: false };
        meta.isScreenSharing = !!data.isScreenSharing;
        remoteMeta.set(data.id, meta);

        const card = document.getElementById("card-" + data.id);
        applyScreenShareStyleToCard(card, meta.isScreenSharing);
        updateRemoteLabels();

        addLog((remoteNames.get(data.id) || data.name || "User") + (meta.isScreenSharing ? " started screen sharing" : " stopped screen sharing"));
        return;
      }

      if (data.type === "chat-message") {
        addChatMessage(data.name, data.text, data.time, data.id === myId);
        return;
      }

      if (data.type === "offer") {
        await handleOffer(data);
        return;
      }

      if (data.type === "answer") {
        await handleAnswer(data);
        return;
      }

      if (data.type === "candidate") {
        await handleCandidate(data);
        return;
      }

      if (data.type === "room-full") {
        alert("Room is full. Max " + MAX_ROOM_SIZE + " users.");
        await cleanup(true, false);
        return;
      }
    };

    ws.onclose = async () => {
      if (!cleaningUp && joined) {
        addLog("Disconnected from server");
        joined = false;
        myId = null;
        updateGlobalStatus();
      }
    };

    ws.onerror = () => {
      addLog("WebSocket connection error");
      setStatus("WebSocket connection error");
    };
  }

  async function cleanup(stopLocalMedia, sendLeave) {
    if (cleaningUp) return;
    cleaningUp = true;

    if (sendLeave && ws && ws.readyState === WebSocket.OPEN && joined) {
      try {
        ws.send(JSON.stringify({ type: "leave" }));
      } catch {}
    }

    for (const peerId of [...peerConnections.keys()]) {
      closePeer(peerId);
    }

    if (isScreenSharing) {
      try {
        await stopScreenShare();
      } catch {}
    }

    if (ws) {
      try {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.close();
      } catch {}
      ws = null;
    }

    if (stopLocalMedia && localStream) {
      for (const track of localStream.getTracks()) {
        try { track.stop(); } catch {}
      }
    }

    localStream = null;
    cameraTrack = null;
    screenTrack = null;

    joined = false;
    myId = null;
    hasCamera = true;
    isScreenSharing = false;
    micEnabled = true;
    camEnabled = true;

    remoteStreams.clear();
    remoteNames.clear();
    remoteMeta.clear();
    currentUsers = [];

    clearChat();
    renderUsers([]);
    localVideo.srcObject = null;
    applyScreenShareStyleToCard(localCard, false);

    toggleMicBtn.textContent = "Mute mic";
    toggleCamBtn.textContent = "Turn off camera";
    toggleCamBtn.disabled = false;
    shareScreenBtn.disabled = false;
    stopShareBtn.disabled = true;

    setStatus("Left room");
    setSubstatus("You are disconnected. Join again whenever you want.");

    cleaningUp = false;
  }

  async function leaveRoom() {
    addLog("You left the room");
    await cleanup(true, true);
  }

  toggleMicBtn.onclick = () => {
    if (!localStream) return;
    micEnabled = !micEnabled;
    for (const track of localStream.getAudioTracks()) {
      track.enabled = micEnabled;
    }
    toggleMicBtn.textContent = micEnabled ? "Mute mic" : "Unmute mic";
    addLog(micEnabled ? "Microphone unmuted" : "Microphone muted");
  };

  toggleCamBtn.onclick = async () => {
    if (!localStream || !hasCamera || isScreenSharing) return;

    camEnabled = !camEnabled;

    if (cameraTrack) {
      cameraTrack.enabled = camEnabled;
    }

    const replacement = camEnabled ? cameraTrack : null;
    await replaceVideoTrackForAllPeers(replacement);

    toggleCamBtn.textContent = camEnabled ? "Turn off camera" : "Turn on camera";
    addLog(camEnabled ? "Camera turned on" : "Camera turned off");
  };

  shareScreenBtn.onclick = startScreenShare;
  stopShareBtn.onclick = stopScreenShare;
  leaveBtn.onclick = leaveRoom;
  joinBtn.onclick = joinRoom;
  sendChatBtn.onclick = sendChat;

  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendChat();
  });

  document.querySelectorAll(".emoji-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      chatInput.value += btn.dataset.emoji;
      chatInput.focus();
    });
  });

  enableAudioBtn.onclick = async () => {
    await resumeRemoteMediaPlayback();
    addLog("Tried to enable all remote audio");
  };

  copyBtn.onclick = async () => {
    const roomVal = roomInput.value.trim();
    if (!roomVal) {
      alert("Enter room name first");
      return;
    }

    const link = location.origin + "/?room=" + encodeURIComponent(roomVal);
    try {
      await navigator.clipboard.writeText(link);
      addLog("Room link copied");
      setStatus("Copied: " + link);
    } catch {
      alert("Could not copy link");
    }
  };

  window.addEventListener("beforeunload", () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "leave" }));
      } catch {}
    }
  });

  setSubstatus("Stable handling mode enabled. Browser voice processing is used for better reliability.");
})();
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  ws.room = null;
  ws.userName = null;
  ws.clientId = Math.random().toString(36).slice(2, 10);

  ws.send(JSON.stringify({
    type: "lobby-list",
    rooms: getLobbyList()
  }));

  ws.on("message", (message) => {
    let data;
    try {
      data = JSON.parse(message.toString());
    } catch {
      return;
    }

    if (data.type === "join") {
      const roomName = String(data.room || "").trim();
      const userName = String(data.name || "Unknown").trim() || "Unknown";

      if (!roomName) return;

      const room = getOrCreateRoom(roomName);

      if (room.clients.size >= MAX_ROOM_SIZE) {
        ws.send(JSON.stringify({ type: "room-full" }));
        return;
      }

      ws.room = roomName;
      ws.userName = userName;
      room.clients.add(ws);

      ws.send(JSON.stringify({
        type: "joined-ok",
        yourId: ws.clientId
      }));

      ws.send(JSON.stringify({
        type: "room-history",
        chat: room.chat
      }));

      broadcastToRoom(roomName, {
        type: "user-joined",
        id: ws.clientId,
        name: ws.userName
      }, ws);

      broadcastRoomUsers(roomName);
      broadcastLobbyList();
      return;
    }

    if (data.type === "leave") {
      removeClientFromRoom(ws);
      return;
    }

    if (!ws.room) return;

    if (["offer", "answer", "candidate"].includes(data.type)) {
      const target = String(data.target || "").trim();
      if (!target) return;

      sendToClient(target, ws.room, {
        type: data.type,
        from: ws.clientId,
        name: ws.userName,
        sdp: data.sdp,
        candidate: data.candidate
      });
      return;
    }

    if (data.type === "screen-state") {
      broadcastToRoom(ws.room, {
        type: "screen-state",
        id: ws.clientId,
        name: ws.userName,
        isScreenSharing: !!data.isScreenSharing
      }, ws);
      return;
    }

    if (data.type === "chat-message") {
      const room = rooms.get(ws.room);
      if (!room) return;

      const text = String(data.text || "").trim().slice(0, 500);
      if (!text) return;

      const chatItem = {
        id: ws.clientId,
        name: ws.userName,
        text,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      };

      room.chat.push(chatItem);
      if (room.chat.length > 100) {
        room.chat.shift();
      }

      broadcastToRoom(ws.room, {
        type: "chat-message",
        ...chatItem
      });
      return;
    }
  });

  ws.on("close", () => {
    removeClientFromRoom(ws);
  });
});

server.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
