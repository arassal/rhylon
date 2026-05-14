# Rhylon Joystick PoC

Standalone browser proof-of-concept for a four-wheel drive joystick control UI. It is intentionally local-only and simulates connection state, drive modes, e-stop behavior, and wheel motor outputs without talking to hardware or external services.

## Run locally

From the repo root:

```bash
cd /home/alexander/rhylon/joystick
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## What it demonstrates

- HomeGenie-style full-screen joystick workflow adapted into a standalone web UI
- Drive modes: `Neutral`, `Drive`, `Sport`, `Reverse`
- E-stop gating that forces all four motor outputs to zero
- Simulated connection boot, periodic link drop, and recovery states
- Live front-left, front-right, rear-left, and rear-right motor output bars
- Local steering mix using `left = throttle + turn`, `right = throttle - turn`
