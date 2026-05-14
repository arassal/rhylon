const modeProfiles = {
  N: {
    label: "Neutral",
    description: "Output clamped to zero so the chassis stays parked.",
    throttleScale: 0,
    turnScale: 0
  },
  D: {
    label: "Drive",
    description: "Balanced throttle curve for normal driving.",
    throttleScale: 0.72,
    turnScale: 0.55
  },
  S: {
    label: "Sport",
    description: "Sharper throttle and steering response for aggressive maneuvers.",
    throttleScale: 1,
    turnScale: 0.8
  },
  R: {
    label: "Reverse",
    description: "Throttle direction inverted while maintaining steering mix.",
    throttleScale: -0.6,
    turnScale: 0.45
  }
};

const state = {
  mode: "D",
  estop: false,
  connectionState: "booting",
  joystick: { x: 0, y: 0 },
  motors: { fl: 0, fr: 0, rl: 0, rr: 0 }
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
  inputThrottle: document.getElementById("inputThrottle"),
  inputTurn: document.getElementById("inputTurn"),
  mixFormula: document.getElementById("mixFormula"),
  modeButtons: Array.from(document.querySelectorAll(".mode-button"))
};

const wheelIds = ["fl", "fr", "rl", "rr"];

let dragPointerId = null;
let simulatedLinkTimer = null;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function deadband(value, threshold = 0.04) {
  return Math.abs(value) < threshold ? 0 : value;
}

function updateConnection(stateName, detail) {
  state.connectionState = stateName;
  elements.connectionDot.className = `dot dot-${stateName}`;
  elements.connectionText.textContent =
    stateName === "online" ? "Connected to simulator" :
    stateName === "offline" ? "Connection interrupted" :
    "Booting simulator...";
  elements.connectionSubtext.textContent = detail;
  elements.simState.textContent =
    stateName === "online" ? "Connected" :
    stateName === "offline" ? "Link Lost" :
    "Booting";
}

function setMode(mode) {
  state.mode = mode;
  elements.modeBadge.textContent = mode;
  elements.modeDescription.textContent = modeProfiles[mode].description;
  elements.modeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
  render();
}

function setEstop(active) {
  state.estop = active;
  elements.estopButton.classList.toggle("active", active);
  elements.estopButton.setAttribute("aria-pressed", String(active));
  elements.estopDetail.textContent = active ? "Outputs forced to zero" : "Motors armed";
  elements.joystick.classList.toggle("estop", active);
  render();
}

function setJoystickPosition(x, y) {
  state.joystick.x = deadband(clamp(x, -1, 1));
  state.joystick.y = deadband(clamp(y, -1, 1));
  render();
}

function resetJoystick() {
  state.joystick.x = 0;
  state.joystick.y = 0;
  elements.joystick.classList.remove("dragging");
  dragPointerId = null;
  render();
}

function updateJoystickFromPointer(clientX, clientY) {
  const rect = elements.joystick.getBoundingClientRect();
  const radius = Math.min(rect.width, rect.height) * 0.34;
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const dx = clientX - centerX;
  const dy = clientY - centerY;
  const distance = Math.hypot(dx, dy);
  const scale = distance > radius ? radius / distance : 1;

  const normalizedX = (dx * scale) / radius;
  const normalizedY = (dy * scale) / radius;
  setJoystickPosition(normalizedX, -normalizedY);
}

function calculateMotorMix() {
  const profile = modeProfiles[state.mode];
  const connected = state.connectionState === "online";
  if (!connected || state.estop) {
    return { fl: 0, fr: 0, rl: 0, rr: 0, throttle: 0, turn: 0 };
  }

  const throttle = state.joystick.y * profile.throttleScale;
  const turn = state.joystick.x * profile.turnScale;

  const left = clamp(throttle + turn, -1, 1);
  const right = clamp(throttle - turn, -1, 1);

  return {
    fl: left,
    rl: left,
    fr: right,
    rr: right,
    throttle,
    turn
  };
}

function renderMotors(mix) {
  state.motors = {
    fl: mix.fl,
    fr: mix.fr,
    rl: mix.rl,
    rr: mix.rr
  };

  wheelIds.forEach((wheelId) => {
    const value = state.motors[wheelId];
    const label = document.getElementById(`label-${wheelId}`);
    const bar = document.getElementById(`bar-${wheelId}`);
    const direction = document.getElementById(`dir-${wheelId}`);
    const percent = Math.round(value * 100);

    label.textContent = `${percent}%`;
    bar.style.width = `${Math.abs(percent)}%`;
    bar.classList.toggle("reverse", value < 0);
    bar.classList.toggle("idle", value === 0);
    direction.textContent =
      value > 0 ? "Forward torque" :
      value < 0 ? "Reverse torque" :
      "Idle";
  });
}

function renderTelemetry(mix) {
  elements.inputX.textContent = state.joystick.x.toFixed(2);
  elements.inputY.textContent = state.joystick.y.toFixed(2);
  elements.inputThrottle.textContent = `${Math.round(mix.throttle * 100)}%`;
  elements.inputTurn.textContent = `${Math.round(mix.turn * 100)}%`;
  elements.mixFormula.textContent = `left = clamp(${mix.throttle.toFixed(2)} + ${mix.turn.toFixed(2)}), right = clamp(${mix.throttle.toFixed(2)} - ${mix.turn.toFixed(2)})`;

  const rect = elements.joystick.getBoundingClientRect();
  const radius = Math.min(rect.width, rect.height) * 0.34;
  const x = state.joystick.x * radius;
  const y = -state.joystick.y * radius;
  elements.joystickHandle.style.transform = `translate(${x}px, ${y}px)`;
}

function render() {
  const mix = calculateMotorMix();
  renderMotors(mix);
  renderTelemetry(mix);
}

function simulateConnection() {
  updateConnection("pending", "Running startup checks and establishing heartbeat.");
  clearTimeout(simulatedLinkTimer);
  simulatedLinkTimer = setTimeout(() => {
    updateConnection("online", "Heartbeat stable at 20 Hz. Outputs are local-only and not wired to hardware.");
    render();
  }, 1100);

  setInterval(() => {
    if (state.connectionState !== "online") {
      return;
    }

    updateConnection("offline", "Simulated drop-out detected. Output commands are gated until the link recovers.");
    render();

    setTimeout(() => {
      updateConnection("online", "Link recovered. Heartbeat and local control simulation restored.");
      render();
    }, 1600);
  }, 14000);
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
  updateJoystickFromPointer(event.clientX, event.clientY);
});

elements.joystick.addEventListener("pointermove", (event) => {
  if (event.pointerId !== dragPointerId) {
    return;
  }
  updateJoystickFromPointer(event.clientX, event.clientY);
});

elements.joystick.addEventListener("pointerup", (event) => {
  if (event.pointerId === dragPointerId) {
    resetJoystick();
  }
});

elements.joystick.addEventListener("pointercancel", resetJoystick);
elements.joystick.addEventListener("lostpointercapture", resetJoystick);

window.addEventListener("resize", render);

setMode(state.mode);
setEstop(false);
simulateConnection();
render();
