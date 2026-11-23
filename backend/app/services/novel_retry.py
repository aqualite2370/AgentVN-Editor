"""Per-request retry budget, bound separately for every generator step."""
from contextvars import ContextVar
from functools import wraps
from inspect import isgeneratorfunction
import re
import time

from app.core.errors import AIProviderError

retry_budget: ContextVar[int] = ContextVar("novel_retry_budget", default=5)
retry_scope_active: ContextVar[bool] = ContextVar("novel_retry_scope_active", default=False)
retry_cancelled: ContextVar[object] = ContextVar("novel_retry_cancelled", default=None)


def check_cancelled():
    cancelled = retry_cancelled.get()
    if cancelled is not None and cancelled():
        raise AIProviderError("解析已取消，成功断点保留。")


def retry_scope(function):
    if isgeneratorfunction(function):
        @wraps(function)
        def stream(self, request, *args, **kwargs):
            events = function(self, request, *args, **kwargs)
            try:
                while True:
                    token = retry_budget.set(request.max_retries)
                    active_token = retry_scope_active.set(True)
                    try:
                        event = next(events)
                    except StopIteration as result:
                        return result.value
                    finally:
                        retry_scope_active.reset(active_token)
                        retry_budget.reset(token)
                    yield event
            finally:
                events.close()
        return stream
    @wraps(function)
    def call(self, request, *args, **kwargs):
        token = retry_budget.set(request.max_retries)
        active_token = retry_scope_active.set(True)
        try:
            return function(self, request, *args, **kwargs)
        finally:
            retry_scope_active.reset(active_token)
            retry_budget.reset(token)
    return call


def retryable(error: AIProviderError | str) -> bool:
    # No amount of repetition fixes missing credentials or an impossible input.
    return not re.search(
        r"\b(?:401|403|404)\b|api key is required|invalid.api.key|authentication|"
        r"context.length|maximum context|上下文.{0,12}(?:超|不足)|输入.{0,8}超.*预算|"
        r"已取消|cancelled|不支持.*(?:协议|模式)|unsupported",
        str(error), re.I,
    )


def retry_events(attempt: int, limit: int, phase: str):
    delay = min(8, 2 ** (attempt - 1))
    yield "trace", {"phase": phase, "level": "warning", "title": "自动重试",
        "message": f"请求失败，{delay}秒后自动重试 {attempt}/{limit}；成功断点保留。",
        "details": {"retry": attempt, "maxRetries": limit, "delaySeconds": delay}}
    # Yield while waiting so WebSocket cancellation is observed before another
    # paid request. No nested/parallel retries or client transport resubmission.
    ticks = delay * 4
    for tick in range(ticks):
        check_cancelled()
        yield "status", f"自动重试 {attempt}/{limit} · 等待 {max(1, (ticks-tick+3)//4)} 秒"
        time.sleep(.25)
    yield "status", f"正在自动重试 {attempt}/{limit}"
    check_cancelled()
