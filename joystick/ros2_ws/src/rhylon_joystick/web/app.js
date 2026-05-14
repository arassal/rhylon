const modeProfiles = {
  N: { description: "Neutral mode holds `/cmd_vel` at zero." },
  D: { description: "Balanced command scaling for normal operation." },
  S: { description: "Higher translational and rotational command scaling." },
  R: { description: "Reverse-biased forward axis for backing maneuvers." }
};

const state = {
  mode: "D",
  estop: false,
  joystick: { x: 0, y: 0, twist: 0 },
  motors: { fl: 0, fr: 0, rl: 0, rr: 0 },
  socket: null
};

const elements = {
  joystick: document.getElementById("joystick"),
  joystickHandle: document.getElementById("joystickHandle"),
  estopButton: document.getElementById("estopButton"),
  estopDetail: document.getElementById("estopDetail"),
  connectionDot: document.getElementById("connectionDot"),
  connectionText: document.getElementById("connectionText"),
  connectionSubtext: document.getElementById("connectionSubtext"),
  modeDescription: document.getElementById("modeDescription"),
  modeBadge: document.getElementById("modeBadge"),
  simState: document.getElementById("simState"),
  inputX: document.getElementById("inputX"),
  inputY: document.getElementById("inputY"),
  inputTwist: document.getElementById("inputTwist"),
  modeButtons: Array.from(document.querySelectorAll(".mode-button"))
};

const wheelIds = ["fl", "fr", "rl", "rr"];
let dragPointerId = null;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function deadband(value, threshold = 0.04) {
  return Math.abs(value) < threshold ? 0 : value;
}

function updateConnection(kind, label, detail) {
  elements.connectionDot.className = `dot dot-${kind}`;
  elements.connectionText.textContent = label;
  elements.connectionSubtext.textContent = detail;
}

function sendMessage(payload) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    return;
  }
  state.socket.send(JSON.stringify(payload));
}

function renderMotors() {
  wheelIds.forEach((wheelId) => {
    const value = state.motors[wheelId] || 0;
    const label = document.getElementById(`label-${wheelId}`);
    const bar = document.getElementById(`bar-${wheelId}`);
    const direction = document.getElementById(`dir-${wheelId}`);
    const percent = Math.round(value * 100);

    label.textContent = `${percent}%`;
    bar.style.width = `${Math.abs(percent)}%`;
    bar.classList.toggle("reverse", value < 0);
    bar.classList.toggle("idle", value === 0);
    direction.textContent = value > 0 ? "Forward torque" : value < 0 ? "Reverse torque" : "Idle";
  });
}

function renderTelemetry() {
  elements.inputX.textContent = state.joystick.x.toFixed(2);
  elements.inputY.textContent = state.joystick.y.toFixed(2);
  elements.inputTwist.textContent = state.joystick.twist.toFixed(2);
  elements.modeDescription.textContent = modeProfiles[state.mode].description;
  elements.modeBadge.textContent = state.mode;

  const rect = elements.joystick.getBoundingClientRect();
  const radius = Math.min(rect.width, rect.height) * 0.34;
  const x = state.joystick.x * radius;
  const y = -state.joystick.y * radius;
  elements.joystickHandle.style.transform = `translate(${x}px, ${y}px)`;
}

function render() {
  renderTelemetry();
  renderMotors();
}

function setMode(mode) {
  state.mode = mode;
  elements.modeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
  sendMessage({ type: "mode", value: mode });
  render();
}

function setEstop(active) {
  state.estop = active;
  elements.estopButton.classList.toggle("active", active);
  elements.estopButton.setAttribute("aria-pressed", String(active));
  elements.estopDetail.textContent = active ? "Zeroing `/cmd_vel` and asserting `/rhylon/estop`" : "ROS control enabled";
  elements.joystick.classList.toggle("estop", active);
  sendMessage({ type: "estop", value: active });
}

function setJoystickPosition(x, y, twist) {
  state.joystick.x = deadband(clamp(x, -1, 1));
  state.joystick.y = deadband(clamp(y, -1, 1));
  state.joystick.twist = deadband(clamp(twist, -1, 1));
  sendMessage({
    type: "control",
    x: state.joystick.x,
    y: state.joystick.y,
    twist: state.joystick.twist
  });
  render();
}

function resetJoystick() {
  state.joystick = { x: 0, y: 0, twist: 0 };
  dragPointerId = null;
  elements.joystick.classList.remove("dragging");
  sendMessage({ type: "control", x: 0, y: 0, twist: 0 });
  render();
}

function updateJoystickFromPointer(event) {
  const rect = elements.joystick.getBoundingClientRect();
  const radius = Math.min(rect.width, rect.height) * 0.34;
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const dx = event.clientX - centerX;
  const dy = event.clientY - centerY;
  const distance = Math.hypot(dx, dy);
  const scale = distance > radius ? radius / distance : 1;
  const normalizedX = (dx * scale) / radius;
  const normalizedY = (dy * scale) / radius;
  const twist = event.shiftKey ? normalizedX : normalizedX * 0.5;
  setJoystickPosition(normalizedX, -normalizedY, twist);
}

function connectSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
  state.socket = socket;

  updateConnection("pending", "Connecting to ROS bridge...", "Waiting for `/cmd_vel` bridge and simulated base.");

  socket.addEventListener("open", () => {
    updateConnection("online", "Connected to ROS bridge", "Web UI is driving `/cmd_vel` and listening for wheel mix updates.");
    elements.simState.textContent = "Bridge Online";
    sendMessage({ type: "mode", value: state.mode });
    sendMessage({ type: "estop", value: state.estop });
  });

  socket.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    if (data.error) {
      updateConnection("offline", "Controller rejected", data.error);
      return;
    }
    state.mode = data.mode || state.mode;
    state.estop = Boolean(data.estop);
    state.motors = data.motors || state.motors;
    elements.simState.textContent = data.connection === "online" ? "Bridge Online" : "Bridge Sync";
    render();
  });

  socket.addEventListener("close", () => {
    updateConnection("offline", "Bridge disconnected", "The web node is offline or restarting. Retrying in 2 seconds.");
    elements.simState.textContent = "Bridge Offline";
    window.setTimeout(connectSocket, 2000);
  });

  socket.addEventListener("error", () => {
    updateConnection("offline", "Bridge error", "Could not reach the ROS bridge.");
  });
}

elements.modeButtons.forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});

elements.estopButton.addEventListener("click", () => {
  setEstop(!state.estop);
});

elements.joystick.addEventListener("pointerdown", (event) => {
  dragPointerId = event.pointerId;
  elements.joystick.setPointerCapture(event.pointerId);
  elements.joystick.classList.add("dragging");
  updateJoystickFromPointer(event);
});

elements.joystick.addEventListener("pointermove", (event) => {
  if (event.pointerId !== dragPointerId) {
    return;
  }
  updateJoystickFromPointer(event);
});

elements.joystick.addEventListener("pointerup", (event) => {
  if (event.pointerId === dragPointerId) {
    resetJoystick();
  }
});

elements.joystick.addEventListener("pointercancel", resetJoystick);
elements.joystick.addEventListener("lostpointercapture", resetJoystick);
window.addEventListener("resize", render);
window.setInterval(() => sendMessage({ type: "ping" }), 1000);

render();
connectSocket();
