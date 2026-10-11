"""Start the existing Node.js application with ``python main.py``."""

from pathlib import Path
import shutil
import subprocess
import sys


def main() -> int:
    project_dir = Path(__file__).resolve().parent
    node = shutil.which("node")
    if node is None:
        print("Node.js 20 yoki undan yangi versiyasini o'rnating.", file=sys.stderr)
        return 1

    server = project_dir / "server.cjs"
    if not server.is_file():
        print(f"Server fayli topilmadi: {server}", file=sys.stderr)
        return 1

    try:
        return subprocess.run([node, str(server)], cwd=project_dir, check=False).returncode
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())