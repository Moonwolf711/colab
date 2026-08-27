"""Load ~/.env into os.environ. Overrides existing vars (broken user-scope wins lose)."""
import os
import sys

NUL = chr(0)


def load(path: str = "~/.env") -> None:
    p = os.path.expanduser(path)
    if not os.path.exists(p):
        return
    with open(p, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            if NUL in line:
                # UTF-16 fragment appended by a PowerShell `>>` redirect into a
                # UTF-8 file. os.environ rejects NUL, and an uncaught ValueError
                # here aborts the whole load and kills the importing process.
                # Skip it; any valid earlier definition of the key still stands.
                sys.stderr.write(
                    "[_env] skipped NUL-corrupted line for key: "
                    + line.split("=", 1)[0].replace(NUL, "") + "\n")
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            if k.startswith("export "):
                k = k[len("export "):].strip()
            v = v.strip().strip('"').strip("'")
            if k:
                os.environ[k] = v
