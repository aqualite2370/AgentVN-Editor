"""Run only the four pre-existing failures against saved pre-change services."""

import importlib
import importlib.util
import sys
from pathlib import Path

import pytest


root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "backend"))
checkpoint = Path("F:/AgentVN/Checkpoints/Credential-Boundaries-20261102-01/backend/app/services")
parent = importlib.import_module("app.services")
for short_name in ("project_state_service", "novel_import_service"):
    name = "app.services." + short_name
    spec = importlib.util.spec_from_file_location(name, checkpoint / (short_name + ".py"))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    setattr(parent, short_name, module)
    spec.loader.exec_module(module)

raise SystemExit(pytest.main([
    str(root / "backend/tests/test_project_state_service.py") + "::test_project_catalog_and_detail_are_split_from_recent_projects",
    str(root / "backend/tests/test_project_state_service.py") + "::test_catalog_recovers_summary_from_huge_legacy_current_project",
    str(root / "backend/tests/test_novel_import_api.py") + "::test_novel_adaptation_prompt_covers_every_editor_event_type",
    str(root / "backend/tests/test_novel_import_api.py") + "::test_novel_import_ai_adapt_scene_normalizes_short_character_reference",
    "-q", "--tb=short",
    "--junitxml=F:/AgentVN/QA/Credential-Boundaries-20261102-01/preexisting-failures-baseline-02.xml",
]))
