from setuptools import find_namespace_packages, setup

setup(
    name="cli-anything-mlr",
    version="0.1.0",
    description="Agent-native invoice commands backed by Miller",
    packages=find_namespace_packages(include=["cli_anything.*"]),
    python_requires=">=3.10",
    install_requires=["click>=8.0"],
    entry_points={"console_scripts": ["cli-anything-mlr=cli_anything.mlr.mlr_cli:main"]},
    package_data={"cli_anything.mlr": ["skills/SKILL.md"]},
)
