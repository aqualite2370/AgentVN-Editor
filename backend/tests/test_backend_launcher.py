from fastapi import FastAPI

import backend_launcher


def test_launcher_passes_imported_app_to_uvicorn(monkeypatch, tmp_path) -> None:
    captured: dict[str, object] = {}

    def fake_run(app: object, **kwargs: object) -> None:
        captured["app"] = app
        captured["kwargs"] = kwargs

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(backend_launcher.uvicorn, "run", fake_run)
    monkeypatch.delenv("DATABASE_PATH", raising=False)
    monkeypatch.delenv("AGENTVN_BACKEND_DATA_DIR", raising=False)

    backend_launcher.main()

    assert isinstance(captured["app"], FastAPI)
    assert captured["app"] is backend_launcher.app
    assert captured["kwargs"] == {
        "host": "127.0.0.1",
        "port": 8278,
        "reload": False,
        "access_log": False,
        "log_config": None,
        "log_level": "warning",
    }
