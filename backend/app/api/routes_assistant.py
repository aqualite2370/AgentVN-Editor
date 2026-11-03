"""Assistant chat routes."""

from collections.abc import Iterator
import json
import logging
import os
import re
import sqlite3
import threading
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from app.ai.context_budget import pack_text_context
from app.ai.provider import AIProvider
from app.api.deps import get_ai_provider, get_app_settings
from app.core.errors import AIProviderError
from app.core.error_logging import log_exception
from app.core.config import Settings
from app.db.init_db import init_db
from app.models.assistant_creation import AssistantComponentDraftBatch
from app.schemas.requests import (
    AssistantChatRequest,
    AssistantComponentDraftRequest,
    ProviderSelectionParameters,
)
from app.schemas.responses import AssistantChatResponse, AssistantCitationResponse
from app.services.assistant_creation_queue import AssistantCreationQueue
from app.services.assistant_creation_authorization import (
    AssistantCreationAuthorizationError,
    validate_creation_authorization,
)
from app.services.assistant_creation_agent import run_creation_agent
from app.services.assistant_creation_local_tools import event as creation_tool_event, public_tools, wait_local_tool, accept_local_result

router = APIRouter()
logger = logging.getLogger("agentvn.backend.assistant")


class _CreationRunner:
    """One process-local worker backed by the cross-process durable queue.

    The provider selection remains in this process memory. A task submitted by a
    process that disappears is marked failed instead of replaying credentials or
    issuing a second model request from another process.
    """

    def __init__(self, settings: Settings, provider: AIProvider) -> None:
        self.database_path = settings.resolved_database_path
        self.settings = settings
        self.provider = provider
        self.requests: dict[str, AssistantComponentDraftRequest] = {}
        self.lock = threading.Lock()
        self.wake = threading.Event()
        self.worker_id = f"assistant-{id(self):x}"
        self.thread = threading.Thread(target=self._run, name="agentvn-assistant-creation", daemon=True)
        self.thread.start()

    def attach(
        self,
        process_id: str,
        project_id: str,
        project_title: str,
        conversation_id: str,
        request: AssistantComponentDraftRequest,
    ):
        safe_payload = request.model_dump(exclude={"provider_selection"}, mode="json")
        safe_payload["_creation_owner_pid"] = os.getpid()
        conn = _open_creation_connection(self.settings)
        try:
            process = AssistantCreationQueue(conn).enqueue(
                process_id=process_id,
                project_id=project_id,
                project_title=project_title,
                conversation_id=conversation_id,
                payload=safe_payload,
            )
        finally:
            conn.close()
        # Publish local credentials only after the durable row is committed;
        # otherwise a fast worker can observe the ID before SQLite can.
        with self.lock:
            self.requests[process_id] = request
        self.wake.set()
        return process

    def _run(self) -> None:
        queue = AssistantCreationQueue(_open_creation_connection(self.settings))
        while True:
            with self.lock:
                request_ids = tuple(self.requests)
            eligible: set[str] = set()
            for process_id in request_ids:
                try:
                    status = queue.get_process(process_id).status
                except KeyError:
                    status = "failed"
                if status == "queued":
                    eligible.add(process_id)
                    queue.heartbeat(process_id, self.worker_id)
                elif status in {"completed", "failed", "cancelled"}:
                    with self.lock:
                        self.requests.pop(process_id, None)
            process = queue.claim_next(self.worker_id, eligible_ids=eligible)
            if process is None:
                self.wake.wait(0.15)
                self.wake.clear()
                continue
            with self.lock:
                request = self.requests.get(process.id)
            if request is None:
                queue.fail(process.id, self.worker_id, "request_lost", "提交进程没有保留本次请求，未执行模型调用。")
                continue
            try:
                if request.agent_tools:
                    result = run_creation_agent(self.provider, request, ASSISTANT_CREATION_SYSTEM_PROMPT,
                        _assistant_creation_prompt(request), _assistant_tools_selection(request),
                        local_action=lambda action, draft: wait_local_tool(queue, process.id, action, draft),
                        on_event=lambda tool, status: creation_tool_event(queue.conn, process.id, tool, status),
                        cancelled=lambda: queue.get_process(process.id).status != "running")
                else:
                    result = assistant_create_component_draft(request, self.provider)
                queue.complete(process.id, self.worker_id, result.model_dump(mode="json", exclude_none=True))
            except AssistantCreationAuthorizationError as exc:
                queue.fail(
                    process.id,
                    self.worker_id,
                    "proposal_not_authorized",
                    str(exc),
                )
            except Exception as exc:
                log_exception(logger, "创造进程执行失败", exc)
                queue.fail(
                    process.id,
                    self.worker_id,
                    "provider_error",
                    _sanitize_stream_error(str(exc)),
                )
            finally:
                with self.lock:
                    self.requests.pop(process.id, None)


_creation_runners: dict[Path, _CreationRunner] = {}
_creation_runners_lock = threading.Lock()


def _creation_runner(settings: Settings, provider: AIProvider) -> _CreationRunner:
    path = settings.resolved_database_path
    with _creation_runners_lock:
        runner = _creation_runners.get(path)
        if runner is None:
            conn = _open_creation_connection(settings)
            conn.close()
            runner = _CreationRunner(settings, provider)
            _creation_runners[path] = runner
    return runner


def _read_creation_processes(settings: Settings) -> AssistantCreationQueue:
    # Listing is also the first operation in a fresh editor session, before
    # any valid submission has started a runner. Use the schema-aware path.
    queue = AssistantCreationQueue(_open_creation_connection(settings))
    try:
        queue.recover_abandoned()
        return queue
    except Exception:
        queue.close()
        raise


def _open_creation_connection(settings: Settings) -> sqlite3.Connection:
    settings.resolved_database_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(settings.resolved_database_path, timeout=5)
    conn.row_factory = sqlite3.Row
    # Creation tasks use ordinary SQLite only, not the optional vector extension.
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    init_db(conn)
    return conn

ASSISTANT_SYSTEM_PROMPT = """你是 AgentVN 编辑器内的大模型助手。
你必须优先依据随请求提供的 AgentVN 文档片段回答，帮助用户理解编辑器功能、控件用途、项目工作流和实现某种效果的操作路径。
标有 current-operation-guide 的当前操作资料优先于 reference 设计/协议文档；历史设计、源码能力、正式发布和实际验收不是同一个状态，不把设计描述或资料存在当作已完成证明。
当前编辑器上下文只包含只读布局类型、页面、所选控件和进阶状态，不包含剧情或素材授权。给出真实入口和字段名，回答中标注所依据的资料序号；不得推断你拥有工程读写工具。
如果文档没有足够依据，请明确说明“不确定”或“当前文档没有覆盖”，不要编造不存在的按钮、接口或流程。
回答要用中文，面向正在使用编辑器的创作者，给出可执行步骤和必要提醒。
不要声称你已经实际修改了项目；你只提供建议。
"""

# Public presentation protocol only. This contains no project context, resources
# or permissions. scripts/assistant-component-protocol-test.cjs exercises each
# disclosed entry against both shared Editor and serialized Runtime boundaries.
ASSISTANT_COMPONENT_MARKUP_PROTOCOL = {
    "version": 1,
    "tags": ["div", "span", "p", "label", "button", "img"],
    "root": "Exactly one div with class=root. Each element has at most one supported class.",
    "classes": ["root", "title", "body", "button", "label", "group", "icon"],
    "attributes": ["class", "type", "data-bind", "data-action", "data-asset", "aria-label"],
    "actions": ["start_game", "open_save_load", "open_preferences", "open_history", "open_gallery",
                "open_about", "open_help", "close_menu", "rollback", "toggle_auto", "toggle_skip",
                "quick_save", "quick_load"],
    "bindings": ["project.title", "project.author", "asset.display_name", "asset.filename",
                 "runtime.scene_title", "runtime.speaker"],
    "selectors": "A single .CLASS, optionally :hover, :focus-visible or :disabled. No tag, descendant, compound or comma selectors.",
    "css_values": {
        "display": ["flex", "grid", "block", "inline", "inline-flex", "none"],
        "flex-direction": ["row", "column", "row-reverse", "column-reverse"],
        "align-items": ["start", "end", "center", "stretch", "baseline"],
        "justify-content": ["start", "end", "center", "space-between", "space-around", "space-evenly"],
        "gap": ["8px"], "width": ["32px"], "height": ["32px"],
        "min-width": ["0"], "min-height": ["0"], "max-width": ["100%"], "max-height": ["100%"],
        "padding": ["8px", "8px 12px"], "padding-inline": ["8px"], "padding-block": ["8px"],
        "margin": ["0"], "margin-inline": ["0"], "margin-block": ["0"],
        "color": ["#ffffff", "white", "transparent", "currentColor", "rgba(255,255,255,0.8)"],
        "background-color": ["#2b2b2b"], "border-color": ["#777777"],
        "border-width": ["1px"], "border-style": ["none", "solid", "dashed", "dotted"],
        "border-radius": ["4px"], "font-size": ["16px"],
        "font-weight": ["normal", "bold", "100", "200", "300", "400", "500", "600", "700", "800", "900"],
        "line-height": ["24px"], "text-align": ["left", "right", "center", "start", "end"],
        "white-space": ["normal", "nowrap", "pre-wrap"], "opacity": ["0", "0.5", "1"],
        "flex": ["none", "auto", "1", "1 1 0"],
        "overflow": ["visible", "hidden", "auto"],
        "object-fit": ["contain", "cover", "fill", "none", "scale-down"],
    },
    "value_rules": {
        "length": "0 or a non-negative number followed by px/rem/em/%/vh/vw; up to four space-separated values. No auto, negative values, calc or var.",
        "color": "Hex, numeric rgb/rgba/hsl/hsla, transparent/currentColor/black/white.",
        "opacity": "A number from 0 to 1.",
        "flex": "none, auto, or non-negative integer grow/shrink with optional 0 or px/%/em/rem basis.",
    },
    "image": "Use class=icon, aria-label and the exact explicitly authorized data-asset alias. Set width/height in .icon CSS, never HTML attributes. Example alias is illustrative and grants no access.",
    "button": "type=button and a listed data-action, only on button. Keep visible text and aria-label. No event handlers.",
    "exclusions": ["alt", "src", "width attribute", "height attribute", "style attribute", "id",
                   "arbitrary class names", "descendant selectors", "background", "box-sizing",
                   "at-rules", "comments", "scripts", "URLs", "url()", "var()", "calc()", "!important"],
    "limits": {"max_markup_characters": 32000, "max_nodes": 256, "max_depth": 16, "max_tool_calls": 12},
    "example": {
        "html": '<div class="root"><img class="icon" data-asset="AUTHORIZED_IMAGE_ALIAS" aria-label="徽章" />'
                '<span class="title">作品信息</span><button type="button" class="button" '
                'aria-label="打开关于" data-action="open_about">关于</button></div>',
        "css": ".root { display: flex; flex-direction: column; gap: 8px; padding: 8px; background-color: #2b2b2b; } "
               ".icon { width: 32px; height: 32px; object-fit: contain; } "
               ".title { color: #ffffff; font-size: 16px; } .button { color: #ffffff; }",
    },
}

ASSISTANT_CREATION_SYSTEM_PROMPT = """你是 AgentVN 创造工作区中的安全组件与布局修改 Agent。
你只能根据当前用户需求、当前创造会话消息、明确提供的隔离草稿和本次明确授权的控件，提交最多 16 项提案。
最终必须调用 submit_assistant_component_draft 工具；普通文本中的 JSON 不作为结果。
新增组件放在 components 数组，每项有 name、description、html、css 和 screen_id。screen_id 只能是 title、player、game_menu、save_load、preferences、history、gallery、about、help；不确定时选 title。需求只需要单个组件时只提交一项；组合界面按页面或独立职责拆分，不能为凑数量制造冗余组件。
修改已有布局控件放在 edits 数组，每项只能包含本请求 authorized_targets 中原样匹配的 target_id、screen_id，以及可选 label 和 rect。rect 只允许 x、y、width、height，所有值为画布百分比；只能在 0–100 画布内调整位置与尺寸。一次请求只涉及一个页面，同一 target 只能出现一次。不得输出 style、component_type、动作、结构、组件编号或未授权控件。
components 与 edits 至少有一个非空；用户明确请求修改现有控件时，优先提交 edits，不要用新增组件冒充修改。
组件使用受限 HTML/CSS 子集：仅 div、span、p、label、button、img；根节点唯一且为 div.root；
下附 COMPONENT_MARKUP_PROTOCOL 是本机实际解析器支持的完整呈现协议，不是通用网页HTML/CSS。只使用列出的类、属性、选择器及样式值规则；css_values枚举值逐项有效，长度/颜色示例可按value_rules调整。
图片使用.icon的CSS宽高与aria-label，不使用alt、HTML宽高、background缩写、box-sizing或任意自定义class。不要通过改为标签/后代选择器规避类名限制。
按钮动作仅可使用 AgentVN 已批准的 data-action；数据绑定仅可使用 AgentVN 已批准的 data-bind。
仅当请求提供了用户本会话明确选入的组件时，才可参考其中列出的结构；img 的 data-asset 只能原样引用 authorized_components.assets 或 authorized_assets 中列出的素材别名。不得使用 src 或外部 URL。
未选入的个人组件、工程素材、字体和文件均未授权；不得猜测、改写或拼接素材 ID，不得请求素材字节、外部 URL、脚本或自定义代码。
你不能读取或修改工程图、工程文件、其他工程、个人库、未提供的历史会话或编辑器状态；图片字节始终留在用户本机。
提交工具参数不代表写入项目；用户仍需在编辑器本地校验、预览并明确审核。
回答中文，遇到能力边界外的要求时应在 description 中如实说明，并给出最小安全草稿。
""" + "\nCOMPONENT_MARKUP_PROTOCOL=" + json.dumps(ASSISTANT_COMPONENT_MARKUP_PROTOCOL, ensure_ascii=False, separators=(",", ":"))


def build_context_text(request: AssistantChatRequest) -> str:
    chunks = []
    for index, chunk in enumerate(request.context_chunks, start=1):
        tags = f" 标签：{', '.join(chunk.tags)}" if chunk.tags else ""
        chunks.append(
            f"[{index}] {chunk.title}\n来源：{chunk.source}{tags}\n{chunk.text}"
        )
    editor_context = request.editor_context or "未提供当前编辑器上下文。"
    return "\n\n".join(
        [
            "当前编辑器上下文：",
            editor_context,
            "可参考的 AgentVN 文档片段：",
            "\n\n".join(chunks) if chunks else "未检索到相关文档片段。",
        ]
    )


def packed_context_text(request: AssistantChatRequest) -> tuple[str, dict[str, object]]:
    packed = pack_text_context(
        build_context_text(request),
        request.provider_selection,
        note="Assistant context combines selected docs, editor state and short chat history.",
    )
    return packed.text, packed.report


def _sse(event: str, data: object) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _sanitize_stream_error(message: str) -> str:
    sanitized = re.sub(r"sk-[A-Za-z0-9_\-]{6,}", "sk-***", message)
    sanitized = re.sub(r"(Bearer\s+)[^\s\"']+", r"\1***", sanitized, flags=re.IGNORECASE)
    return sanitized[:1200] or "助手请求失败。"


def _assistant_messages(request: AssistantChatRequest) -> list[dict[str, str]]:
    history = [
        {"role": message.role, "content": message.content}
        for message in request.messages[-12:]
        if message.content.strip()
    ]
    context_text, _report = packed_context_text(request)
    return [
        {"role": "user", "content": context_text},
        *history,
        {"role": "user", "content": request.question},
    ]


def _assistant_citations(request: AssistantChatRequest) -> list[AssistantCitationResponse]:
    return [
        AssistantCitationResponse(id=chunk.id, source=chunk.source, title=chunk.title)
        for chunk in request.context_chunks
    ]


def _assistant_creation_prompt(request: AssistantComponentDraftRequest) -> str:
    parts = [
        "根据以下数据创建或修改一组 AgentVN 安全组件草稿（最多 16 个）。",
        "用户本次需求：",
        request.user_request,
    ]
    if request.agent_tools:
        parts.append("本次支持实际工具循环：read_assistant_context读取授权快照，read_assistant_draft读取隔离候选，"
            "build_assistant_draft构建/更新候选，validate_assistant_draft请求本机白名单校验，"
            "preview_assistant_draft请求实际只读Runtime预览，submit_assistant_component_draft最终提交。"
            "工具是否开放以tools清单为准。优先每次返回一个调用；若返回多个调用，将先整体校验再按返回顺序串行执行。"
            "整个任务最多12次工具调用；最终提交只能是批次最后一项且最多一次。错误/不可用必须如实说明，不把请求视为成功。"
            "需要修正时更新草稿后重新校验；最终提交内容应与已校验/预览候选一致。"
            "开始构建前按系统消息中的COMPONENT_MARKUP_PROTOCOL选择合法结构；本机拒绝后一次核对并修正同类问题，"
            "不要反复尝试通用网页语法。预留校验、预览和最终提交所需预算，不为重复读取未变化的草稿浪费调用。")
    if request.messages:
        parts.extend([
            "当前创造会话的最近对话（仅作本次需求上下文）：",
            json.dumps(
                [message.model_dump(mode="json") for message in request.messages],
                ensure_ascii=False,
            ),
        ])
    if request.current_draft is not None:
        parts.extend([
            "当前会话草稿（仅允许在此基础上提出修改）：",
            request.current_draft.model_dump_json(),
        ])
    if request.authorized_components:
        parts.extend([
            "用户为本次会话明确选入的个人组件与素材授权清单（只能使用这里列出的内容；素材字节未发送）：",
            json.dumps(
                [component.model_dump(mode="json") for component in request.authorized_components],
                ensure_ascii=False,
            ),
        ])
    else:
        parts.append("本会话没有选入任何个人组件。")
    if request.authorized_assets:
        parts.extend([
            "用户为本次会话明确选入的工程图片（仅别名、文件名与格式；图片字节、路径与内部ID未发送）：",
            json.dumps([asset.model_dump(mode="json") for asset in request.authorized_assets], ensure_ascii=False),
        ])
    if not request.authorized_assets and not any(component.assets for component in request.authorized_components):
        parts.append("本次没有授权任何图片素材；不得引用图片或工程素材。")
    if request.authorized_targets:
        parts.extend([
            "本次用户明确授权修改的现有控件（只可使用这些 target_id；每项只展示必要字段）：",
            json.dumps(
                [target.model_dump(mode="json", exclude_none=True) for target in request.authorized_targets],
                ensure_ascii=False,
            ),
        ])
    else:
        parts.append("本次没有授权修改任何现有控件；edits 必须为空。")
    parts.append(
        "提交 1 至 16 项组件或控件修改提案。组件按页面/职责拆分；修改必须引用本次已授权 target_id；"
        "HTML/CSS 后续还会经过编辑器安全子集校验，控件修改还会由本机再次校验；"
        "不得声明已保存、已添加到布局或修改了任何项目。"
    )
    return "\n\n".join(parts)


def _assistant_tools_selection(request: AssistantComponentDraftRequest):
    selection = request.provider_selection
    if selection is None:
        return None
    parameters = selection.parameters or ProviderSelectionParameters()
    forced_parameters = parameters.model_copy(update={"structured_mode": "tools"})
    return selection.model_copy(update={"parameters": forced_parameters})


@router.post("/assistant/chat", response_model=AssistantChatResponse)
def assistant_chat(
    request: AssistantChatRequest,
    provider: AIProvider = Depends(get_ai_provider),
) -> AssistantChatResponse:
    answer = provider.create_chat(
        ASSISTANT_SYSTEM_PROMPT,
        _assistant_messages(request),
        selection=request.provider_selection,
    )
    return AssistantChatResponse(answer=answer, citations=_assistant_citations(request))


@router.post(
    "/assistant/creation/component",
    response_model=AssistantComponentDraftBatch,
    response_model_exclude_none=True,
)
def assistant_create_component_draft(
    request: AssistantComponentDraftRequest,
    provider: AIProvider = Depends(get_ai_provider),
) -> AssistantComponentDraftBatch:
    """Return a bounded set of schema-validated proposals without project write access."""
    if request.agent_tools:
        return run_creation_agent(provider, request, ASSISTANT_CREATION_SYSTEM_PROMPT,
            _assistant_creation_prompt(request), _assistant_tools_selection(request))
    result = provider.create_with_tools(
        AssistantComponentDraftBatch,
        ASSISTANT_CREATION_SYSTEM_PROMPT,
        _assistant_creation_prompt(request),
        selection=_assistant_tools_selection(request),
    )
    return validate_creation_authorization(request, result)


@router.post("/assistant/creation/processes", status_code=202)
def enqueue_assistant_creation_process(
    payload: dict[str, object],
    provider: AIProvider = Depends(get_ai_provider),
    settings: Settings = Depends(get_app_settings),
) -> dict[str, object]:
    process_id = payload.get("id")
    project_id = payload.get("project_id")
    project_title = payload.get("project_title")
    conversation_id = payload.get("conversation_id")
    raw_request = payload.get("request")
    if not all(isinstance(value, str) and value.strip() for value in (
        process_id, project_id, project_title, conversation_id,
    )) or not isinstance(raw_request, dict):
        raise HTTPException(status_code=422, detail="创造进程标识或请求无效。")
    try:
        request = AssistantComponentDraftRequest.model_validate(raw_request)
    except ValidationError as exc:
        # Do not expose raw validation inputs (which may contain credentials).
        # Invalid requests must never create a runner or a persisted process.
        raise HTTPException(status_code=422, detail="创造请求包含无效或未授权字段，请重新选择授权后重试。") from exc
    runner = _creation_runner(settings, provider)
    process = runner.attach(
        process_id=process_id,
        project_id=project_id,
        project_title=project_title,
        conversation_id=conversation_id,
        request=request,
    )
    queue = _read_creation_processes(settings)
    try:
        return queue.public_process(process.id)
    finally:
        queue.close()


@router.get("/assistant/creation/processes")
def list_assistant_creation_processes(
    provider: AIProvider = Depends(get_ai_provider),
    settings: Settings = Depends(get_app_settings),
) -> dict[str, object]:
    queue = _read_creation_processes(settings)
    try:
        return {"processes": [{**process.public(), **public_tools(queue.conn, process.id, include_request=False)}
            for process in queue.list_processes()]}
    finally:
        queue.close()


@router.get("/assistant/creation/processes/{process_id}")
def get_assistant_creation_process(
    process_id: str,
    provider: AIProvider = Depends(get_ai_provider),
    settings: Settings = Depends(get_app_settings),
) -> dict[str, object]:
    queue = _read_creation_processes(settings)
    try:
        return {**queue.public_process(process_id), **public_tools(queue.conn, process_id)}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="创造进程不存在。") from exc
    finally:
        queue.close()


@router.post("/assistant/creation/processes/{process_id}/local-result")
def assistant_creation_local_result(process_id: str, payload: dict[str, object],
                                    settings: Settings = Depends(get_app_settings)):
    queue = _read_creation_processes(settings)
    try:
        accept_local_result(queue.conn, process_id, payload)
        return {"ok": True}
    except LookupError as exc:
        raise HTTPException(status_code=409, detail="本机工具回执归属或请求已变化，未采纳。") from exc
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail="本机工具回执无效，未采纳。") from exc
    finally:
        queue.close()


@router.post("/assistant/creation/processes/{process_id}/cancel")
def cancel_assistant_creation_process(
    process_id: str,
    provider: AIProvider = Depends(get_ai_provider),
    settings: Settings = Depends(get_app_settings),
) -> dict[str, object]:
    queue = _read_creation_processes(settings)
    try:
        queue.request_cancel(process_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="创造进程不存在。") from exc
    finally:
        queue.close()
    runner = _creation_runners.get(settings.resolved_database_path)
    if runner is not None:
        runner.wake.set()
    queue = _read_creation_processes(settings)
    try:
        return queue.public_process(process_id)
    finally:
        queue.close()


def _stream_assistant_events(request: AssistantChatRequest, provider: AIProvider) -> Iterator[str]:
    citations = _assistant_citations(request)
    try:
        yield _sse("status", f"已检索 {len(request.context_chunks)} 条 AgentVN 文档片段，正在请求模型...")
        answer = provider.create_chat(
            ASSISTANT_SYSTEM_PROMPT,
            _assistant_messages(request),
            selection=request.provider_selection,
        )
        if answer:
            yield _sse("delta", answer)
        yield _sse("citations", [citation.model_dump(mode="json") for citation in citations])
        yield _sse("final", AssistantChatResponse(answer=answer, citations=citations).model_dump(mode="json"))
        yield _sse("done", {"ok": True})
    except Exception as exc:
        log_exception(logger, "助手流式接口失败", exc)
        message = str(exc) if isinstance(exc, AIProviderError) else "助手流式请求失败，请查看后端日志。"
        yield _sse("error", {"message": _sanitize_stream_error(message)})
        yield _sse("done", {"ok": False})


@router.post("/assistant/chat_stream")
def assistant_chat_stream(
    request: AssistantChatRequest,
    provider: AIProvider = Depends(get_ai_provider),
) -> StreamingResponse:
    return StreamingResponse(
        _stream_assistant_events(request, provider),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache"},
    )
