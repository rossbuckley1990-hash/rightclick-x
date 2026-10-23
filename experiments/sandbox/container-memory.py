"""Bounded cached-image cgroup diagnostic; not an Actenon integration result.

No network, host mounts, credentials, pull, writable root, or privileged container.
Creates at most one 64 MiB container at a time and removes its exact ID in finally.
"""
import json
import pathlib
import subprocess
import sys
import time

image, destination = sys.argv[1:]
if not image.startswith("sha256:") or len(image) != 71:
    raise ValueError("use the exact already-cached image digest")
out = pathlib.Path(destination)
out.mkdir(exist_ok=False, parents=True)


def call(args, timeout=15):
    result = subprocess.run(["docker", *args], text=True, capture_output=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


rows = []
for mib in (16, 128):
    # Touch all bytes. Report the kernel's configured cgroup bound before allocating.
    source = """
const fs=require('fs');
console.log(JSON.stringify({memoryMax:fs.readFileSync('/sys/fs/cgroup/memory.max','utf8').trim(),swapMax:fs.readFileSync('/sys/fs/cgroup/memory.swap.max','utf8').trim()}));
const data=Buffer.alloc(Number(process.argv[1])*1024*1024,97);
console.log(JSON.stringify({done:true,allocated:data.length,rss:process.memoryUsage().rss}));
"""
    args = ["create", "--pull", "never", "--network", "none", "--read-only",
            "--no-healthcheck", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
            "--ipc", "private", "--pids-limit", "16", "--memory", "64m", "--memory-swap", "64m",
            "--cpus", "1", "--user", "65534:65534", "--entrypoint", "node", image, "-e", source, str(mib)]
    container = call(args)
    row = {"mib": mib, "image": image, "container": container, "createArgs": args}
    start = time.monotonic()
    try:
        call(["start", container])
        row["exitCode"] = int(call(["wait", container]))
        state = json.loads(call(["inspect", "--format", "{{json .State}}", container]))
        row["state"] = state
        row["stdout"] = call(["logs", container])
        row["elapsedSeconds"] = time.monotonic() - start
    except Exception as error:
        row["error"] = str(error)
        raise
    finally:
        row["cleanup"] = call(["rm", "-f", container])
        rows.append(row)
        (out / "result.json").write_text(json.dumps({"scope": "standard cgroup primitive used by Airlock; not its broker, native Darwin compatibility, or complete containment", "rows": rows}, indent=2) + "\n")
