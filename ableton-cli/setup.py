#!/usr/bin/env python3
"""
setup.py for cli-anything-ableton

Install with: pip install -e .
"""

from setuptools import setup, find_namespace_packages

setup(
    name="cli-anything-ableton",
    version="1.0.0",
    author="coLaB contributors",
    author_email="",
    description="CLI harness for Ableton Live via AbletonOSC. Requires: Ableton Live 11+ with AbletonOSC MIDI Remote Script.",
    long_description=open("ABLETON.md", "r", encoding="utf-8").read()
    if __import__("os").path.exists("ABLETON.md")
    else "",
    long_description_content_type="text/markdown",
    url="https://github.com/colab/ableton-cli",
    packages=find_namespace_packages(include=["cli_anything.*"]),
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "Topic :: Multimedia :: Sound/Audio",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
    ],
    python_requires=">=3.10",
    install_requires=[
        "click>=8.0.0",
        "python-osc>=1.8.0",
        "prompt-toolkit>=3.0.0",
    ],
    extras_require={
        "dev": [
            "pytest>=7.0.0",
            "pytest-cov>=4.0.0",
        ],
    },
    entry_points={
        "console_scripts": [
            "ableton=cli_anything.ableton.ableton_cli:main",
        ],
    },
    include_package_data=True,
    zip_safe=False,
)
