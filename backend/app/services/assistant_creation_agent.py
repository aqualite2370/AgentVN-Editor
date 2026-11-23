"""Per-submission tools. No project files, store access or author-script execution."""
from pydantic import BaseModel, ValidationError
from app.core.errors import AIProviderError
from app.models.assistant_creation import AssistantComponentDraftBatch
from app.schemas.requests import AssistantComponentDraftRequest
from app.services.assistant_creation_authorization import validate_creation_authorization


class EmptyArguments(BaseModel):
    model_config = {"extra": "forbid"}


class AssistantCreationAgent:
    def __init__(self, request: AssistantComponentDraftRequest, *, local_action=None, on_event=None, cancelled=None):
        self.request = request
        self.local_action = local_action
        self.on_event = on_event or (lambda *_args: None)
        self.cancelled = cancelled or (lambda: False)
        self.draft = AssistantComponentDraftBatch(components=[request.current_draft]) if request.current_draft else None
        self.models = {
            "read_assistant_context": EmptyArguments,
            "read_assistant_draft": EmptyArguments,
            "build_assistant_draft": AssistantComponentDraftBatch,
            "submit_assistant_component_draft": AssistantComponentDraftBatch,
        }
        if local_action:
            self.models.update(validate_assistant_draft=EmptyArguments, preview_assistant_draft=EmptyArguments)

    def tools(self):
        descriptions = {
            "read_assistant_context": "Read only this submission's authorized templates, image aliases and selected controls. No files or unapproved context.",
            "read_assistant_draft": "Read the current isolated candidate batch. No project writes.",
            "build_assistant_draft": "Replace isolated candidates with typed, explicitly authorized component/control proposals. This does not save or merge.",
            "validate_assistant_draft": "Ask the owning local Editor shared parser to validate the current draft. Returns actual success/failure/unavailable.",
            "preview_assistant_draft": "Ask the owning local Editor to render the current draft in isolated Runtime and return bounded geometry diagnostics. No actions executed.",
            "submit_assistant_component_draft": "Submit the final authorized proposals for local checks and human review. Does not write a project.",
        }
        return [{"type": "function", "function": {"name": name, "description": descriptions[name],
            "parameters": model.model_json_schema()}} for name, model in self.models.items()]

    def validate_call(self, name: str, arguments: str):
        """Pure preflight: no events, local callbacks, draft changes or project writes."""
        if name not in self.models:
            raise AIProviderError("模型调用了本次未开放的创造工具。")
        if not isinstance(arguments, str) or len(arguments) > 512000:
            raise AIProviderError("创造工具参数超过限制。")
        try:
            value = self.models[name].model_validate_json(arguments)
        except ValidationError:
            # Pydantic messages may contain authorized content or model text.
            raise AIProviderError("创造工具参数未通过类型校验；未执行本批工具。") from None
        if name in {"build_assistant_draft", "submit_assistant_component_draft"}:
            validate_creation_authorization(self.request, value)

    def execute(self, name: str, arguments: str):
        if self.cancelled(): raise AIProviderError("创造任务已取消；没有继续模型调用。")
        if name not in self.models: raise AIProviderError("模型调用了本次未开放的创造工具。")
        if not isinstance(arguments, str) or len(arguments) > 512000:
            raise AIProviderError("创造工具参数超过限制。")
        self.on_event(name, "started")
        try:
            value = self.models[name].model_validate_json(arguments)
            if name == "read_assistant_context":
                output = {"components": [item.model_dump(exclude_none=True) for item in self.request.authorized_components],
                    "assets": [item.model_dump() for item in self.request.authorized_assets],
                    "targets": [item.model_dump(exclude_none=True) for item in self.request.authorized_targets]}
            elif name == "read_assistant_draft":
                output = {"draft": self.draft.model_dump(exclude_none=True) if self.draft else None}
            elif name in {"build_assistant_draft", "submit_assistant_component_draft"}:
                value = validate_creation_authorization(self.request, value)
                self.draft = value
                if name == "submit_assistant_component_draft":
                    self.on_event(name, "completed")
                    return value, True
                output = {"ok": True, "component_count": len(value.components), "edit_count": len(value.edits),
                    "scope": "isolated draft only; local markup validation still required"}
            elif self.draft is None:
                output = {"ok": False, "status": "unavailable", "issues": ["请先构建隔离草稿。"]}
            else:
                output = self.local_action(name, self.draft)
            self.on_event(name, "failed" if isinstance(output, dict) and output.get("ok") is False else "completed")
            return output, False
        except AIProviderError:
            self.on_event(name, "failed")
            raise
        except Exception:
            self.on_event(name, "failed")
            return {"ok": False, "status": "invalid_arguments", "issues": ["工具参数未通过类型或权限校验。"]}, False


def run_creation_agent(provider, request: AssistantComponentDraftRequest, system: str, prompt: str, selection,
                       *, local_action=None, on_event=None, cancelled=None):
    agent = AssistantCreationAgent(request, local_action=local_action, on_event=on_event, cancelled=cancelled)
    return provider.create_agent_tools(system, prompt, agent.tools(), agent.execute, selection=selection,
        cancelled=agent.cancelled, max_steps=12, validate=agent.validate_call,
        terminal_tool="submit_assistant_component_draft")
