# Rhylon Joystick PoC

Standalone browser proof-of-concept for a four-wheel drive joystick control UI. It is intentionally local-only and simulates connection state, drive modes, e-stop behavior, and wheel motor outputs without talking to hardware or external services.

There is now also a ROS 2-oriented workspace at `ros2_ws/` for a proper `/cmd_vel` + RViz path.

## Run locally

From the repo root:

```bash
cd /home/alexander/rhylon/joystick
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## ROS 2 path

The ROS 2 workspace is here:

```bash
cd /home/alexander/rhylon/joystick/ros2_ws
```

It includes:

- a web bridge node that serves a joystick page and publishes `/cmd_vel`
- a simulated 4-wheel base
- a URDF model
- an RViz configuration

See [ros2_ws/README.md](/home/alexander/rhylon/joystick/ros2_ws/README.md) for the intended launch flow.

## What it demonstrates

- full-screen joystick workflow adapted into a standalone web UI
- Drive modes: `Neutral`, `Drive`, `Sport`, `Reverse`
- E-stop gating that forces all four motor outputs to zero
- Simulated connection boot, periodic link drop, and recovery states
- Live front-left, front-right, rear-left, and rear-right motor output bars
- Local steering mix using `left = throttle + turn`, `right = throttle - turn`
