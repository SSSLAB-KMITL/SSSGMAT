"""เปิด server: python -m gnss_studio_server (รันจากโฟลเดอร์ server/)"""

import os
import sys
from collections.abc import Mapping
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))    # api-interop/gnss-predict: ที่อยู่ของ gnss_predict

import uvicorn                                                   # noqa: E402

from .app import create_app                                      # noqa: E402
from .config import Config                                       # noqa: E402


def main(environ: Mapping[str, str] = os.environ) -> None:
    config = Config.from_env(environ)
    app = create_app(config)
    print(f"GNSS Studio: http://{config.host}:{config.port}/", flush=True)
    uvicorn.run(app, host=config.host, port=config.port)


if __name__ == "__main__":
    main()
