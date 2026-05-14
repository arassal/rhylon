# Rhylon ROS 2 Demo

This workspace turns the joystick concept into a ROS 2-friendly demo:

- browser joystick served by a ROS 2 node
- publishes `geometry_msgs/msg/Twist` on `/cmd_vel`
- publishes e-stop on `/rhylon/estop`
- simulated 4-wheel holonomic base
- `odom -> base_link` TF
- `joint_states` for wheel rotation
- RViz config for robot model, odometry, TF, and motor markers

## Intended Run Flow

```bash
cd joystick/ros2_ws
colcon build
source install/setup.bash
ros2 launch rhylon_joystick demo.launch.py
```

Then open `http://localhost:8080`.

## Nav2 Compatibility

This demo is aligned with the interfaces Nav2 expects:

- `/cmd_vel` for commanded motion
- `/odom` for odometry
- `odom -> base_link` TF

That means you can later replace the web joystick with Nav2 planners/controllers or remap Nav2 output into the same simulated base.

## Limits

- This is a kinematic simulator, not Gazebo or Isaac.
- The current environment where this repo was prepared does not have `ros2`, `rviz2`, or `colcon`, so it was scaffolded but not executed here.
