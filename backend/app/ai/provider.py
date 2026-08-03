"""OpenAI-compatible provider with validated native tool calling."""

from collections.abc import Callable, Iterator
from datetime import datetime, timezone
from time import perf_counter, sleep
from typing import Any, TypeVar
from urllib.parse import urlsplit, urlunsplit
from urllib import error, request
from uuid import uuid4
import json
import logging
import re

import httpcore
from httpx import Timeout, TransportError
from openai import APIConnectionError, APITimeoutError, OpenAI
from pydantic import BaseModel, ValidationError

from app.core.config import Settings, get_settings
from app.core.error_logging import sanitize_log_text
from app.core.errors import AIProviderError
from app.ai.structured_normalization import normalize_structured_payload
from app.mcp.tools import agentvn_tool_registry, generation_schema_for_model
from app.models.memory import MemoryUpdate
from app.models.novel_import import NovelAiChapterScenePlan
from app.models.scene import SceneBeat
from app.schemas.requests import ProviderSelectionParameters, ProviderSelectionRequest
from app.schemas.responses import DiscoveredProviderModel, TestProviderConnectionResponse, TestProviderGenerationResponse

T = TypeVar("T", bound=BaseModel)
logger = logging.getLogger("agentvn.backend.ai_provider")

DEFAULT_REQUEST_TIMEOUT_SECONDS = 300.0
DEFAULT_EMBEDDING_TIMEOUT_SECONDS = 12.0
STRUCTURED_TRANSPORT_MAX_ATTEMPTS = 2
STRUCTURED_TRANSPORT_RETRY_DELAY_SECONDS = 0.2
TransportRetryCallback = Callable[[dict[str, object]], None]


class AIProvider:
    """Provider for chat completions and embeddings."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._embedding_client = OpenAI(
            api_key=self.settings.embedding_api_key or self.settings.llm_api_key or "missing",
            base_url=self.settings.embedding_base_url,
            timeout=Timeout(DEFAULT_EMBEDDING_TIMEOUT_SECONDS),
            max_retries=0,
        )

    def _resolve_llm_config(self, selection: ProviderSelectionRequest | None) -> tuple[str, str, str, dict[str, Any]]:
        if selection is None:
            return (
                self.settings.llm_api_key or "",
                self.settings.llm_base_url,
                self.settings.llm_model,
                {},
            )
        return (
            selection.api_key,
            selection.base_url,
            selection.model_id,
            selection.parameters.model_dump(exclude_none=True) if selection.parameters else {},
        )

    def _request_timeout_seconds(self, parameter_overrides: dict[str, Any]) -> float:
        value = parameter_overrides.get("request_timeout_seconds")
        if isinstance(value, (int, float)):
            return float(value)
        return DEFAULT_REQUEST_TIMEOUT_SECONDS

    def _client_timeout(self, parameter_overrides: dict[str, Any]) -> Timeout:
        request_timeout = self._request_timeout_seconds(parameter_overrides)
        return Timeout(
            request_timeout,
            connect=request_timeout,
            read=request_timeout,
            write=request_timeout,
            pool=request_timeout,
        )

    def _exception_chain(self, exc: BaseException) -> Iterator[BaseException]:
        pending = [exc]
        seen: set[int] = set()
        while pending:
            current = pending.pop()
            identity = id(current)
            if identity in seen:
                continue
            seen.add(identity)
            yield current
            cause = getattr(current, "__cause__", None)
            context = getattr(current, "__context__", None)
            if isinstance(cause, BaseException):
                pending.append(cause)
            if isinstance(context, BaseException):
                pending.append(context)

    def _is_transient_transport_error(self, exc: BaseException) -> bool:
        transient_types = (
            APIConnectionError,
            APITimeoutError,
            TransportError,
            httpcore.NetworkError,
            httpcore.ProtocolError,
            httpcore.TimeoutException,
            ConnectionError,
            TimeoutError,
        )
        message_markers = (
            "incomplete chunked read",
            "peer closed connection",
            "server disconnected",
            "connection reset",
            "connection aborted",
            "connection broken",
            "remote protocol error",
            "remoteprotocolerror",
            "read error",
            "write error",
            "network error",
            "timed out",
            "timeout",
        )
        chain = list(self._exception_chain(exc))
        if any(
            isinstance(getattr(current, "status_code", None), int)
            and 400 <= getattr(current, "status_code") < 500
            and getattr(current, "status_code") not in {408, 409, 429}
            for current in chain
        ):
            return False
        for current in chain:
            if isinstance(current, transient_types):
                return True
            message = str(current).lower()
            if any(marker in message for marker in message_markers):
                return True
        return False

    def _transport_error_category(self, exc: BaseException) -> str:
        chain = list(self._exception_chain(exc))
        if any(isinstance(current, (APITimeoutError, httpcore.TimeoutException, TimeoutError)) for current in chain):
            return "timeout"
        if any(
            isinstance(current, httpcore.ProtocolError) or type(current).__name__ in {
                "ProtocolError",
                "RemoteProtocolError",
                "LocalProtocolError",
            }
            for current in chain
        ):
            return "protocol_error"
        if any(
            isinstance(current, (APIConnectionError, TransportError, httpcore.NetworkError, ConnectionError))
            for current in chain
        ):
            return "connection_error"
        lower = str(exc).lower()
        if "chunked" in lower or "peer closed" in lower or "protocol" in lower:
            return "protocol_error"
        return "transport_error"

    def _structured_transport_retry_details(
        self,
        exc: BaseException,
        *,
        response_model: type[BaseModel],
        attempt: int,
        fallback_mode: str,
        maximum_attempts: int = STRUCTURED_TRANSPORT_MAX_ATTEMPTS,
    ) -> dict[str, object]:
        return {
            "attempt": attempt,
            "maximumAttempts": maximum_attempts,
            "responseModel": response_model.__name__,
            "fallbackMode": fallback_mode,
            "errorCategory": self._transport_error_category(exc),
        }

    def _create_with_transport_retry(
        self,
        create: Callable[[], T],
        *,
        response_model: type[BaseModel],
        model_name: str,
        fallback_mode: str = "same_request",
        on_retry: TransportRetryCallback | None = None,
        maximum_attempts: int = STRUCTURED_TRANSPORT_MAX_ATTEMPTS,
    ) -> T:
        maximum_attempts = max(1, min(STRUCTURED_TRANSPORT_MAX_ATTEMPTS, maximum_attempts))
        for attempt in range(1, maximum_attempts + 1):
            try:
                return create()
            except Exception as exc:
                if not self._is_transient_transport_error(exc) or attempt >= maximum_attempts:
                    raise
                next_attempt = attempt + 1
                details = self._structured_transport_retry_details(
                    exc,
                    response_model=response_model,
                    attempt=next_attempt,
                    fallback_mode=fallback_mode,
                    maximum_attempts=maximum_attempts,
                )
                logger.warning(
                    "Structured provider transport interrupted; retrying: model=%s response_model=%s "
                    "attempt=%s/%s fallback_mode=%s error_category=%s error=%s",
                    model_name,
                    response_model.__name__,
                    next_attempt,
                    maximum_attempts,
                    fallback_mode,
                    details["errorCategory"],
                    sanitize_log_text(str(exc))[:800],
                )
                if on_retry is not None:
                    on_retry(details)
                sleep(STRUCTURED_TRANSPORT_RETRY_DELAY_SECONDS)
        raise AssertionError("unreachable")

    def _is_deepseek_provider(self, base_url: str, model_name: str) -> bool:
        return "deepseek" in base_url.lower() or model_name.lower().startswith("deepseek-")

    def _deepseek_profile(self, model_name: str) -> dict[str, int] | None:
        name = model_name.lower()
        if "deepseek-v4-flash" in name:
            return {
                "default": 4096,
                "novel_scene": 4096,
                "novel_outline": 6144,
                "json_repair": 2048,
                "context_budget": 24000,
            }
        if "deepseek-v4-pro" in name:
            return {
                "default": 8192,
                "novel_scene": 6144,
                "novel_outline": 10000,
                "json_repair": 3072,
                "context_budget": 48000,
            }
        return None

    def _apply_deepseek_generation_defaults(self, parameter_overrides: dict[str, Any], model_name: str) -> None:
        profile = self._deepseek_profile(model_name)
        if profile is None:
            return
        parameter_overrides["temperature"] = float(parameter_overrides.get("temperature", 0.2) or 0.2)
        parameter_overrides["top_p"] = float(parameter_overrides.get("top_p", 0.9) or 0.9)
        parameter_overrides["thinking_mode"] = False
        parameter_overrides.setdefault("structured_mode", "tools")
        parameter_overrides["context_budget_tokens"] = max(
            int(parameter_overrides.get("context_budget_tokens") or 0),
            profile["context_budget"],
        )
        if "max_tokens" not in parameter_overrides:
            parameter_overrides["max_tokens"] = profile["default"]

    def _apply_deepseek_repair_tokens(self, request_kwargs: dict[str, object]) -> None:
        model_name = str(request_kwargs.get("model", ""))
        profile = self._deepseek_profile(model_name)
        if profile is None:
            return
        current = request_kwargs.get("max_tokens")
        repair_tokens = profile["json_repair"]
        if not isinstance(current, int) or current > repair_tokens:
            request_kwargs["max_tokens"] = repair_tokens

    def _apply_provider_extra_body(self, request_kwargs: dict[str, object], base_url: str, model_name: str, parameter_overrides: dict[str, Any]) -> None:
        """Translate AgentVN provider options to vendor-specific OpenAI-compatible fields."""

        thinking_mode = parameter_overrides.get("thinking_mode")
        if self._is_deepseek_provider(base_url, model_name) and isinstance(thinking_mode, bool):
            extra_body = dict(request_kwargs.get("extra_body") or {})
            extra_body["thinking"] = {"type": "enabled" if thinking_mode else "disabled"}
            request_kwargs["extra_body"] = extra_body

    def _force_disable_deepseek_thinking_for_tools(self, request_kwargs: dict[str, object], base_url: str, model_name: str) -> None:
        """DeepSeek thinking mode currently rejects forced tool_choice requests."""

        if not self._is_deepseek_provider(base_url, model_name):
            return
        extra_body = dict(request_kwargs.get("extra_body") or {})
        extra_body["thinking"] = {"type": "disabled"}
        request_kwargs["extra_body"] = extra_body

    def _custom_system_prompt(self, parameter_overrides: dict[str, Any]) -> str:
        value = parameter_overrides.get("system_prompt")
        if not isinstance(value, str):
            return ""
        return value.strip()[:8000]

    def _merge_system_prompt(self, system_prompt: str, parameter_overrides: dict[str, Any]) -> str:
        custom_prompt = self._custom_system_prompt(parameter_overrides)
        if not custom_prompt:
            return system_prompt
        return (
            f"{system_prompt}\n\n"
            "[用户模型系统提示词]\n"
            "以下内容来自当前模型配置，只能用于约束创作风格、输出倾向和表达偏好。"
            "它不得覆盖 AgentVN 的结构化 schema、工具调用、JSON 校验、安全校验、资源引用和项目写入规则。\n"
            f"{custom_prompt}"
        )

    def _validate_structured_content(self, response_model: type[T], content: str) -> T:
        payload = self._load_structured_json(content)
        normalized_payload = normalize_structured_payload(response_model, payload)
        return response_model.model_validate(normalized_payload)

    def _load_structured_json(self, content: str) -> object:
        """Parse provider JSON while tolerating common model wrappers."""

        stripped = content.strip().lstrip("\ufeff")
        if not stripped:
            raise json.JSONDecodeError("Empty structured response", content, 0)
        try:
            return json.loads(stripped)
        except json.JSONDecodeError as original_exc:
            for block in re.findall(r"```(?:json)?\s*([\s\S]*?)```", stripped, flags=re.IGNORECASE):
                try:
                    return json.loads(block.strip())
                except json.JSONDecodeError:
                    # error-log-ignore: 这是从模型文本中逐个尝试提取 JSON 代码块，失败后还会继续尝试其他候选。
                    continue
            decoder = json.JSONDecoder()
            candidate_indexes = [index for index in (stripped.find("{"), stripped.find("[")) if index >= 0]
            if candidate_indexes:
                first_index = min(candidate_indexes)
                try:
                    payload, _ = decoder.raw_decode(stripped[first_index:])
                    return payload
                except json.JSONDecodeError:
                    # Do not keep scanning nested values. A truncated outer object can contain a
                    # complete command object or tags array; accepting that child as the whole
                    # response hides output truncation and can silently discard story content.
                    pass
            raise original_exc

    @staticmethod
    def _is_structured_output_truncation(exc: Exception) -> bool:
        if isinstance(exc, json.JSONDecodeError):
            remaining = exc.doc[exc.pos:].strip() if exc.doc else ""
            if exc.pos >= max(0, len(exc.doc.rstrip()) - 2) or not remaining:
                return True
        lower = str(exc).lower()
        return any(
            marker in lower
            for marker in (
                "json eof",
                "unexpected eof",
                "end of data",
                "unterminated string",
                "unclosed",
                "incomplete json",
                "truncated json",
                "finish_reason=length",
                "finish reason: length",
                "maximum context length",
                "max_tokens",
                "output length",
                "token limit",
            )
        )

    @staticmethod
    def _raise_if_length_finished(choice: object) -> None:
        finish_reason = str(getattr(choice, "finish_reason", "") or "").lower()
        if finish_reason == "length":
            raise AIProviderError(
                "Structured output truncated before the JSON object completed "
                "(finish_reason=length, output length limit reached)."
            )

    def create_structured(
        self,
        response_model: type[T],
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.4,
        selection: ProviderSelectionRequest | None = None,
        *,
        allow_json_fallback: bool = True,
    ) -> T:
        """Call the configured model and parse a Pydantic response."""

        api_key, base_url, model_name, parameter_overrides = self._resolve_llm_config(selection)
        self._apply_deepseek_generation_defaults(parameter_overrides, model_name)
        system_prompt = self._merge_system_prompt(system_prompt, parameter_overrides)
        if not api_key:
            raise AIProviderError("LLM API key is required for generation.")

        llm_client = OpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=self._client_timeout(parameter_overrides),
            max_retries=0,
        )

        request_kwargs: dict[str, object] = {
            "model": model_name,
            "temperature": parameter_overrides.get("temperature", temperature),
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        if "top_p" in parameter_overrides:
            request_kwargs["top_p"] = parameter_overrides["top_p"]
        if "max_tokens" in parameter_overrides:
            request_kwargs["max_tokens"] = parameter_overrides["max_tokens"]
        self._apply_structured_token_floor(response_model, request_kwargs)
        self._apply_provider_extra_body(request_kwargs, base_url, model_name, parameter_overrides)
        structured_mode = str(parameter_overrides.get("structured_mode") or "tools")
        try:
            if structured_mode == "json_object":
                return self._create_json_structured(llm_client, response_model, system_prompt, user_prompt, request_kwargs)
            if not agentvn_tool_registry.has_model(response_model):
                raise AIProviderError(
                    f"No AgentVN tool is registered for structured model {response_model.__name__}."
                )
            try:
                return self._create_tool_structured(
                    llm_client,
                    response_model,
                    request_kwargs,
                    base_url,
                    model_name,
                )
            except Exception as exc:
                if allow_json_fallback and self._is_explicit_tool_unsupported(exc):
                    logger.warning(
                        "Provider explicitly rejected tool calling; using one JSON compatibility request: "
                        "model=%s response_model=%s error_type=%s error=%s",
                        model_name,
                        response_model.__name__,
                        type(exc).__name__,
                        exc,
                    )
                    return self._create_json_structured(llm_client, response_model, system_prompt, user_prompt, request_kwargs)
                raise
        except Exception as exc:
            raise AIProviderError(self._format_provider_error(exc, base_url, model_name)) from exc

    def create_with_tools(
        self,
        response_model: type[T],
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.4,
        selection: ProviderSelectionRequest | None = None,
        *,
        allow_json_fallback: bool = True,
    ) -> T:
        """Call a model through AgentVN native tool schemas and validate tool arguments."""

        return self.create_structured(
            response_model,
            system_prompt,
            user_prompt,
            temperature=temperature,
            selection=selection,
            allow_json_fallback=allow_json_fallback,
        )

    def stream_with_tools(
        self,
        response_model: type[T],
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.4,
        selection: ProviderSelectionRequest | None = None,
        *,
        max_tool_attempts: int = 3,
    ) -> Iterator[tuple[str, object]]:
        """Emit debug status while obtaining a validated final object from a tool call."""

        api_key, base_url, model_name, parameter_overrides = self._resolve_llm_config(selection)
        self._apply_deepseek_generation_defaults(parameter_overrides, model_name)
        if not api_key:
            raise AIProviderError("LLM API key is required for generation.")

        structured_mode = str(parameter_overrides.get("structured_mode") or "tools")
        if structured_mode == "json_object":
            yield from self.stream_structured_json(response_model, system_prompt, user_prompt, temperature=temperature, selection=selection)
            return
        if not agentvn_tool_registry.has_model(response_model):
            raise AIProviderError(
                f"No AgentVN tool is registered for structured model {response_model.__name__}."
            )
        yield from self._stream_tool_or_json_fallback(
            response_model,
            system_prompt,
            user_prompt,
            temperature,
            api_key,
            base_url,
            model_name,
            parameter_overrides,
            structured_mode,
            max_tool_attempts,
        )
        return

    def _stream_tool_or_json_fallback(
        self,
        response_model: type[T],
        system_prompt: str,
        user_prompt: str,
        temperature: float,
        api_key: str,
        base_url: str,
        model_name: str,
        parameter_overrides: dict[str, Any],
        structured_mode: str,
        max_tool_attempts: int,
    ) -> Iterator[tuple[str, object]]:
        system_prompt = self._merge_system_prompt(system_prompt, parameter_overrides)
        request_kwargs: dict[str, object] = {
            "model": model_name,
            "temperature": parameter_overrides.get("temperature", temperature),
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        if "top_p" in parameter_overrides:
            request_kwargs["top_p"] = parameter_overrides["top_p"]
        if "max_tokens" in parameter_overrides:
            request_kwargs["max_tokens"] = parameter_overrides["max_tokens"]
        self._apply_structured_token_floor(response_model, request_kwargs)
        self._apply_provider_extra_body(request_kwargs, base_url, model_name, parameter_overrides)

        llm_client = OpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=self._client_timeout(parameter_overrides),
            max_retries=0,
        )

        if response_model is SceneBeat:
            yield from self._status_trace("public_decision", "info", "正在整理公开创作过程", "模型将先输出可公开的续写判断、候选方向和写入准备。")
            yield from self._stream_public_generation_notes(llm_client, request_kwargs, user_prompt)
            yield from self._status_trace("structured_write", "info", "公开创作过程已完成", "正在进入 AgentVN 结构化写入阶段。")
        else:
            yield from self._status_trace("structured_write", "info", "正在准备 AgentVN 结构化工具调用", f"目标数据模型：{response_model.__name__}。")
        yield from self._status_trace(
            "tool_call",
            "info",
            "正在尝试 AgentVN Tool Call",
            f"结构化模式：{structured_mode}；目标模型：{response_model.__name__}。",
            {
                "structured_mode": structured_mode,
                "response_model": response_model.__name__,
                "request_timeout_seconds": self._request_timeout_seconds(parameter_overrides),
            },
        )
        transport_retry_events: list[dict[str, object]] = []
        try:
            result = self._create_tool_structured(
                llm_client,
                response_model,
                request_kwargs,
                base_url,
                model_name,
                max_attempts=max_tool_attempts,
                on_transport_retry=transport_retry_events.append,
            )
            for details in transport_retry_events:
                yield from self._status_trace(
                    "provider_transport_retry",
                    "warning",
                    "模型连接中断，正在自动重试",
                    "结构化模型请求的响应传输提前中断；后端正在使用相同输入重新请求。",
                    details,
                )
            yield from self._status_trace("validation", "success", "Tool Call 参数已通过 AgentVN 结构校验", "最终数据可以安全写入画布。")
            yield ("final", result)
        except Exception as exc:
            for details in transport_retry_events:
                yield from self._status_trace(
                    "provider_transport_retry",
                    "warning",
                    "模型连接中断，正在自动重试",
                    "结构化模型请求的响应传输提前中断；后端已使用相同输入重新请求。",
                    details,
                )
            if self._is_explicit_tool_unsupported(exc):
                logger.warning(
                    "Provider explicitly rejected streamed tool calling; using one JSON compatibility request: "
                    "model=%s response_model=%s error_type=%s error=%s",
                    model_name,
                    response_model.__name__,
                    type(exc).__name__,
                    exc,
                )
                yield from self._status_trace(
                    "fallback",
                    "warning",
                    "已切换 JSON 兼容模式重试",
                    "当前模型服务明确声明不支持 Tool Call，后端将执行一次 JSON 兼容请求。",
                    {"reason": str(exc)[:800], "fallback_used": True, "error_type": type(exc).__name__},
                )
                json_transport_retry_events: list[dict[str, object]] = []
                try:
                    result = self._create_json_structured(
                        llm_client,
                        response_model,
                        system_prompt,
                        user_prompt,
                        request_kwargs,
                        on_transport_retry=json_transport_retry_events.append,
                    )
                except Exception as json_exc:
                    for details in json_transport_retry_events:
                        yield from self._status_trace(
                            "provider_transport_retry",
                            "warning",
                            "JSON 兼容请求连接中断，正在自动重试",
                            "JSON 兼容结构化请求的响应传输提前中断；后端已使用相同输入重新请求。",
                            details,
                        )
                    if response_model is MemoryUpdate:
                        result = self._partial_memory_update(user_prompt, json_exc)  # type: ignore[assignment]
                        yield ("trace", self._trace_event(
                            "memory_partial",
                            "warning",
                            "Memory extraction saved as a partial update",
                            "MemoryUpdate JSON validation failed after the explicit unsupported-tools fallback; unsafe relation changes were dropped.",
                            {"reason": str(json_exc)[:1200]},
                        ))
                        yield ("final", result)
                        return
                    yield ("trace", self._trace_event("validation", "error", "JSON 兼容模式校验失败", str(json_exc)[:1200]))
                    raise AIProviderError(self._format_provider_error(json_exc, base_url, model_name)) from json_exc
                for details in json_transport_retry_events:
                    yield from self._status_trace(
                        "provider_transport_retry",
                        "warning",
                        "JSON 兼容请求连接中断，正在自动重试",
                        "JSON 兼容结构化请求的响应传输提前中断；后端已使用相同输入重新请求。",
                        details,
                    )
                yield from self._status_trace("validation", "success", "JSON 兼容结果已通过 AgentVN 结构校验", "最终数据可以安全写入画布。")
                yield ("final", result)
                return
            if isinstance(exc, AIProviderError):
                yield ("trace", self._trace_event("tool_call", "error", "Tool Call 失败", str(exc)[:1200]))
                raise
            yield ("trace", self._trace_event("tool_call", "error", "Tool Call 异常", str(exc)[:1200]))
            raise AIProviderError(self._format_provider_error(exc, base_url, model_name)) from exc

    def stream_structured_json(
        self,
        response_model: type[T],
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.4,
        selection: ProviderSelectionRequest | None = None,
    ) -> Iterator[tuple[str, object]]:
        """Stream JSON-mode model text, then yield the parsed Pydantic object."""

        api_key, base_url, model_name, parameter_overrides = self._resolve_llm_config(selection)
        self._apply_deepseek_generation_defaults(parameter_overrides, model_name)
        system_prompt = self._merge_system_prompt(system_prompt, parameter_overrides)
        if not api_key:
            raise AIProviderError("LLM API key is required for generation.")

        request_kwargs: dict[str, object] = {
            "model": model_name,
            "temperature": parameter_overrides.get("temperature", temperature),
            "messages": [
                {
                    "role": "system",
                    "content": (
                        f"{system_prompt}\n\n"
                        "Return only a valid JSON object that matches the requested schema. "
                        "Do not wrap the JSON in Markdown fences and do not include explanatory text."
                    ),
                },
                {"role": "user", "content": user_prompt},
            ],
            "response_format": {"type": "json_object"},
            "stream": True,
        }
        if "top_p" in parameter_overrides:
            request_kwargs["top_p"] = parameter_overrides["top_p"]
        if "max_tokens" in parameter_overrides:
            request_kwargs["max_tokens"] = parameter_overrides["max_tokens"]
        self._apply_structured_token_floor(response_model, request_kwargs)
        self._apply_provider_extra_body(request_kwargs, base_url, model_name, parameter_overrides)

        llm_client = OpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=self._client_timeout(parameter_overrides),
            max_retries=0,
        )
        chunks: list[str] = []
        expose_model_delta = response_model is not SceneBeat
        try:
            if response_model is SceneBeat:
                yield from self._status_trace("public_decision", "info", "正在整理公开创作过程", "模型将先输出可公开的续写判断、候选方向和写入准备。")
                yield from self._stream_public_generation_notes(llm_client, request_kwargs, user_prompt)
                yield from self._status_trace("structured_write", "info", "公开创作过程已完成", "正在进入 JSON 兼容结构化生成阶段。")
            else:
                yield from self._status_trace("memory", "info", "正在分析记忆更新", "正在分析客观事实与角色主观记忆。")
            yield from self._status_trace("json_mode", "info", "模型已连接，正在生成结构化结果", "JSON 文本只用于后端校验，不作为公开决策内容显示。")
            try:
                stream = llm_client.chat.completions.create(**request_kwargs)
                for chunk in stream:
                    choice = chunk.choices[0]
                    delta = choice.delta.content or ""
                    if delta:
                        chunks.append(delta)
                        if expose_model_delta:
                            yield ("delta", delta)
                    self._raise_if_length_finished(choice)
            except Exception as stream_exc:
                if not self._is_transient_transport_error(stream_exc):
                    raise
                retry_kwargs = {key: value for key, value in request_kwargs.items() if key != "stream"}
                details = self._structured_transport_retry_details(
                    stream_exc,
                    response_model=response_model,
                    attempt=2,
                    fallback_mode="non_stream",
                )
                logger.warning(
                    "Structured JSON stream interrupted; recovering with non-stream request: "
                    "model=%s response_model=%s error_category=%s error=%s",
                    model_name,
                    response_model.__name__,
                    details["errorCategory"],
                    sanitize_log_text(str(stream_exc))[:800],
                )
                chunks.clear()
                yield from self._status_trace(
                    "provider_transport_retry",
                    "warning",
                    "模型流中断，正在使用非流式模式恢复",
                    "已丢弃未完成的流式 JSON；后端正在使用相同输入重新请求完整结构化结果。",
                    details,
                )
                sleep(STRUCTURED_TRANSPORT_RETRY_DELAY_SECONDS)
                result = self._create_json_structured(
                    llm_client,
                    response_model,
                    system_prompt,
                    user_prompt,
                    retry_kwargs,
                    transport_max_attempts=1,
                )
            else:
                content = "".join(chunks)
                try:
                    result = self._validate_structured_content(response_model, content)
                except Exception as validation_exc:
                    if self._is_structured_output_truncation(validation_exc):
                        raise AIProviderError(
                            "Structured output truncated before the JSON object completed "
                            f"(JSON EOF/unclosed content: {validation_exc})."
                        ) from validation_exc
                    logger.warning(
                        "模型流式 JSON 校验失败，改用非流式结构化模式：model=%s error=%s",
                        model_name,
                        validation_exc,
                    )
                    retry_kwargs = {key: value for key, value in request_kwargs.items() if key != "stream"}
                    yield from self._status_trace("fallback", "warning", "模型返回 JSON 不完整", "正在使用非流式结构化模式重试。")
                    result = self._create_json_structured(llm_client, response_model, system_prompt, user_prompt, retry_kwargs)
            yield from self._status_trace("validation", "success", "结构化结果已通过 AgentVN 校验", "最终数据可以安全写入画布。")
            yield ("final", result)
        except Exception as exc:
            yield ("trace", self._trace_event("validation", "error", "结构化生成失败", str(exc)[:1200]))
            raise AIProviderError(self._format_provider_error(exc, base_url, model_name)) from exc

    def _trace_event(
        self,
        phase: str,
        level: str,
        title: str,
        message: str,
        details: dict[str, object] | None = None,
    ) -> dict[str, object]:
        payload: dict[str, object] = {
            "id": f"trace_{uuid4().hex[:12]}",
            "time": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "phase": phase,
            "level": level,
            "title": title,
            "message": message,
        }
        if details:
            payload["details"] = details
        return payload

    def _status_trace(
        self,
        phase: str,
        level: str,
        title: str,
        message: str,
        details: dict[str, object] | None = None,
    ) -> Iterator[tuple[str, object]]:
        yield ("status", title)
        yield ("trace", self._trace_event(phase, level, title, message, details))

    def _stream_public_generation_notes(
        self,
        llm_client: OpenAI,
        request_kwargs: dict[str, object],
        user_prompt: str,
    ) -> Iterator[tuple[str, object]]:
        """Stream short user-facing creation notes before structured output."""

        try:
            temperature = float(request_kwargs.get("temperature", 0.4) or 0.4)
        except (TypeError, ValueError):
            # error-log-ignore: 非法温度值属于输入规范化，后续会明确使用安全默认值。
            temperature = 0.4
        yield ("trace", self._trace_event("public_decision", "info", "公开决策流请求已发送", "正在请求模型输出可公开的续写决策过程。"))
        notes_kwargs: dict[str, object] = {
            "model": request_kwargs["model"],
            "temperature": min(temperature, 0.5),
            "max_tokens": 520,
            "stream": True,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "你是 AgentVN 编辑器的公开决策过程播报器。"
                        "请用中文输出给用户看的简短生成记录，按顺序说明："
                        "1. 你如何理解当前场景；2. 续写目标与冲突焦点；"
                        "3. 候选剧情方向；4. 你选择哪个方向以及原因；5. 准备写入哪些事件类型。"
                        "不要输出 JSON，不要输出隐藏推理链，不要声称已经修改项目数据。"
                        "每段尽量短，适合在编辑器生成面板中流式展示。"
                    ),
                },
                {
                    "role": "user",
                    "content": f"请基于以下 AgentVN 生成上下文，给出公开决策过程和候选剧情方向：\n\n{user_prompt}",
                },
            ],
        }
        if "top_p" in request_kwargs:
            notes_kwargs["top_p"] = request_kwargs["top_p"]
        try:
            emitted = False
            stream = llm_client.chat.completions.create(**notes_kwargs)
            for chunk in stream:
                delta = chunk.choices[0].delta.content or ""
                if delta:
                    emitted = True
                    yield ("delta", delta)
            if not emitted:
                fallback = "模型未返回公开决策文本，继续结构化生成。"
                yield ("status", fallback)
                yield ("delta", "公开决策流暂未返回文本；后端将继续进入结构化写入与校验阶段。\n")
                yield ("trace", self._trace_event("public_decision", "warning", "公开决策流为空", fallback))
            else:
                yield ("trace", self._trace_event("public_decision", "success", "公开决策流已完成", "模型已返回可公开的续写决策过程。"))
        except Exception as exc:
            logger.warning(
                "模型公开决策流请求失败，继续结构化生成：model=%s error=%s",
                request_kwargs.get("model"),
                exc,
            )
            fallback = "公开决策流暂不可用，继续结构化生成。"
            yield ("status", fallback)
            yield ("delta", "公开决策流暂不可用；后端将继续通过 AgentVN Tool Call/结构校验生成最终场景。\n")
            yield ("trace", self._trace_event("public_decision", "warning", "公开决策流请求失败", fallback))

    def create_chat(
        self,
        system_prompt: str,
        messages: list[dict[str, str]],
        temperature: float = 0.3,
        selection: ProviderSelectionRequest | None = None,
    ) -> str:
        """Call the configured model for plain assistant chat."""

        api_key, base_url, model_name, parameter_overrides = self._resolve_llm_config(selection)
        self._apply_deepseek_generation_defaults(parameter_overrides, model_name)
        system_prompt = self._merge_system_prompt(system_prompt, parameter_overrides)
        if not api_key:
            raise AIProviderError("LLM API key is required for assistant chat.")

        llm_client = OpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=self._client_timeout(parameter_overrides),
            max_retries=0,
        )
        request_kwargs: dict[str, object] = {
            "model": model_name,
            "temperature": parameter_overrides.get("temperature", temperature),
            "messages": [
                {"role": "system", "content": system_prompt},
                *messages,
            ],
        }
        if "top_p" in parameter_overrides:
            request_kwargs["top_p"] = parameter_overrides["top_p"]
        if "max_tokens" in parameter_overrides:
            request_kwargs["max_tokens"] = parameter_overrides["max_tokens"]
        self._apply_provider_extra_body(request_kwargs, base_url, model_name, parameter_overrides)
        try:
            response = llm_client.chat.completions.create(**request_kwargs)
            return response.choices[0].message.content or ""
        except Exception as exc:
            raise AIProviderError(self._format_provider_error(exc, base_url, model_name)) from exc

    def stream_chat(
        self,
        system_prompt: str,
        messages: list[dict[str, str]],
        temperature: float = 0.3,
        selection: ProviderSelectionRequest | None = None,
    ) -> Iterator[str]:
        """Stream plain assistant chat text from the configured model."""

        api_key, base_url, model_name, parameter_overrides = self._resolve_llm_config(selection)
        self._apply_deepseek_generation_defaults(parameter_overrides, model_name)
        system_prompt = self._merge_system_prompt(system_prompt, parameter_overrides)
        if not api_key:
            raise AIProviderError("LLM API key is required for assistant chat.")

        llm_client = OpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=self._client_timeout(parameter_overrides),
            max_retries=0,
        )
        request_kwargs: dict[str, object] = {
            "model": model_name,
            "temperature": parameter_overrides.get("temperature", temperature),
            "stream": True,
            "messages": [
                {"role": "system", "content": system_prompt},
                *messages,
            ],
        }
        if "top_p" in parameter_overrides:
            request_kwargs["top_p"] = parameter_overrides["top_p"]
        if "max_tokens" in parameter_overrides:
            request_kwargs["max_tokens"] = parameter_overrides["max_tokens"]
        self._apply_provider_extra_body(request_kwargs, base_url, model_name, parameter_overrides)
        try:
            stream = llm_client.chat.completions.create(**request_kwargs)
            for chunk in stream:
                content = chunk.choices[0].delta.content if chunk.choices else None
                if content:
                    yield content
        except Exception as exc:
            raise AIProviderError(self._format_provider_error(exc, base_url, model_name)) from exc

    def _create_tool_structured(
        self,
        llm_client: OpenAI,
        response_model: type[T],
        request_kwargs: dict[str, object],
        base_url: str = "",
        model_name: str = "",
        *,
        max_attempts: int = 3,
        on_transport_retry: TransportRetryCallback | None = None,
    ) -> T:
        tool = agentvn_tool_registry.tool_for_model(response_model)
        openai_tool = agentvn_tool_registry.openai_tool_for_model(response_model)
        messages = [
            dict(message) if isinstance(message, dict) else message
            for message in request_kwargs.get("messages", [])
        ]
        if not messages:
            raise AIProviderError("AgentVN tool call requires chat messages.")
        messages[0] = {
            **messages[0],  # type: ignore[arg-type]
            "content": (
                f"{messages[0].get('content', '')}\n\n"  # type: ignore[union-attr]
                f"You may reason in ordinary language, but the final AgentVN data must be produced "
                f"by calling the tool `{tool.name}`. Do not place JSON in assistant text. "
                f"Assistant text is ignored by the editor; only validated tool arguments become project data."
            ),
        }
        tool_kwargs = {
            **request_kwargs,
            "messages": messages,
            "tools": [openai_tool],
            "tool_choice": {"type": "function", "function": {"name": tool.name}},
        }
        self._force_disable_deepseek_thinking_for_tools(
            tool_kwargs,
            base_url,
            model_name or str(request_kwargs.get("model", "")),
        )

        last_error: Exception | None = None
        max_attempts = max(1, min(3, max_attempts))
        for attempt in range(max_attempts):
            response = self._create_with_transport_retry(
                lambda: llm_client.chat.completions.create(**tool_kwargs),
                response_model=response_model,
                model_name=model_name or str(request_kwargs.get("model", "")),
                on_retry=on_transport_retry,
            )
            if not response.choices:
                raise AIProviderError(f"Provider returned no choices for AgentVN tool `{tool.name}`.")
            choice = response.choices[0]
            message = choice.message
            finish_reason = str(getattr(choice, "finish_reason", "") or "")
            if finish_reason == "length":
                last_error = AIProviderError(
                    f"AgentVN tool `{tool.name}` output was truncated because the provider reached its output limit."
                )
                logger.warning(
                    "Tool call attempt was truncated: model=%s response_model=%s tool=%s "
                    "attempt=%s finish_reason=%s",
                    model_name or request_kwargs.get("model"),
                    response_model.__name__,
                    tool.name,
                    attempt + 1,
                    finish_reason,
                )
                if attempt < max_attempts - 1:
                    messages.append(
                        {
                            "role": "user",
                            "content": (
                                f"The previous `{tool.name}` call was truncated. Call it again with a complete "
                                "schema-valid result. Keep optional prose concise; do not omit required data."
                            ),
                        }
                    )
                    tool_kwargs["messages"] = messages
                    continue
                raise last_error

            tool_calls = list(getattr(message, "tool_calls", None) or [])
            matching_call = next(
                (
                    call
                    for call in tool_calls
                    if getattr(getattr(call, "function", None), "name", None) == tool.name
                ),
                None,
            )
            if matching_call is None:
                content = getattr(message, "content", "") or ""
                last_error = AIProviderError(
                    f"Model did not call the required AgentVN tool `{tool.name}`. "
                    f"Assistant text cannot be used as project data: {content[:300]}"
                )
                logger.warning(
                    "Required tool was not called: model=%s response_model=%s tool=%s "
                    "attempt=%s finish_reason=%s",
                    model_name or request_kwargs.get("model"),
                    response_model.__name__,
                    tool.name,
                    attempt + 1,
                    finish_reason,
                )
                if attempt < max_attempts - 1:
                    messages.append({"role": "assistant", "content": content})
                    messages.append({"role": "user", "content": f"Call `{tool.name}` now. Do not answer with text."})
                    tool_kwargs["messages"] = messages
                    continue
                raise last_error

            arguments = getattr(matching_call.function, "arguments", "")
            try:
                return agentvn_tool_registry.validate_tool_arguments(tool.name, arguments)  # type: ignore[return-value]
            except Exception as exc:
                last_error = exc
                logger.warning(
                    "Tool arguments failed validation: model=%s response_model=%s tool=%s "
                    "attempt=%s finish_reason=%s error_type=%s",
                    model_name or request_kwargs.get("model"),
                    response_model.__name__,
                    tool.name,
                    attempt + 1,
                    finish_reason,
                    type(exc).__name__,
                )
                if attempt < max_attempts - 1:
                    assistant_message = message.model_dump(exclude_none=True) if hasattr(message, "model_dump") else {
                        "role": "assistant",
                        "content": getattr(message, "content", "") or "",
                    }
                    messages.append(assistant_message)
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": getattr(matching_call, "id", "agentvn_tool_retry"),
                            "content": (
                                f"The tool arguments failed AgentVN schema validation: {exc}. "
                                f"Call `{tool.name}` again with corrected arguments only."
                            ),
                        }
                    )
                    tool_kwargs["messages"] = messages
                    continue
                raise AIProviderError(
                    f"AgentVN tool `{tool.name}` returned invalid arguments after retry: {exc}"
                ) from exc

        raise AIProviderError(f"AgentVN tool `{tool.name}` did not produce a valid result: {last_error}")

    def _apply_structured_token_floor(self, response_model: type[BaseModel], request_kwargs: dict[str, object]) -> None:
        """Avoid truncating structured authoring payloads with low model defaults."""

        minimum_by_model = {
            "SceneBeat": 3200,
            "MemoryUpdate": 1800,
            "NovelAiChunkSummary": 1800,
            "NovelAiChunkEntityIndex": 2400,
            "NovelAiChunkTimelineNotes": 2200,
            "NovelAiChunkAnalysis": 5200,
            "NovelAiOutlineMainline": 2400,
            "NovelAiOutlineStructure": 5000,
            "NovelAiOutlineIndex": 2400,
            "NovelAiOutlineResponse": 9000,
            "NovelAiChapterScenePlan": 5200,
            "NovelAiScenePlanResponse": 6500,
            "AdaptSceneResponse": 5200,
            "SubagentModelOutput": 6500,
        }
        minimum = minimum_by_model.get(response_model.__name__)
        if minimum is None:
            return
        current = request_kwargs.get("max_tokens")
        if not isinstance(current, int) or current < minimum:
            request_kwargs["max_tokens"] = minimum

    def _create_json_structured(
        self,
        llm_client: OpenAI,
        response_model: type[T],
        system_prompt: str,
        user_prompt: str,
        request_kwargs: dict[str, object],
        *,
        on_transport_retry: TransportRetryCallback | None = None,
        transport_max_attempts: int = STRUCTURED_TRANSPORT_MAX_ATTEMPTS,
    ) -> T:
        json_kwargs = {
            **request_kwargs,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        f"{system_prompt}\n\n"
                        "Return only a valid JSON object that matches the requested schema. "
                        "Do not wrap the JSON in Markdown fences and do not include explanatory text."
                    ),
                },
                {"role": "user", "content": user_prompt},
            ],
            "response_format": {"type": "json_object"},
        }
        response = self._create_with_transport_retry(
            lambda: llm_client.chat.completions.create(**json_kwargs),
            response_model=response_model,
            model_name=str(request_kwargs.get("model", "")),
            on_retry=on_transport_retry,
            maximum_attempts=transport_max_attempts,
        )
        choice = response.choices[0]
        self._raise_if_length_finished(choice)
        content = choice.message.content or ""
        try:
            return self._validate_structured_content(response_model, content)
        except Exception as exc:
            if response_model is not MemoryUpdate and self._is_structured_output_truncation(exc):
                raise AIProviderError(
                    "Structured output truncated before the JSON object completed "
                    f"(JSON EOF/unclosed content: {exc})."
                ) from exc
            try:
                logger.warning(
                    "模型 JSON 结果校验失败，尝试修复：model=%s error=%s",
                    request_kwargs.get("model"),
                    exc,
                )
                return self._repair_json_structured(
                    llm_client,
                    response_model,
                    system_prompt,
                    user_prompt,
                    request_kwargs,
                    content,
                    exc,
                    on_transport_retry=on_transport_retry,
                )
            except Exception as repair_exc:
                if response_model is MemoryUpdate:
                    return self._partial_memory_update(user_prompt, repair_exc)  # type: ignore[return-value]
                raise AIProviderError(
                    f"Model returned content, but it was not valid structured JSON: {exc}; "
                    f"automatic repair also failed: {repair_exc}"
                ) from repair_exc

    def _repair_json_structured(
        self,
        llm_client: OpenAI,
        response_model: type[T],
        system_prompt: str,
        user_prompt: str,
        request_kwargs: dict[str, object],
        invalid_content: str,
        validation_error: Exception,
        *,
        on_transport_retry: TransportRetryCallback | None = None,
    ) -> T:
        repair_kwargs = {
            **request_kwargs,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        f"{system_prompt}\n\n"
                        "You are repairing a previous structured output for AgentVN. "
                        "Return only one valid JSON object. Do not include Markdown or explanations. "
                        "The corrected JSON must validate against the provided schema exactly; remove unknown fields, "
                        "rename obvious aliases to schema fields, and preserve user-visible story meaning."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Original user request:\n{user_prompt}\n\n"
                        f"Target Pydantic schema:\n{json.dumps(generation_schema_for_model(response_model), ensure_ascii=False)[:12000]}\n\n"
                        f"Validation errors:\n{self._validation_error_text(validation_error)}\n\n"
                        f"Invalid JSON/content to repair:\n{invalid_content[:12000]}"
                    ),
                },
            ],
            "response_format": {"type": "json_object"},
        }
        self._apply_deepseek_repair_tokens(repair_kwargs)
        self._apply_structured_token_floor(response_model, repair_kwargs)
        repair_response = self._create_with_transport_retry(
            lambda: llm_client.chat.completions.create(**repair_kwargs),
            response_model=response_model,
            model_name=str(request_kwargs.get("model", "")),
            fallback_mode="json_repair",
            on_retry=on_transport_retry,
        )
        repair_choice = repair_response.choices[0]
        self._raise_if_length_finished(repair_choice)
        repaired_content = repair_choice.message.content or ""
        return self._validate_structured_content(response_model, repaired_content)

    def _validation_error_text(self, exc: Exception) -> str:
        if isinstance(exc, ValidationError):
            return json.dumps(exc.errors(), ensure_ascii=False)
        return str(exc)

    def _is_explicit_tool_unsupported(self, exc: Exception) -> bool:
        """Return true only when the provider explicitly says tool calling is unsupported."""

        if isinstance(exc, AIProviderError):
            cause = exc.__cause__
            return self._is_explicit_tool_unsupported(cause) if isinstance(cause, Exception) else False
        message = str(exc).lower()
        provider_body = str(getattr(exc, "body", "") or "").lower()
        combined = f"{message}\n{provider_body}"
        unsupported_markers = (
            "unsupported tool call",
            "unsupported tools",
            "tools are not supported",
            "tools is not supported",
            "does not support tools",
            "does not support tool calling",
            "function calling is not supported",
            "function calling not supported",
            "tool_choice is not supported",
            "tool choice is not supported",
            "does not support this tool_choice",
            "unknown parameter: tools",
            "unrecognized parameter: tools",
            "unknown field: tools",
        )
        return any(marker in combined for marker in unsupported_markers)

    def _partial_memory_update(self, user_prompt: str, exc: Exception) -> MemoryUpdate:
        """Return a safe MemoryUpdate when the model's relation shape is unusable."""

        summary = self._extract_memory_summary_hint(user_prompt)
        return MemoryUpdate(
            summary_100=summary[:100],
            invalidated_relations=[],
            new_relations=[],
            emotion_snapshots=[],
        )

    def _extract_memory_summary_hint(self, user_prompt: str) -> str:
        scene_match = re.search(r'"summary"\s*:\s*"([^"]{1,160})"', user_prompt)
        if scene_match:
            return scene_match.group(1)[:100]
        title_match = re.search(r'"title"\s*:\s*"([^"]{1,160})"', user_prompt)
        if title_match:
            return title_match.group(1)[:100]
        return "Memory extraction completed partially; no unsafe relation changes were applied."

    def _format_provider_error(self, exc: Exception, base_url: str, model_name: str) -> str:
        sanitized = str(exc)
        status_code = getattr(exc, "status_code", None)
        body = getattr(exc, "body", None)
        if body:
            sanitized = f"{sanitized}\n{body}"
        parsed = urlsplit(base_url)
        host = parsed.netloc or base_url
        error_codes = re.findall(r"Error code:\s*(\d+)", sanitized)
        code = str(status_code or (error_codes[-1] if error_codes else "")).strip()
        prefix = f"模型服务返回 {code}" if code else "模型服务请求失败"
        hint = "请检查 Base URL、模型 ID、Token、结构化输出模式或服务状态。"
        lower = sanitized.lower()
        if any(marker in lower for marker in ("not valid json", "jsondecodeerror", "expecting", "invalid json", "structured json")):
            hint = (
                "模型返回的 Tool Call 参数或 JSON 兼容内容不完整，AgentVN 已拒绝写入项目。"
                "请关闭思考模式、检查最大输出长度并在模型设置页运行 Tool Call 适配测试；"
                "只有测试明确显示服务商不支持工具时才使用 JSON 兼容模式。"
            )
        return f"{prefix}（host: {host}, model: {model_name}）：{sanitized}\n提示：{hint}"

    def embed_text(self, text: str) -> list[float]:
        """Create one embedding using the configured embedding endpoint."""

        api_key = self.settings.embedding_api_key or self.settings.llm_api_key
        if not api_key:
            return []
        response = self._embedding_client.embeddings.create(
            model=self.settings.embedding_model,
            input=text,
        )
        return list(response.data[0].embedding)

    def _candidate_model_base_urls(self, base_url: str) -> list[str]:
        cleaned = base_url.strip().rstrip("/")
        if not cleaned:
            return []

        candidates = [cleaned]
        parsed = urlsplit(cleaned)
        path = parsed.path.rstrip("/")
        last_segment = path.rsplit("/", 1)[-1].lower()
        if last_segment != "v1":
            next_path = f"{path}/v1" if path else "/v1"
            candidates.append(urlunsplit((parsed.scheme, parsed.netloc, next_path, parsed.query, parsed.fragment)).rstrip("/"))
        return list(dict.fromkeys(candidates))

    def test_connection(self, base_url: str, api_key: str) -> TestProviderConnectionResponse:
        """Probe an OpenAI-compatible endpoint and return available models when possible."""

        candidate_base_urls = self._candidate_model_base_urls(base_url)
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        started = perf_counter()

        if not candidate_base_urls:
            return TestProviderConnectionResponse(
                ok=False,
                latency_ms=int((perf_counter() - started) * 1000),
                base_url=base_url,
                supports_model_discovery=False,
                models=[],
                error_message="Base URL is required.",
            )

        last_manual_fallback: TestProviderConnectionResponse | None = None
        for candidate_base_url in candidate_base_urls:
            models_url = f"{candidate_base_url}/models"
            req = request.Request(models_url, headers=headers, method="GET")
            try:
                with request.urlopen(req, timeout=12) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                raw_models = payload.get("data", [])
                models = [
                    DiscoveredProviderModel(model_id=str(item.get("id", "")), display_name=str(item.get("id", "")))
                    for item in raw_models
                    if item.get("id")
                ]
                return TestProviderConnectionResponse(
                    ok=True,
                    latency_ms=int((perf_counter() - started) * 1000),
                    base_url=candidate_base_url,
                    supports_model_discovery=True,
                    models=models,
                )
            except error.HTTPError as exc:
                if exc.code in (404, 405):
                    last_manual_fallback = TestProviderConnectionResponse(
                        ok=True,
                        latency_ms=int((perf_counter() - started) * 1000),
                        base_url=candidate_base_url,
                        supports_model_discovery=False,
                        models=[],
                    )
                    continue
                detail = exc.read().decode("utf-8", errors="ignore")
                logger.error(
                    "模型连接测试失败：base_url=%s status=%s detail=%s",
                    candidate_base_url,
                    exc.code,
                    detail[:8000],
                )
                return TestProviderConnectionResponse(
                    ok=False,
                    latency_ms=int((perf_counter() - started) * 1000),
                    base_url=candidate_base_url,
                    supports_model_discovery=False,
                    models=[],
                    error_message=detail or f"HTTP {exc.code}",
                )
            except Exception as exc:
                logger.exception("模型连接测试异常：base_url=%s", candidate_base_url)
                return TestProviderConnectionResponse(
                    ok=False,
                    latency_ms=int((perf_counter() - started) * 1000),
                    base_url=candidate_base_url,
                    supports_model_discovery=False,
                    models=[],
                    error_message=str(exc),
                )

        return last_manual_fallback or TestProviderConnectionResponse(
            ok=True,
            latency_ms=int((perf_counter() - started) * 1000),
            base_url=candidate_base_urls[-1],
            supports_model_discovery=False,
            models=[],
        )

    def test_generation(self, selection: ProviderSelectionRequest) -> TestProviderGenerationResponse:
        started = perf_counter()
        diagnostics: list[str] = []
        scene_schema_ok = False
        memory_schema_ok = False
        complex_schema_ok = False
        json_mode_ok: bool | None = None
        tool_unsupported = False
        fallback_reason: str | None = None
        first_error: str | None = None

        tools_selection = self._selection_with_structured_mode(selection, "tools")

        try:
            result = self.create_with_tools(
                SceneBeat,
                "You are testing AgentVN Tool Call compatibility. Finish by calling create_scene_beat.",
                (
                    "Create a tiny valid SceneBeat for a provider connection test. "
                    "Use scene_id='provider_probe', title='Tool probe', summary='Tool calling works', "
                    "chapter=0, tags=['probe'], and one narration command with text='Tool calling is available'."
                ),
                temperature=0.0,
                selection=tools_selection,
                allow_json_fallback=False,
            )
            scene_schema_ok = True
            diagnostics.append(f"SceneBeat Tool Call ok: {result.title}")
        except Exception as exc:
            tool_unsupported = self._is_explicit_tool_unsupported(exc)
            fallback_reason = str(exc)[:500] if tool_unsupported else None
            first_error = first_error or str(exc)
            diagnostics.append(f"SceneBeat Tool Call failed: {str(exc)[:500]}")

        if not tool_unsupported:
            try:
                result = self.create_with_tools(
                    MemoryUpdate,
                    "You are testing AgentVN Tool Call memory extraction. Finish by calling extract_memory_update.",
                    (
                        "Create a valid MemoryUpdate for chapter 0. "
                        "Use summary_100='Alice trusts the protagonist after the station scene'. "
                        "Keep invalidated_relations, new_relations, and emotion_snapshots empty."
                    ),
                    temperature=0.0,
                    selection=tools_selection,
                    allow_json_fallback=False,
                )
                memory_schema_ok = True
                diagnostics.append(f"MemoryUpdate Tool Call ok: {result.summary_100}")
            except Exception as exc:
                tool_unsupported = self._is_explicit_tool_unsupported(exc)
                fallback_reason = str(exc)[:500] if tool_unsupported else fallback_reason
                first_error = first_error or str(exc)
                diagnostics.append(f"MemoryUpdate Tool Call failed: {str(exc)[:500]}")

        if not tool_unsupported:
            try:
                result = self.create_with_tools(
                    NovelAiChapterScenePlan,
                    "You are testing a complex AgentVN Tool Call schema. Finish by calling plan_novel_chapter_scenes.",
                    (
                        "Create a minimal valid chapter scene plan. Use chapter_id='provider_probe_chapter', "
                        "warnings=[], needs_review=false, and exactly one scene with "
                        "scene_candidate_id='provider_probe_scene', chapter_id='provider_probe_chapter', "
                        "title='Probe scene', index=0, start_offset=0, end_offset=10, "
                        "source_excerpt='Probe text', summary='Complex schema Tool Call works', "
                        "commands=[], characters=[], confidence=0.9."
                    ),
                    temperature=0.0,
                    selection=tools_selection,
                    allow_json_fallback=False,
                )
                complex_schema_ok = True
                diagnostics.append(f"Complex Tool Call ok: {result.chapter_id}")
            except Exception as exc:
                tool_unsupported = self._is_explicit_tool_unsupported(exc)
                fallback_reason = str(exc)[:500] if tool_unsupported else fallback_reason
                first_error = first_error or str(exc)
                diagnostics.append(f"Complex Tool Call failed: {str(exc)[:500]}")

        tool_calling_ok = scene_schema_ok and memory_schema_ok and complex_schema_ok

        if tool_unsupported:
            json_selection = self._selection_with_structured_mode(selection, "json_object")
            try:
                result = self.create_structured(
                    SceneBeat,
                    "You are testing AgentVN JSON compatibility because the provider rejected Tool Call.",
                    (
                        "Create a tiny valid SceneBeat JSON object. "
                        "Use scene_id='provider_probe_json', title='JSON mode probe', summary='JSON mode works', "
                        "chapter=0, tags=['probe'], and one narration command with text='JSON mode is available'."
                    ),
                    temperature=0.0,
                    selection=json_selection,
                )
                json_mode_ok = True
                diagnostics.append(f"JSON compatibility ok: {result.title}")
            except Exception as exc:
                json_mode_ok = False
                first_error = first_error or str(exc)
                diagnostics.append(f"JSON compatibility failed: {str(exc)[:500]}")

        recommended = "tools" if tool_calling_ok else "json_object" if json_mode_ok else "tools"
        ok = tool_calling_ok or json_mode_ok is True
        return TestProviderGenerationResponse(
            ok=ok,
            latency_ms=int((perf_counter() - started) * 1000),
            model_id=selection.model_id,
            structured_mode=selection.parameters.structured_mode if selection.parameters and selection.parameters.structured_mode else "tools",
            message=f"模型结构化能力检测完成。推荐模式：{recommended}。" if ok else "模型结构化能力检测失败。",
            error_message=None if ok else first_error,
            tool_calling_ok=tool_calling_ok,
            scene_schema_ok=scene_schema_ok,
            json_mode_ok=json_mode_ok,
            memory_schema_ok=memory_schema_ok,
            complex_schema_ok=complex_schema_ok,
            tool_unsupported=tool_unsupported,
            fallback_reason=fallback_reason,
            recommended_structured_mode=recommended,
            diagnostics=diagnostics,
        )

    def _selection_with_structured_mode(self, selection: ProviderSelectionRequest, mode: str) -> ProviderSelectionRequest:
        existing = selection.parameters.model_dump(exclude_none=True) if selection.parameters else {}
        existing["structured_mode"] = mode
        return selection.model_copy(update={"parameters": ProviderSelectionParameters(**existing)})
