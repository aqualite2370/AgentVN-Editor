"""Validate model proposals against the submission's explicit authorization.

The backend never writes a layout. This boundary prevents an unauthorized
proposal from being returned or persisted as a successfully completed draft.
The editor still performs markup validation and baseline checks before merging.
"""

from html.parser import HTMLParser

from app.core.errors import AIProviderError
from app.models.assistant_creation import AssistantComponentDraftBatch
from app.schemas.requests import AssistantComponentDraftRequest


class AssistantCreationAuthorizationError(AIProviderError):
    """A typed model response exceeded the current request's permissions."""


class _AssetReferences(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids: set[str] = set()

    def handle_starttag(self, tag, attrs):
        for name, value in attrs:
            if name == "data-asset":
                self.ids.add(value or "")

    handle_startendtag = handle_starttag


def validate_creation_authorization(
    request: AssistantComponentDraftRequest,
    result: AssistantComponentDraftBatch,
) -> AssistantComponentDraftBatch:
    authorized_assets = {asset.id for asset in request.authorized_assets}
    authorized_assets.update(asset.id for component in request.authorized_components for asset in component.assets)
    for component in result.components:
        references = _AssetReferences()
        references.feed(component.html)
        if not references.ids.issubset(authorized_assets):
            raise AssistantCreationAuthorizationError(
                "模型提案引用了本次未授权的图片素材；未创建草稿，请重新选择授权后重试。"
            )
    targets = {target.target_id: target for target in request.authorized_targets}
    for edit in result.edits:
        target = targets.get(edit.target_id)
        if target is None or target.screen_id != edit.screen_id:
            # Do not echo raw model data, project identifiers or credentials.
            raise AssistantCreationAuthorizationError(
                "模型提案引用了本次未授权的控件或页面；未创建草稿，请重新选择授权后重试。"
            )
        if edit.rect is not None:
            if target.rect is None:
                raise AssistantCreationAuthorizationError(
                    "所选控件没有完整原始位置，不能校验位置修改；未创建草稿。"
                )
            final_rect = {
                **target.rect.model_dump(exclude_none=True),
                **edit.rect.model_dump(exclude_none=True),
            }
            if (final_rect["x"] + final_rect["width"] > 100
                    or final_rect["y"] + final_rect["height"] > 100):
                raise AssistantCreationAuthorizationError(
                    "模型提案的位置或尺寸超出画布；未创建草稿，请调整需求后重试。"
                )
    return result
