import os

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.conditions import IfCondition
from launch.substitutions import Command, LaunchConfiguration
from launch_ros.actions import Node


def generate_launch_description():
    pkg_share = get_package_share_directory("rhylon_joystick")
    use_rviz = LaunchConfiguration("use_rviz")
    web_port = LaunchConfiguration("web_port")

    robot_description = Command(["cat ", os.path.join(pkg_share, "urdf", "rhylon_car.urdf")])

    return LaunchDescription(
        [
            DeclareLaunchArgument("use_rviz", default_value="true"),
            DeclareLaunchArgument("web_port", default_value="8080"),
            Node(
                package="robot_state_publisher",
                executable="robot_state_publisher",
                name="robot_state_publisher",
                parameters=[{"robot_description": robot_description}],
                output="screen",
            ),
            Node(
                package="rhylon_joystick",
                executable="sim_base_node",
                name="rhylon_sim_base",
                output="screen",
            ),
            Node(
                package="rhylon_joystick",
                executable="web_bridge_node",
                name="rhylon_web_bridge",
                parameters=[{"web_port": web_port}],
                output="screen",
            ),
            Node(
                package="rviz2",
                executable="rviz2",
                name="rviz2",
                arguments=["-d", os.path.join(pkg_share, "rviz", "rhylon_demo.rviz")],
                output="screen",
                condition=IfCondition(use_rviz),
            ),
        ]
    )
