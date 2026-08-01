"""FastAPI application entry point."""

import logging
import re

from fastapi import FastAPI, Request
from fastapi.exception_handlers import http_exception_handler, request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.routes_generate import router as generate_router
from app.api.routes_assistant import router as assistant_router
from app.api.routes_health import router as health_router
from app.api.routes_memory import router as memory_router
from app.api.routes_mcp import router as mcp_router
from app.api.routes_novel_import import router as novel_import_router
from app.api.routes_novel_process import router as novel_process_router
from app.api.routes_novel_processing import router as novel_processing_router
from app.api.routes_novel_ws import router as novel_ws_router
from app.api.routes_providers import router as provider_router
from app.api.routes_project import router as project_router
from app.core.errors import AIProviderError, AgentVNError
from app.core.error_logging import configure_error_logging, log_exception, sanitize_log_text


configure_error_logging()
logger = logging.getLogger("agentvn.backend")


def _sanitize_error_message(message: str) -> str:
    """Remove likely credentials before returning backend errors to the editor."""

    sanitized = re.sub(r"sk-[A-Za-z0-9_\-]{6,}", "sk-***", message)
    sanitized = re.sub(r"(Bearer\s+)[^\s\"']+", r"\1***", sanitized, flags=re.IGNORECASE)
    error_codes = re.findall(r"Error code:\s*(\d+)", sanitized)
    if "<failed_attempts>" in sanitized and error_codes:
        compact = re.sub(r"<[^>]+>", " ", sanitized)
        compact = re.sub(r"\s+", " ", compact).strip()
        if compact:
            return compact[:1200]
        return f"模型服务返回 {error_codes[-1]}，请检查 Base URL、模型 ID、Token、结构化输出模式或服务状态。"
    if "Connection error" in sanitized or "Connection refused" in sanitized:
        return "无法连接模型服务，请检查 Base URL 是否正确，或服务是否正在运行。"
    return sanitized[:1200] or "Backend request failed."


def _error_response(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        headers={"X-AgentVN-Error-Logged": "1"},
        content={
            "code": code,
            "message": _sanitize_error_message(message),
        },
    )


def _find_nested_exception(exc: BaseException, error_type: type[BaseException]) -> BaseException | None:
    if isinstance(exc, error_type):
        return exc
    if isinstance(exc, BaseExceptionGroup):
        for nested in exc.exceptions:
            matched = _find_nested_exception(nested, error_type)
            if matched is not None:
                return matched
    return None


def create_app() -> FastAPI:
    """Create the local backend app."""

    app = FastAPI(
        title="AgentVN Backend",
        version="0.1.0",
        description="Local-first AI backend for structured visual novel generation.",
    )

    @app.middleware("http")
    async def handle_unexpected_errors(request: Request, call_next):
        try:
            response = await call_next(request)
            if response.status_code >= 400 and response.headers.get("X-AgentVN-Error-Logged") != "1":
                logger.warning(
                    "接口返回错误：%s %s，状态 %s",
                    request.method,
                    sanitize_log_text(request.url.path),
                    response.status_code,
                )
            return response
        except Exception as exc:
            log_exception(
                logger,
                f"接口处理异常：{request.method} {sanitize_log_text(request.url.path)}",
                exc,
            )
            ai_error = _find_nested_exception(exc, AIProviderError)
            if ai_error is not None:
                return _error_response(502, "ai_provider_error", str(ai_error))
            agent_error = _find_nested_exception(exc, AgentVNError)
            if agent_error is not None:
                return _error_response(400, "agentvn_error", str(agent_error))
            return _error_response(500, "internal_error", "后端服务异常，请查看后端日志。")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost",
            "http://127.0.0.1",
            "http://tauri.localhost",
            "https://tauri.localhost",
        ],
        allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|tauri\.localhost)(:\d+)?",
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(AIProviderError)
    async def handle_ai_provider_error(_request: Request, exc: AIProviderError) -> JSONResponse:
        log_exception(logger, "模型服务调用失败", exc)
        return _error_response(502, "ai_provider_error", str(exc))

    @app.exception_handler(AgentVNError)
    async def handle_agentvn_error(_request: Request, exc: AgentVNError) -> JSONResponse:
        log_exception(logger, "后端业务处理失败", exc)
        return _error_response(400, "agentvn_error", str(exc))

    @app.exception_handler(RequestValidationError)
    async def handle_request_validation_error(request: Request, exc: RequestValidationError):
        logger.warning(
            "接口参数校验失败：%s %s detail=%s",
            request.method,
            sanitize_log_text(request.url.path),
            sanitize_log_text(str(exc.errors()))[:8000],
        )
        response = await request_validation_exception_handler(request, exc)
        response.headers["X-AgentVN-Error-Logged"] = "1"
        return response

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(request: Request, exc: StarletteHTTPException):
        logger.warning(
            "接口返回错误：%s %s status=%s detail=%s",
            request.method,
            sanitize_log_text(request.url.path),
            exc.status_code,
            sanitize_log_text(str(exc.detail))[:8000],
        )
        response = await http_exception_handler(request, exc)
        response.headers["X-AgentVN-Error-Logged"] = "1"
        return response

    app.include_router(health_router, prefix="/api", tags=["health"])
    app.include_router(assistant_router, prefix="/api", tags=["assistant"])
    app.include_router(generate_router, prefix="/api", tags=["generation"])
    app.include_router(memory_router, prefix="/api", tags=["memory"])
    app.include_router(mcp_router, prefix="/api", tags=["mcp"])
    app.include_router(novel_import_router, prefix="/api", tags=["novel-import"])
    app.include_router(novel_ws_router, prefix="/api", tags=["novel-realtime"])
    app.include_router(novel_process_router, prefix="/api", tags=["novel-process"])
    app.include_router(novel_processing_router, prefix="/api", tags=["novel-processing"])
    app.include_router(provider_router, prefix="/api", tags=["providers"])
    app.include_router(project_router, prefix="/api", tags=["project"])
    return app


app = create_app()
