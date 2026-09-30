import json
import runpy
import sys
import traceback
from pathlib import Path


def main() -> None:
    script = Path(sys.argv[1]).resolve()
    sys.argv = sys.argv[1:]
    sys.path.insert(0, str(script.parent))
    try:
        runpy.run_path(str(script), run_name="__main__")
    except Exception as error:
        traceback.print_exc()
        print("ARGUS_ERROR " + json.dumps({"type": type(error).__name__, "message": str(error)}), file=sys.stderr, flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
