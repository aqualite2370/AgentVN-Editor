"""Packaged backend launcher for the AgentVN editor desktop shell."""

from __future__ import annotations

import multiprocessing
import logging
import os
import traceback
from pathlib import Path

import uvicorn

from app.main import app
from app.core.error_logging import configure_error_logging, log_exception


logger = logging.getLogger("agentvn.backend.launcher")


def main() -> None:
    """Start the local FastAPI backend on the editor sidecar port."""

    host = os.environ.get("AGENTVN_BACKEND_HOST", "127.0.0.1")
    port = int(os.environ.get("AGENTVN_BACKEND_PORT", "8278"))

    if not os.environ.get("DATABASE_PATH"):
        data_dir = Path(os.environ.get("AGENTVN_BACKEND_DATA_DIR", "./data"))
        data_dir.mkdir(parents=True, exist_ok=True)
        os.environ["DATABASE_PATH"] = str(data_dir / "vn_engine.db")

    uvicorn.run(
        app,
        host=host,
        port=port,
        reload=False,
        access_log=False,
        log_config=None,
        log_level="warning",
    )


if __name__ == "__main__":
    multiprocessing.freeze_support()
    try:
        main()
    except Exception as exc:
        configured_log_path = configure_error_logging()
        log_exception(logger, "后端进程启动或运行失败", exc)
        log_path = Path(os.environ.get("AGENTVN_BACKEND_LOG", str(configured_log_path)))
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("a", encoding="utf-8") as log_file:
            log_file.write(traceback.format_exc())
            log_file.write("\n")
        raise
