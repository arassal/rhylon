from setuptools import find_packages, setup

package_name = "rhylon_joystick"

setup(
    name=package_name,
    version="0.1.0",
    packages=find_packages(exclude=["test"]),
    data_files=[
        ("share/ament_index/resource_index/packages", [f"resource/{package_name}"]),
        (f"share/{package_name}", ["package.xml"]),
        (f"share/{package_name}/launch", ["launch/demo.launch.py"]),
        (f"share/{package_name}/rviz", ["rviz/rhylon_demo.rviz"]),
        (f"share/{package_name}/urdf", ["urdf/rhylon_car.urdf"]),
        (
            f"share/{package_name}/web",
            ["web/index.html", "web/app.js", "web/styles.css"],
        ),
    ],
    install_requires=["setuptools"],
    zip_safe=True,
    maintainer="Alex Assal",
    maintainer_email="184295395+arassal@users.noreply.github.com",
    description="Rhylon web joystick and simulated ROS 2 base.",
    license="MIT",
    entry_points={
        "console_scripts": [
            "web_bridge_node = rhylon_joystick.web_bridge_node:main",
            "sim_base_node = rhylon_joystick.sim_base_node:main",
        ],
    },
)
