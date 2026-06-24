"""Launch stable or experimental translation agent modules from one Docker image."""

from __future__ import annotations

import os
import runpy
import sys


def main() -> None:
    module = os.getenv("AGENT_MODULE", "transcription_only_agent").strip()
    if module.endswith(".py"):
        module = module[:-3]
    if not module:
        module = "transcription_only_agent"
    sys.argv = [f"{module}.py", *sys.argv[1:]]
    runpy.run_module(module, run_name="__main__")


if __name__ == "__main__":
    main()
