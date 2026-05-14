import asyncio
import os
import threading
from typing import Any

import rclpy
import uvicorn
from ament_index_python.packages import get_package_share_directory
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from geometry_msgs.msg import Twist
from rclpy.node import Node
from std_msgs.msg import Bool, Float32MultiArray


MODE_PROFILES: dict[str, dict[str, float]] = {
    "N": {"linear": 0.0, "lateral": 0.0, "angular": 0.0},
    "D": {"linear": 0.9, "lateral": 0.7, "angular": 1.2},
    "S": {"linear": 1.2, "lateral": 1.0, "angular": 1.8},
    "R": {"linear": -0.7, "lateral": 0.5, "angular": 1.0},
}


class RhylonWebBridge(Node):
    def __init__(self) -> None:
        super().__init__("rhylon_web_bridge")

        self.declare_parameter("web_port", 8080)
        self.web_port = int(self.get_parameter("web_port").value)

        self.cmd_pub = self.create_publisher(Twist, "/cmd_vel", 10)
        self.estop_pub = self.create_publisher(Bool, "/rhylon/estop", 10)
        self.create_subscription(Float32MultiArray, "/rhylon/motor_states", self.motor_callback, 10)

        self.controller_lock = threading.Lock()
        self.latest_motor_state = [0.0, 0.0, 0.0, 0.0]
        self.latest_connection = "online"
        self.active_websocket: WebSocket | None = None
        self.mode = "D"
        self.estop = False

        self.get_logger().info(f"Rhylon web bridge serving on port {self.web_port}")

    def motor_callback(self, msg: Float32MultiArray) -> None:
        data = list(msg.data[:4])
        if len(data) < 4:
            data = data + [0.0] * (4 - len(data))
        self.latest_motor_state = data

    def publish_stop(self) -> None:
        self.cmd_pub.publish(Twist())

    def publish_estop(self, enabled: bool) -> None:
        self.estop = enabled
        msg = Bool()
        msg.data = enabled
        self.estop_pub.publish(msg)
        if enabled:
            self.publish_stop()

    def publish_control(self, x: float, y: float, twist: float) -> None:
        profile = MODE_PROFILES[self.mode]
        msg = Twist()
        msg.linear.x = float(y) * profile["linear"]
        msg.linear.y = float(x) * profile["lateral"]
        msg.angular.z = float(twist) * profile["angular"]
        if self.estop or self.mode == "N":
            msg = Twist()
        self.cmd_pub.publish(msg)

    def get_state(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "estop": self.estop,
            "connection": self.latest_connection,
            "motors": {
                "fl": self.latest_motor_state[0],
                "fr": self.latest_motor_state[1],
                "rl": self.latest_motor_state[2],
                "rr": self.latest_motor_state[3],
            },
        }


def create_app(node: RhylonWebBridge) -> FastAPI:
    app = FastAPI()
    static_dir = os.path.join(get_package_share_directory("rhylon_joystick"), "web")

    @app.get("/")
    async def root():
        return FileResponse(os.path.join(static_dir, "index.html"))

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        with node.controller_lock:
            if node.active_websocket is not None:
                await websocket.accept()
                await websocket.send_json({"error": "Another controller is already connected"})
                await websocket.close(code=1008)
                return

        await websocket.accept()
        with node.controller_lock:
            node.active_websocket = websocket

        try:
            await websocket.send_json(node.get_state())
            while True:
                data = await websocket.receive_json()
                msg_type = data.get("type")

                if msg_type == "control":
                    node.publish_control(
                        float(data.get("x", 0.0)),
                        float(data.get("y", 0.0)),
                        float(data.get("twist", 0.0)),
                    )
                elif msg_type == "mode":
                    mode = str(data.get("value", "D"))
                    if mode in MODE_PROFILES:
                        node.mode = mode
                        if mode == "N":
                            node.publish_stop()
                elif msg_type == "estop":
                    node.publish_estop(bool(data.get("value", False)))
                elif msg_type == "ping":
                    node.latest_connection = "online"

                await websocket.send_json(node.get_state())
        except WebSocketDisconnect:
            pass
        finally:
            node.publish_estop(True)
            with node.controller_lock:
                node.active_websocket = None
            node.get_logger().warning("Controller disconnected, e-stop asserted")

    @app.middleware("http")
    async def no_cache(request, call_next):
        response = await call_next(request)
        if request.url.path.endswith((".js", ".css")):
            response.headers["Cache-Control"] = "no-store"
        return response

    app.mount("/static", StaticFiles(directory=static_dir, follow_symlink=True), name="static")
    return app


def main(args=None) -> None:
    rclpy.init(args=args)
    node = RhylonWebBridge()

    spin_thread = threading.Thread(target=rclpy.spin, args=(node,), daemon=True)
    spin_thread.start()

    app = create_app(node)
    config = uvicorn.Config(app, host="0.0.0.0", port=node.web_port, log_level="info")
    server = uvicorn.Server(config)

    try:
        asyncio.run(server.serve())
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.try_shutdown()
