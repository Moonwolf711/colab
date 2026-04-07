#!/usr/bin/env python3
"""setup.py for cli-anything-max.

Install (dev): pip install -e .
Install (user): pip install .

NOTE: The `cli_anything/` directory MUST NOT contain an ``__init__.py``.
PEP 420 implicit namespace packaging is what lets cli-anything-max coexist
with cli-anything-ableton (and future cli-anything-* packages) in the same
Python environment. If a sibling package ships an ``__init__.py`` at the
namespace level, Python will treat cli_anything as a regular package and
`import cli_anything.max` will FAIL even though our source is on sys.path.
"""

from setuptools import setup, find_namespace_packages
from pathlib import Path

here = Path(__file__).parent
long_description = ""
max_md = here / "MAX.md"
if max_md.exists():
    long_description = max_md.read_text(encoding="utf-8")

setup(
    name="cli-anything-max",
    version="0.1.0",
    author="coLaB contributors",
    description=(
        "CLI harness for Cycling '74 Max 9. Manipulates .maxpat / .amxd "
        "files directly and drives a running Max instance via an OSC/UDP "
        "control patch. Requires: Max 9 installed."
    ),
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/Moonwolf711/colab",
    packages=find_namespace_packages(include=["cli_anything.*"]),
    package_data={
        "cli_anything.max": ["data/*.maxpat", "data/*.js"],
    },
    include_package_data=True,
    python_requires=">=3.10",
    install_requires=[
        "click>=8.0.0",
        "python-osc>=1.8.0",
        "prompt-toolkit>=3.0.0",
    ],
    extras_require={
        "dev": ["pytest>=7.0.0"],
    },
    entry_points={
        "console_scripts": [
            "cli-anything-max=cli_anything.max.max_cli:main",
        ],
    },
    classifiers=[
        "Development Status :: 4 - Beta",
        "Intended Audience :: Developers",
        "Topic :: Multimedia :: Sound/Audio",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
        "Programming Language :: Python :: 3.13",
        "Operating System :: Microsoft :: Windows",
        "Operating System :: MacOS",
    ],
    zip_safe=False,
)
