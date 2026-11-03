"""Opt-in live Tool Call compatibility smoke test for DeepSeek V4."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

from app.ai.provider import AIProvider  # noqa: E402
from app.schemas.requests import ProviderSelectionParameters, ProviderSelectionRequest  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the AgentVN SceneBeat, MemoryUpdate, and complex-schema Tool Call probes."
    )
    parser.add_argument(
        "--model",
        choices=("flash", "pro"),
        default="flash",
        help="DeepSeek V4 profile to test (default: flash).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    api_key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    if not api_key:
        print(
            "DEEPSEEK_API_KEY is required. Set it in the current shell, then rerun this command. "
            "The key is never printed or persisted."
        )
        return 2

    is_pro = args.model == "pro"
    model_env = "DEEPSEEK_V4_PRO_MODEL" if is_pro else "DEEPSEEK_V4_FLASH_MODEL"
    model_id = os.environ.get(
        model_env,
        "deepseek-v4-pro" if is_pro else "deepseek-v4-flash",
    ).strip()
    base_url = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com").strip()
    parameters = ProviderSelectionParameters(
        temperature=0.2,
        top_p=0.9,
        max_tokens=8192 if is_pro else 4096,
        structured_mode="tools",
        request_timeout_seconds=600 if is_pro else 300,
        context_budget_tokens=48000 if is_pro else 24000,
        thinking_mode=False,
    )
    selection = ProviderSelectionRequest(
        connection_id=f"deepseek-v4-{args.model}-live-smoke",
        model_id=model_id,
        base_url=base_url,
        api_key=api_key,
        parameters=parameters,
    )

    result = AIProvider().test_generation(selection)
    report = result.model_dump(mode="json")
    report.pop("fallback_reason", None)
    print(json.dumps(report, ensure_ascii=False, indent=2))

    probes_passed = (
        result.ok
        and result.tool_calling_ok is True
        and result.scene_schema_ok is True
        and result.memory_schema_ok is True
        and result.complex_schema_ok is True
        and result.tool_unsupported is not True
        and result.json_mode_ok is not True
    )
    if not probes_passed:
        print("DeepSeek V4 Tool Call smoke test failed; JSON fallback is not accepted by this test.")
        return 1
    print(f"DeepSeek V4 {args.model} Tool Call smoke test passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
