const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const MAX_ROOM_SIZE = 10;
const rooms = new Map();

function getRoom(roomName) {
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
    .map(([name, room]) => ({
      room: name,
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

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Fast Call Room</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      background: #0f172a;
      color: white;
      min-height: 100vh;
      padding: 20px;
    }
    .app {
      width: 100%;
      max-width: 1550px;
      margin: 0 auto;
      background: #111827;
      border-radius: 18px;
      padding: 20px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.35);
    }
    h1 {
      margin: 0 0 16px 0;
      font-size: 28px;
    }
    .top {
      display: grid;
      grid-template-columns: 1fr 1fr auto auto;
      gap: 12px;
      margin-bottom: 16px;
    }
    input, button, textarea {
      border: none;
      border-radius: 12px;
      padding: 12px 14px;
      font-size: 16px;
      font-family: inherit;
    }
    input, textarea {
      background: #1f2937;
      color: white;
      width: 100%;
    }
    button {
      cursor: pointer;
      background: #2563eb;
      color: white;
      font-weight: 600;
      white-space: nowrap;
    }
    button:hover { opacity: 0.95; }
    button.secondary { background: #374151; }
    button.danger { background: #dc2626; }
    button.success { background: #059669; }
    button.warning { background: #d97706; }
    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .layout {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 18px;
    }
    .panel {
      background: #0b1220;
      border-radius: 16px;
      padding: 14px;
    }
    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 14px;
    }
    .status {
      color: #93c5fd;
      font-size: 14px;
      min-height: 22px;
      white-space: pre-line;
    }
    .small {
      font-size: 13px;
      color: #94a3b8;
      margin-top: 8px;
    }
    .videos {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 14px;
      margin-top: 16px;
      align-items: start;
    }
    .video-card {
      background: #0b1220;
      border-radius: 16px;
      padding: 12px;
      min-width: 0;
      min-height: 240px;
    }
    .video-card.screen-share {
      grid-column: 1 / -1;
      resize: both;
      overflow: auto;
      min-width: 360px;
      min-height: 260px;
      max-width: 100%;
    }
    video {
      width: 100%;
      border-radius: 12px;
      background: black;
      min-height: 180px;
      max-height: 75vh;
      object-fit: contain;
    }
    .video-card.screen-share video {
      min-height: 240px;
    }
    .label {
      margin-top: 8px;
      color: #cbd5e1;
      font-size: 14px;
      word-break: break-word;
    }
    .section-title {
      font-size: 16px;
      font-weight: 700;
      margin-bottom: 10px;
    }
    .users, .lobby-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .user-item, .lobby-item {
      background: #111827;
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 12px;
      padding: 10px 12px;
      font-size: 14px;
    }
    .lobby-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .lobby-item button {
      padding: 8px 10px;
      font-size: 13px;
    }
    .logs, .chat-messages {
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 260px;
      overflow: auto;
    }
    .log-item, .chat-item {
      background: #111827;
      border-radius: 12px;
      padding: 10px 12px;
      font-size: 13px;
      color: #d1d5db;
      word-break: break-word;
    }
    .log-time, .chat-time {
      color: #93c5fd;
      margin-right: 8px;
    }
    .chat-name {
      color: #c4b5fd;
      font-weight: 700;
      margin-right: 6px;
    }
    .badge {
      display: inline-block;
      padding: 5px 9px;
      border-radius: 999px;
      background: #1e3a8a;
      color: #dbeafe;
      font-size: 12px;
      margin-left: 8px;
      vertical-align: middle;
    }
    .chat-input-row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 10px;
      margin-top: 10px;
    }
    .chat-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
    }
    .emoji-btn {
      background: #1f2937;
      padding: 8px 10px;
      font-size: 18px;
      line-height: 1;
    }
    .right-stack {
      display: grid;
      gap: 16px;
    }

    @media (max-width: 1100px) {
      .layout {
        grid-template-columns: 1fr;
      }
    }
    @media (max-width: 980px) {
      .top {
        grid-template-columns: 1fr;
      }
      .video-card.screen-share {
        min-width: 0;
      }
    }
  </style>
</head>
<body>
  <div class="app">
    <h1>Fast Call Room</h1>

    <div class="top">
      <input id="nameInput" placeholder="Your name" />
      <input id="roomInput" placeholder="Room name, e.g. friends123" />
      <button id="joinBtn">Join room</button>
      <button id="copyBtn" class="secondary">Copy room link</button>
    </div>

    <div class="layout">
      <div>
        <div class="controls">
          <button id="toggleMicBtn" class="secondary">Mute mic</button>
          <button id="toggleCamBtn" class="secondary">Turn off camera</button>
          <button id="shareScreenBtn" class="success">Share screen</button>
          <button id="stopShareBtn" class="warning" disabled>Stop sharing</button>
          <button id="leaveBtn" class="danger">Leave</button>
        </div>

        <div class="panel">
          <div class="status" id="status">Not connected</div>
          <div class="small" id="modeText">Custom mic filter enabled. Chat and lobby list added.</div>
        </div>

        <div class="videos" id="videosGrid">
          <div class="video-card" id="localCard">
            <video id="localVideo" autoplay playsinline muted></video>
            <div class="label" id="localLabel">You</div>
          </div>
        </div>
      </div>

      <div class="right-stack">
        <div class="panel">
          <div class="section-title">
            Online rooms
            <span class="badge" id="lobbyBadge">0</span>
          </div>
          <div class="lobby-list" id="lobbyList">
            <div class="lobby-item">No active rooms</div>
          </div>
        </div>

        <div class="panel">
          <div class="section-title">
            Users in room
            <span class="badge" id="countBadge">0</span>
          </div>
          <div class="users" id="usersList">
            <div class="user-item">No one connected yet</div>
          </div>
        </div>

        <div class="panel">
          <div class="section-title">Chat</div>
          <div class="chat-messages" id="chatMessages"></div>
          <div class="chat-actions">
            <button class="emoji-btn" data-emoji="😀">😀</button>
            <button class="emoji-btn" data-emoji="😂">😂</button>
            <button class="emoji-btn" data-emoji="🔥">🔥</button>
            <button class="emoji-btn" data-emoji="❤️">❤️</button>
            <button class="emoji-btn" data-emoji="👍">👍</button>
            <button class="emoji-btn" data-emoji="🎉">🎉</button>
          </div>
          <div class="chat-input-row">
            <input id="chatInput" placeholder="Write a message..." maxlength="500" />
            <button id="sendChatBtn">Send</button>
          </div>
        </div>

        <div class="panel">
          <div class="section-title">Activity</div>
          <div class="logs" id="logs"></div>
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
  const statusEl = document.getElementById("status");
  const modeText = document.getElementById("modeText");
  const localVideo = document.getElementById("localVideo");
  const localLabel = document.getElementById("localLabel");
  const localCard = document.getElementById("localCard");
  const videosGrid = document.getElementById("videosGrid");
  const usersList = document.getElementById("usersList");
  const countBadge = document.getElementById("countBadge");
  const logs = document.getElementById("logs");
  const lobbyList = document.getElementById("lobbyList");
  const lobbyBadge = document.getElementById("lobbyBadge");
  const chatMessages = document.getElementById("chatMessages");
  const chatInput = document.getElementById("chatInput");
  const sendChatBtn = document.getElementById("sendChatBtn");

  let ws = null;
  let room = "";
  let myName = "";
  let myId = null;
  let joined = false;
  let micEnabled = true;
  let camEnabled = true;
  let hasCamera = true;
  let isScreenSharing = false;
  let cameraTrack = null;
  let screenTrack = null;

  let localStream = null;
  let audioContext = null;
  let rawMicStream = null;
  let processedAudioTrack = null;

  const peerConnections = new Map();
  const remoteStreams = new Map();
  const remoteNames = new Map();
  const peerMeta = new Map();
  let currentUsers = [];

  const params = new URLSearchParams(window.location.search);
  const roomFromUrl = params.get("room");
  if (roomFromUrl) roomInput.value = roomFromUrl;

  const savedName = localStorage.getItem("fast_call_name");
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
      '<span class="chat-name">' + escapeHtml(name) + (mine ? ' (you)' : '') + ':</span> ' +
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

  function updateModeText() {
    const parts = [];
    parts.push(hasCamera ? "Camera + mic mode" : "Audio-only mode");
    parts.push("Custom mic filter on");
    parts.push(isScreenSharing ? "Screen sharing active" : "No screen sharing");
    parts.push(joined ? "Chat enabled" : "Join room to chat");
    modeText.textContent = parts.join(" • ");
  }

  function renderUsers(users) {
    currentUsers = users || [];
    countBadge.textContent = String(currentUsers.length);

    if (!currentUsers.length) {
      usersList.innerHTML = '<div class="user-item">No one connected yet</div>';
      return;
    }

    usersList.innerHTML = currentUsers.map((user) => {
      const me = user.id === myId ? " (you)" : "";
      return '<div class="user-item">' + escapeHtml(user.name + me) + '</div>';
    }).join("");

    remoteNames.clear();
    for (const user of currentUsers) {
      if (user.id !== myId) {
        remoteNames.set(user.id, user.name);
      }
    }

    updateRemoteLabels();
  }

  function renderLobby(rooms) {
    const list = rooms || [];
    lobbyBadge.textContent = String(list.length);

    if (!list.length) {
      lobbyList.innerHTML = '<div class="lobby-item">No active rooms</div>';
      return;
    }

    lobbyList.innerHTML = "";
    for (const item of list) {
      const wrapper = document.createElement("div");
      wrapper.className = "lobby-item";

      const info = document.createElement("div");
      info.textContent = item.room + " (" + item.count + " online)";

      const btn = document.createElement("button");
      btn.className = "secondary";
      btn.textContent = "Join";
      btn.onclick = () => {
        roomInput.value = item.room;
      };

      wrapper.appendChild(info);
      wrapper.appendChild(btn);
      lobbyList.appendChild(wrapper);
    }
  }

  function updateRemoteLabels() {
    for (const [peerId, name] of remoteNames.entries()) {
      const label = document.getElementById("label-" + peerId);
      if (!label) continue;
      const meta = peerMeta.get(peerId);
      const suffix = meta && meta.isScreenSharing ? " • screen" : "";
      label.textContent = name + suffix;
    }
  }

  async function listDevicesInfo() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return {
        audioInputs: devices.filter(d => d.kind === "audioinput").length,
        videoInputs: devices.filter(d => d.kind === "videoinput").length
      };
    } catch {
      return { audioInputs: 0, videoInputs: 0 };
    }
  }

  async function createProcessedAudioTrack() {
    rawMicStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      },
      video: false
    });

    audioContext = new (window.AudioContext || window.webkitAudioContext)();

    const source = audioContext.createMediaStreamSource(rawMicStream);
    const highpass = audioContext.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 100;

    const lowpass = audioContext.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 7200;

    const compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 20;
    compressor.ratio.value = 10;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.2;

    const gainNode = audioContext.createGain();
    gainNode.gain.value = 1.0;

    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;

    const destination = audioContext.createMediaStreamDestination();

    source.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(compressor);
    compressor.connect(gainNode);
    gainNode.connect(analyser);
    gainNode.connect(destination);

    const data = new Uint8Array(analyser.fftSize);
    const gateThreshold = 0.018;

    function noiseGateTick() {
      if (!audioContext) return;

      analyser.getByteTimeDomainData(data);

      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }

      const rms = Math.sqrt(sum / data.length);

      if (micEnabled) {
        gainNode.gain.setTargetAtTime(rms < gateThreshold ? 0.03 : 1.0, audioContext.currentTime, 0.02);
      } else {
        gainNode.gain.setTargetAtTime(0.0, audioContext.currentTime, 0.01);
      }

      requestAnimationFrame(noiseGateTick);
    }

    noiseGateTick();

    processedAudioTrack = destination.stream.getAudioTracks()[0];
    return processedAudioTrack;
  }

  async function startMedia() {
    if (localStream) return localStream;

    const info = await listDevicesInfo();
    const audioTrack = await createProcessedAudioTrack();

    try {
      const camStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });

      cameraTrack = camStream.getVideoTracks()[0] || null;
      hasCamera = !!cameraTrack;

      localStream = new MediaStream();
      localStream.addTrack(audioTrack);
      if (cameraTrack) localStream.addTrack(cameraTrack);

      localVideo.srcObject = localStream;
      localCard.classList.remove("screen-share");
      updateModeText();
      setStatus("Mic and camera access granted");
      return localStream;
    } catch (err) {
      console.error("Camera error:", err);

      localStream = new MediaStream();
      localStream.addTrack(audioTrack);
      cameraTrack = null;
      hasCamera = false;

      localVideo.srcObject = localStream;
      toggleCamBtn.disabled = true;
      toggleCamBtn.textContent = "No camera found";
      localCard.classList.remove("screen-share");
      updateModeText();
      setStatus(
        "Camera unavailable. Joined with microphone only.\\n" +
        "Mics found: " + info.audioInputs + " | Cameras found: " + info.videoInputs
      );
      return localStream;
    }
  }

  function createRemoteCard(peerId, name) {
    if (document.getElementById("card-" + peerId)) return;

    const card = document.createElement("div");
    card.className = "video-card";
    card.id = "card-" + peerId;

    const video = document.createElement("video");
    video.id = "video-" + peerId;
    video.autoplay = true;
    video.playsInline = true;

    const label = document.createElement("div");
    label.className = "label";
    label.id = "label-" + peerId;
    label.textContent = name || "User";

    card.appendChild(video);
    card.appendChild(label);
    videosGrid.appendChild(card);
  }

  function applyScreenShareCardStyle(peerId, enabled) {
    const card = document.getElementById("card-" + peerId);
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
    if (cameraTrack) return cameraTrack;
    return null;
  }

  function createPeerConnection(peerId, peerName, shouldInitiate) {
    if (peerConnections.has(peerId)) return peerConnections.get(peerId);

    remoteNames.set(peerId, peerName || "User");
    if (!peerMeta.has(peerId)) {
      peerMeta.set(peerId, { isScreenSharing: false });
    }
    createRemoteCard(peerId, peerName || "User");

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
      ]
    });

    peerConnections.set(peerId, pc);

    pc.onicecandidate = (event) => {
      if (!event.candidate || !ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({
        type: "candidate",
        room,
        target: peerId,
        candidate: event.candidate
      }));
    };

    pc.ontrack = (event) => {
      let stream = remoteStreams.get(peerId);
      if (!stream) {
        stream = new MediaStream();
        remoteStreams.set(peerId, stream);
      }

      const alreadyHasTrack = stream.getTracks().some(t => t.id === event.track.id);
      if (!alreadyHasTrack) {
        stream.addTrack(event.track);
      }

      const video = document.getElementById("video-" + peerId);
      if (video) {
        video.srcObject = stream;
        video.autoplay = true;
        video.playsInline = true;
        video.muted = false;
        video.play().catch(() => {});
      }

      addLog("Receiving " + event.track.kind + " from " + (remoteNames.get(peerId) || "User"));
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      const peerDisplayName = remoteNames.get(peerId) || "User";

      if (state === "connected") addLog("Connected with " + peerDisplayName);
      else if (state === "failed") addLog("Connection failed with " + peerDisplayName);
      else if (state === "disconnected") addLog("Disconnected from " + peerDisplayName);
      else if (state === "closed") addLog("Connection closed with " + peerDisplayName);

      updateGlobalStatus();
    };

    if (localStream) {
      if (processedAudioTrack) pc.addTrack(processedAudioTrack, localStream);
      const videoTrack = getCurrentVideoTrack();
      if (videoTrack) pc.addTrack(videoTrack, localStream);
    }

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
          console.error("Offer error", error);
          addLog("Could not start connection with " + (peerName || "User"));
        }
      })();
    }

    return pc;
  }

  function closePeer(peerId) {
    const pc = peerConnections.get(peerId);
    if (pc) {
      pc.close();
      peerConnections.delete(peerId);
    }
    remoteStreams.delete(peerId);
    remoteNames.delete(peerId);
    peerMeta.delete(peerId);
    removeRemoteCard(peerId);
    updateGlobalStatus();
  }

  function countConnectedPeers() {
    let connected = 0;
    for (const pc of peerConnections.values()) {
      if (pc.connectionState === "connected") connected++;
    }
    return connected;
  }

  function updateGlobalStatus() {
    const totalOthers = Math.max(0, currentUsers.length - (myId ? 1 : 0));
    const connectedPeers = countConnectedPeers();

    let text = joined
      ? "Joined room: " + room + "\\nConnected peers: " + connectedPeers + "/" + totalOthers
      : "Not connected";

    if (!hasCamera && !isScreenSharing) text += "\\nAudio-only mode";
    if (isScreenSharing) text += "\\nScreen sharing is active";
    if (joined && totalOthers > 0 && connectedPeers < totalOthers) {
      text += "\\nSome users may still be connecting...";
    }

    setStatus(text);
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
    } catch (error) {
      console.error("Offer handling error", error);
      addLog("Could not answer " + peerName);
    }
  }

  async function handleAnswer(data) {
    const peerId = data.from;
    const pc = peerConnections.get(peerId);
    if (!pc) return;

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    } catch (error) {
      console.error("Answer handling error", error);
    }
  }

  async function handleCandidate(data) {
    const peerId = data.from;
    const pc = peerConnections.get(peerId);
    if (!pc) return;

    try {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (error) {
      console.error("ICE error", error);
    }
  }

  function syncPeerConnections(users) {
    const otherUsers = users.filter(u => u.id !== myId);

    for (const user of otherUsers) {
      if (!peerConnections.has(user.id)) {
        const shouldInitiate = myId > user.id;
        createPeerConnection(user.id, user.name, shouldInitiate);
      }
    }

    for (const peerId of [...peerConnections.keys()]) {
      if (!otherUsers.find(u => u.id === peerId)) {
        closePeer(peerId);
      }
    }
  }

  async function replaceVideoTrackForAllPeers(newTrack) {
    for (const [peerId, pc] of peerConnections.entries()) {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === "video");

      if (sender) {
        await sender.replaceTrack(newTrack);
      } else if (newTrack && localStream) {
        pc.addTrack(newTrack, localStream);
      }

      const meta = peerMeta.get(peerId) || { isScreenSharing: false };
      peerMeta.set(peerId, meta);
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

      const newScreenTrack = displayStream.getVideoTracks()[0];
      if (!newScreenTrack) return;

      screenTrack = newScreenTrack;
      isScreenSharing = true;

      await replaceVideoTrackForAllPeers(screenTrack);

      const previewStream = new MediaStream();
      if (processedAudioTrack) previewStream.addTrack(processedAudioTrack);
      previewStream.addTrack(screenTrack);

      localVideo.srcObject = previewStream;
      localCard.classList.add("screen-share");

      shareScreenBtn.disabled = true;
      stopShareBtn.disabled = false;
      toggleCamBtn.disabled = true;
      localLabel.textContent = myName + " (you • sharing screen)";
      addLog("Started screen sharing");
      updateModeText();
      updateGlobalStatus();
      broadcastScreenState(true);

      screenTrack.onended = async () => {
        await stopScreenShare();
      };
    } catch (error) {
      console.error("Screen share error", error);
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

    const restoredTrack = cameraTrack || null;
    await replaceVideoTrackForAllPeers(restoredTrack);

    const restoredStream = new MediaStream();
    if (processedAudioTrack) restoredStream.addTrack(processedAudioTrack);
    if (restoredTrack) restoredStream.addTrack(restoredTrack);

    localVideo.srcObject = restoredStream;
    localCard.classList.remove("screen-share");

    shareScreenBtn.disabled = false;
    stopShareBtn.disabled = true;

    if (hasCamera) {
      toggleCamBtn.disabled = false;
      toggleCamBtn.textContent = camEnabled ? "Turn off camera" : "Turn on camera";
    } else {
      toggleCamBtn.disabled = true;
      toggleCamBtn.textContent = "No camera found";
    }

    localLabel.textContent = myName + " (you)";
    addLog("Stopped screen sharing");
    updateModeText();
    updateGlobalStatus();
    broadcastScreenState(false);
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
    if (joined) return;

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

    localStorage.setItem("fast_call_name", myName);
    localLabel.textContent = myName + " (you)";

    try {
      await startMedia();
    } catch {
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
        updateModeText();
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
        const meta = peerMeta.get(data.id) || { isScreenSharing: false };
        meta.isScreenSharing = !!data.isScreenSharing;
        peerMeta.set(data.id, meta);
        applyScreenShareCardStyle(data.id, meta.isScreenSharing);
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
        cleanup(true);
        return;
      }
    };

    ws.onclose = () => {
      if (joined) addLog("Disconnected from server");
      updateGlobalStatus();
    };

    ws.onerror = () => {
      addLog("WebSocket connection error");
      setStatus("WebSocket connection error");
    };
  }

  async function cleanup(stopLocal) {
    joined = false;
    myId = null;

    if (ws) {
      ws.close();
      ws = null;
    }

    for (const peerId of [...peerConnections.keys()]) {
      closePeer(peerId);
    }

    renderUsers([]);
    clearChat();

    if (stopLocal) {
      if (screenTrack) {
        try { screenTrack.stop(); } catch {}
      }
      screenTrack = null;
      isScreenSharing = false;

      if (localStream) {
        localStream.getTracks().forEach(track => {
          try { track.stop(); } catch {}
        });
      }
      localStream = null;

      if (rawMicStream) {
        rawMicStream.getTracks().forEach(track => {
          try { track.stop(); } catch {}
        });
      }
      rawMicStream = null;
      processedAudioTrack = null;

      if (audioContext) {
        try { await audioContext.close(); } catch {}
      }
      audioContext = null;

      cameraTrack = null;
      localVideo.srcObject = null;

      hasCamera = true;
      toggleCamBtn.disabled = false;
      toggleCamBtn.textContent = "Turn off camera";
      shareScreenBtn.disabled = false;
      stopShareBtn.disabled = true;
      localCard.classList.remove("screen-share");
      updateModeText();
    }
  }

  async function leaveRoom() {
    addLog("You left the room");
    await cleanup(true);
    setStatus("Left room");
  }

  toggleMicBtn.onclick = () => {
    micEnabled = !micEnabled;
    if (processedAudioTrack) processedAudioTrack.enabled = micEnabled;
    toggleMicBtn.textContent = micEnabled ? "Mute mic" : "Unmute mic";
    addLog(micEnabled ? "Microphone unmuted" : "Microphone muted");
  };

  toggleCamBtn.onclick = async () => {
    if (!localStream || !hasCamera || isScreenSharing) return;
    camEnabled = !camEnabled;
    if (cameraTrack) cameraTrack.enabled = camEnabled;
    toggleCamBtn.textContent = camEnabled ? "Turn off camera" : "Turn on camera";
    addLog(camEnabled ? "Camera turned on" : "Camera turned off");
  };

  shareScreenBtn.onclick = startScreenShare;
  stopShareBtn.onclick = stopScreenShare;
  leaveBtn.onclick = () => { leaveRoom(); };
  joinBtn.onclick = joinRoom;
  sendChatBtn.onclick = sendChat;

  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendChat();
  });

  document.querySelectorAll(".emoji-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      chatInput.value += btn.dataset.emoji;
      chatInput.focus();
    });
  });

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

  updateModeText();
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

      const room = getRoom(roomName);

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
    const roomName = ws.room;
    if (!roomName || !rooms.has(roomName)) {
      broadcastLobbyList();
      return;
    }

    const room = rooms.get(roomName);
    room.clients.delete(ws);

    broadcastToRoom(roomName, {
      type: "user-left",
      id: ws.clientId,
      name: ws.userName
    });

    if (room.clients.size === 0) {
      rooms.delete(roomName);
    } else {
      broadcastRoomUsers(roomName);
    }

    broadcastLobbyList();
  });
});

server.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
