"""Compare the packaged app code to current Python source without executing it.

This is provenance evidence only: it does not certify third-party dependencies,
the build command's origin, a live model, installation, or functional behavior.
"""
import hashlib
import json
from pathlib import Path
import sys
from datetime import datetime, timezone
import marshal
import types

from PyInstaller.archive.readers import CArchiveReader


def digest(file):
    h = hashlib.sha256()
    with file.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def audit(executable, source_root):
    before = digest(executable)
    archive = CArchiveReader(str(executable))
    names = [name for name in archive.toc if name.endswith(".pyz")]
    assert len(names) == 1, "Expected exactly one embedded Python archive"
    pyz = archive.open_embedded_archive(names[0])
    modules = sorted(name for name in pyz.toc if name == "app" or name.startswith("app."))
    assert modules, "Reject empty application module coverage"
    source_files = {}
    for file in sorted((source_root / "app").rglob("*.py")):
        assert not file.is_symlink(), f"Do not follow source symlinks: {file}"
        relative = file.relative_to(source_root).with_suffix("")
        parts = list(relative.parts)
        if parts[-1] == "__init__":
            parts.pop()
        source_files[".".join(parts)] = file
    unknown = sorted(set(modules) - set(source_files))
    assert not unknown, {"unknown_in_exe": unknown}
    # PyInstaller bundles its import closure, not every .py in the tree. Report
    # omitted sources explicitly rather than claiming they were byte-compared.
    unpackaged = sorted(set(source_files) - set(modules))
    rows = []

    def compare(name, file, code):
        assert isinstance(code, types.CodeType), f"Expected code object: {name}"
        # compile() parses source; it does not execute application imports or code.
        expected = compile(
            file.read_text(encoding="utf-8-sig"), code.co_filename,
            "exec", dont_inherit=True, optimize=0,
        )
        equal = expected == code
        rows.append({
            "module": name, "source": str(file), "sourceSha256": digest(file),
            "embeddedFilename": code.co_filename,
            "codeObjectEqual": equal, "status": "PASS" if equal else "FAILED",
        })
        return equal

    for name in modules:
        compare(name, source_files[name], pyz.extract(name))
    launcher = source_root / "backend_launcher.py"
    compare("backend_launcher", launcher, marshal.loads(archive.extract("backend_launcher")))
    after = digest(executable)
    assert before == after, "Packaged executable changed during the audit"
    return {
        "status": "PASS" if all(row["codeObjectEqual"] for row in rows) else "FAILED",
        "executable": str(executable), "sha256": before, "afterSha256": after,
        "bytes": executable.stat().st_size,
        "appModules": len(modules), "launcherModules": 1, "modules": rows,
        "unpackagedSourceModules": [
            {"module": name, "source": str(source_files[name]),
             "sourceSha256": digest(source_files[name])}
            for name in unpackaged
        ],
        "python": sys.version,
        "scope": "PACKAGED_APPLICATION_CODE_EQUALS_CURRENT_SOURCE_NOT_BUILD_ORIGIN_OR_FUNCTIONAL_ACCEPTANCE",
        "applicationCodeExecuted": False, "modelRequests": 0,
        "notProven": [
            "Original sidecar rebuild command/process/time provenance",
            "Unpackaged source modules are listed, not certified as shipped or reachable",
            "Third-party dependency bytes and environment reproducibility",
            "Live model, installed Editor, standalone Windows/Android acceptance",
        ],
    }


if __name__ == "__main__":
    root = Path(__file__).resolve().parent.parent
    destination = Path(sys.argv[1]).resolve()
    assert destination.parent.is_relative_to(Path("F:/AgentVN/QA").resolve())
    assert not destination.exists(), "Never overwrite historical evidence"
    destination.parent.mkdir(parents=True, exist_ok=True)
    result = {"status": "FAILED", "startedAt": datetime.now(timezone.utc).isoformat()}
    try:
        result.update(audit(
            root / "editor/src-tauri/binaries/creator-backend.exe", root / "backend"))
    except Exception as error:
        result["error"] = f"{type(error).__name__}: {error}"
    result["finishedAt"] = datetime.now(timezone.utc).isoformat()
    destination.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "status": result["status"], "appModules": result.get("appModules"),
        "sha256": result.get("sha256"), "error": result.get("error"),
        "report": str(destination),
    }))
    sys.exit(0 if result["status"] == "PASS" else 1)
