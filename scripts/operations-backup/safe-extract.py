#!/usr/bin/env python3
"""Extract only regular upload files/directories; reject links, traversal and secrets."""
import pathlib
import sys
import tarfile

def extract(archive, destination):
    with tarfile.open(archive, "r:gz") as bundle:
        members = bundle.getmembers()
        seen = set()
        for member in members:
            name = pathlib.PurePosixPath(member.name)
            if name.is_absolute() or ".." in name.parts or not (member.isfile() or member.isdir()):
                raise ValueError("Unsafe archive entry")
            if any(part.lower() == ".env" or part.lower().startswith(".env.") for part in name.parts):
                raise ValueError("Secret file in archive")
            if str(name) in seen:
                raise ValueError("Duplicate archive entry")
            seen.add(str(name))
        bundle.extractall(destination, members=members)

if __name__ == "__main__":
    try:
        extract(sys.argv[1], sys.argv[2])
    except Exception:
        print("Archive validation failed", file=sys.stderr)
        sys.exit(1)
