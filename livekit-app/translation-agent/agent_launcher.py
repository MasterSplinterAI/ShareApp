"""Launch stable or experimental translation agent modules from one Docker image."""

from __future__ import annotations

import os
import re
from pathlib import Path
import sys

ALLOWED_MODULES = frozenset({"transcription_only_agent", "transcription_codeswitch_agent"})


def main() -> None:
    module = os.getenv("AGENT_MODULE", "transcription_only_agent")
    if module not in ALLOWED_MODULES:
        print("Invalid AGENT_MODULE: expected transcription_only_agent or transcription_codeswitch_agent", file=sys.stderr)
        raise SystemExit(2)
    build_ref = os.getenv("AGENT_BUILD_REF") or os.getenv("GIT_COMMIT") or "unset"
    build_ref = build_ref if re.fullmatch(r"[a-fA-F0-9]{7,40}", build_ref) else "unset"
    os.environ["LALIA_PRIVATE_LOG_OUTPUT"] = "1"
    print(f"Lalia agent startup: module={module} build_ref={build_ref!r}", flush=True)
    script = Path(__file__).resolve().with_name(f"{module}.py")
    # Replace the launcher: the real worker keeps PID 1 and receives signals
    # directly, without shell expansion or a long-lived supervisor process.
    os.execv(sys.executable, [sys.executable, "-u", str(script), *sys.argv[1:]])


if __name__ == "__main__":
    main()
