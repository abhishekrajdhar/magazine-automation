"""Command line entry point: ``python -m pressflow_bridge [--check | --once | --fonts]``."""

from __future__ import annotations

import argparse
import json
import sys

from . import __version__
from .check import run_check
from .config import Config
from .logsetup import setup_logging
from .worker import Bridge


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pressflow-bridge", description="PressFlow AI InDesign bridge worker")
    parser.add_argument("--check", action="store_true", help="print diagnostics (API, token, InDesign) and exit; renders nothing")
    parser.add_argument("--once", action="store_true", help="process at most one job, then exit")
    parser.add_argument("--fonts", action="store_true", help="run list-fonts.jsx in InDesign and print the result")
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    args = parser.parse_args(argv)

    try:
        config = Config.from_env()
    except ValueError as exc:
        print(f"configuration error: {exc}", file=sys.stderr)
        return 2
    setup_logging(config.log_format, config.log_level)

    if args.check:
        return run_check(config, sys.stdout)

    if args.fonts:
        bridge = Bridge(config)
        config.work_dir.mkdir(parents=True, exist_ok=True)
        bridge.collect_fonts()
        print(json.dumps({"indesignVersion": bridge.indesign_version, "fonts": bridge.fonts}, indent=2))
        return 0 if bridge.fonts else 1

    problems = config.problems()
    if problems:
        for p in problems:
            print(f"configuration error: {p}", file=sys.stderr)
        return 2
    bridge = Bridge(config)
    bridge.install_signal_handlers()
    try:
        bridge.run_forever(once=args.once)
    except KeyboardInterrupt:
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
