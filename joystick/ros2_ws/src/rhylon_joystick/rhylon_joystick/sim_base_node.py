import math

import rclpy
from geometry_msgs.msg import Quaternion, TransformStamped, Twist
from nav_msgs.msg import Odometry
from rclpy.node import Node
from sensor_msgs.msg import JointState
from std_msgs.msg import Bool, Float32MultiArray
from tf2_ros import TransformBroadcaster
from visualization_msgs.msg import Marker, MarkerArray


def quaternion_from_yaw(yaw: float) -> Quaternion:
    q = Quaternion()
    q.z = math.sin(yaw / 2.0)
    q.w = math.cos(yaw / 2.0)
    return q


class RhylonSimBase(Node):
    def __init__(self) -> None:
        super().__init__("rhylon_sim_base")

        self.declare_parameter("wheel_radius", 0.024)
        self.declare_parameter("track_width", 0.18)
        self.declare_parameter("wheel_base", 0.22)
        self.declare_parameter("max_linear_speed", 1.2)
        self.declare_parameter("max_angular_speed", 1.8)
        self.declare_parameter("publish_rate_hz", 30.0)

        self.wheel_radius = float(self.get_parameter("wheel_radius").value)
        self.track_width = float(self.get_parameter("track_width").value)
        self.wheel_base = float(self.get_parameter("wheel_base").value)
        self.max_linear_speed = float(self.get_parameter("max_linear_speed").value)
        self.max_angular_speed = float(self.get_parameter("max_angular_speed").value)
        self.publish_rate_hz = float(self.get_parameter("publish_rate_hz").value)

        self.cmd = Twist()
        self.estop = False
        self.pose_x = 0.0
        self.pose_y = 0.0
        self.pose_yaw = 0.0
        self.wheel_positions = {
            "front_left_wheel_joint": 0.0,
            "front_right_wheel_joint": 0.0,
            "rear_left_wheel_joint": 0.0,
            "rear_right_wheel_joint": 0.0,
        }
        self.last_update = self.get_clock().now()

        self.create_subscription(Twist, "/cmd_vel", self.cmd_callback, 10)
        self.create_subscription(Bool, "/rhylon/estop", self.estop_callback, 10)

        self.odom_pub = self.create_publisher(Odometry, "/odom", 10)
        self.joint_pub = self.create_publisher(JointState, "/joint_states", 10)
        self.motor_pub = self.create_publisher(Float32MultiArray, "/rhylon/motor_states", 10)
        self.marker_pub = self.create_publisher(MarkerArray, "/rhylon/markers", 10)
        self.tf_broadcaster = TransformBroadcaster(self)

        self.create_timer(1.0 / self.publish_rate_hz, self.update)
        self.get_logger().info("Rhylon simulated base ready")

    def cmd_callback(self, msg: Twist) -> None:
        self.cmd = msg

    def estop_callback(self, msg: Bool) -> None:
        self.estop = bool(msg.data)
        if self.estop:
            self.cmd = Twist()

    def normalize(self, *values: float) -> list[float]:
        limit = max(1.0, max(abs(v) for v in values))
        return [v / limit for v in values]

    def compute_wheel_mix(self) -> tuple[float, float, float, float]:
        if self.estop:
            return 0.0, 0.0, 0.0, 0.0

        vx = max(-self.max_linear_speed, min(self.max_linear_speed, self.cmd.linear.x))
        vy = max(-self.max_linear_speed, min(self.max_linear_speed, self.cmd.linear.y))
        wz = max(-self.max_angular_speed, min(self.max_angular_speed, self.cmd.angular.z))
        lever = (self.wheel_base + self.track_width) / 2.0

        fl = vx - vy - lever * wz
        fr = vx + vy + lever * wz
        rl = vx + vy - lever * wz
        rr = vx - vy + lever * wz
        return tuple(self.normalize(fl, fr, rl, rr))

    def publish_tf(self, stamp, orientation: Quaternion) -> None:
        tf = TransformStamped()
        tf.header.stamp = stamp
        tf.header.frame_id = "odom"
        tf.child_frame_id = "base_link"
        tf.transform.translation.x = self.pose_x
        tf.transform.translation.y = self.pose_y
        tf.transform.translation.z = 0.0
        tf.transform.rotation = orientation
        self.tf_broadcaster.sendTransform(tf)

    def publish_odom(self, stamp, orientation: Quaternion) -> None:
        odom = Odometry()
        odom.header.stamp = stamp
        odom.header.frame_id = "odom"
        odom.child_frame_id = "base_link"
        odom.pose.pose.position.x = self.pose_x
        odom.pose.pose.position.y = self.pose_y
        odom.pose.pose.orientation = orientation
        odom.twist.twist = self.cmd if not self.estop else Twist()
        self.odom_pub.publish(odom)

    def publish_joints(self, stamp, wheel_mix: tuple[float, float, float, float], dt: float) -> None:
        names = list(self.wheel_positions.keys())
        wheel_speed_scale = 9.0
        velocities = [wheel_speed_scale * value for value in wheel_mix]

        for name, velocity in zip(names, velocities):
            self.wheel_positions[name] += velocity * dt

        joint_state = JointState()
        joint_state.header.stamp = stamp
        joint_state.name = names
        joint_state.position = [self.wheel_positions[name] for name in names]
        joint_state.velocity = velocities
        self.joint_pub.publish(joint_state)

    def publish_motor_state(self, wheel_mix: tuple[float, float, float, float]) -> None:
        msg = Float32MultiArray()
        msg.data = [float(value) for value in wheel_mix]
        self.motor_pub.publish(msg)

    def publish_markers(self, stamp, wheel_mix: tuple[float, float, float, float]) -> None:
        labels = ("FL", "FR", "RL", "RR")
        positions = (
            (0.11, 0.10, 0.06),
            (0.11, -0.10, 0.06),
            (-0.11, 0.10, 0.06),
            (-0.11, -0.10, 0.06),
        )
        marker_array = MarkerArray()
        for marker_id, (label, pos, mix) in enumerate(zip(labels, positions, wheel_mix)):
            marker = Marker()
            marker.header.stamp = stamp
            marker.header.frame_id = "base_link"
            marker.ns = "rhylon_motors"
            marker.id = marker_id
            marker.type = Marker.TEXT_VIEW_FACING
            marker.action = Marker.ADD
            marker.pose.position.x = pos[0]
            marker.pose.position.y = pos[1]
            marker.pose.position.z = pos[2]
            marker.scale.z = 0.05
            marker.color.a = 1.0
            marker.color.r = 0.95 if mix < 0.0 else 0.2
            marker.color.g = 0.85 if mix >= 0.0 else 0.3
            marker.color.b = 0.25
            marker.text = f"{label} {mix:+.2f}"
            marker_array.markers.append(marker)
        self.marker_pub.publish(marker_array)

    def update(self) -> None:
        now = self.get_clock().now()
        dt = (now - self.last_update).nanoseconds / 1e9
        self.last_update = now
        if dt <= 0.0:
            return

        vx = 0.0 if self.estop else self.cmd.linear.x
        vy = 0.0 if self.estop else self.cmd.linear.y
        wz = 0.0 if self.estop else self.cmd.angular.z

        world_vx = math.cos(self.pose_yaw) * vx - math.sin(self.pose_yaw) * vy
        world_vy = math.sin(self.pose_yaw) * vx + math.cos(self.pose_yaw) * vy
        self.pose_x += world_vx * dt
        self.pose_y += world_vy * dt
        self.pose_yaw += wz * dt

        wheel_mix = self.compute_wheel_mix()
        stamp = now.to_msg()
        orientation = quaternion_from_yaw(self.pose_yaw)
        self.publish_tf(stamp, orientation)
        self.publish_odom(stamp, orientation)
        self.publish_joints(stamp, wheel_mix, dt)
        self.publish_motor_state(wheel_mix)
        self.publish_markers(stamp, wheel_mix)


def main(args=None) -> None:
    rclpy.init(args=args)
    node = RhylonSimBase()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.try_shutdown()
