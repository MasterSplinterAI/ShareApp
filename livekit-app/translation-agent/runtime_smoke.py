"""Validate the built agent runtime without connecting to rooms or providers."""

import importlib
import os
from pathlib import Path
import py_compile
import subprocess
import sys


def main() -> None:
    root = Path(__file__).resolve().parent
    # Optional imports in the agents can hide missing provider dependencies.
    for provider in ("deepgram", "openai", "gladia", "xai", "silero", "noise_cancellation"):
        importlib.import_module(f"livekit.plugins.{provider}")
        print(f"Runtime import OK: {provider}", flush=True)

    py_compile.compile(str(root / "agent_lifecycle.py"), doraise=True)
    py_compile.compile(str(root / "agent_launcher.py"), doraise=True)
    for name in ("transcription_only_agent", "transcription_codeswitch_agent"):
        script = root / f"{name}.py"
        py_compile.compile(str(script), doraise=True)
        module = importlib.import_module(name)
        # Call the loader directly: the production prewarm wrapper intentionally
        # catches errors, whereas an image with a broken VAD must fail this check.
        module.TranscriptionOnlyAgent()._load_shared_vad()
        subprocess.run(
            [sys.executable, "-u", str(root / "agent_launcher.py"), "start", "--help"],
            cwd=root,
            env={"PATH": os.defpath, "PYTHONUNBUFFERED": "1", "AGENT_MODULE": name},
            check=True,
            timeout=30,
        )
        print(f"Runtime startup and Silero OK: {name}", flush=True)


if __name__ == "__main__":
    main()
