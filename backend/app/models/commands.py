"""Visual novel runtime command contracts."""

from enum import Enum
import re
from typing import Annotated, Any, Literal

from pydantic import Field, model_serializer, model_validator

from app.models.common import JsonValue, StrictBaseModel


class CharacterSide(str, Enum):
    LEFT = "left"
    RIGHT = "right"
    CENTER = "center"


class StateOperation(str, Enum):
    SET = "set"
    SET_IF_UNSET = "set_if_unset"
    ADD = "add"
    SUBTRACT = "subtract"
    TOGGLE = "toggle"
    APPEND = "append"
    REMOVE = "remove"


class BgmAction(str, Enum):
    PLAY = "play"
    STOP = "stop"
    FADE = "fade"


class BackgroundFit(str, Enum):
    STRETCH = "stretch"
    CONTAIN = "contain"
    COVER = "cover"


class StateValueType(str, Enum):
    BOOLEAN = "boolean"
    NUMBER = "number"
    TEXT = "text"
    LIST = "list"


class ConditionOperator(str, Enum):
    EQUALS = "equals"
    NOT_EQUALS = "not_equals"
    GREATER_THAN = "greater_than"
    LESS_THAN = "less_than"
    GREATER_OR_EQUAL = "greater_or_equal"
    LESS_OR_EQUAL = "less_or_equal"
    TRUTHY = "truthy"
    FALSY = "falsy"
    INCLUDES = "includes"
    NOT_INCLUDES = "not_includes"


class Condition(StrictBaseModel):
    key: str
    operator: ConditionOperator
    value: JsonValue = None


class DialogVisualStyle(StrictBaseModel):
    background_asset_id: str | None = None
    background_fit: BackgroundFit | None = None
    theme_color: str | None = None
    text_color: str | None = None
    font_size: float | None = Field(default=None, ge=1)
    font_weight: int | None = Field(default=None, ge=1, le=1000)
    font_style: Literal["normal", "italic"] | None = None


class VisualTransitionConfig(StrictBaseModel):
    kind: Literal[
        "none",
        "fade",
        "crossfade",
        "reveal_center",
        "wipe_left_to_right",
        "wipe_right_to_left",
        "blur",
        "slide_left",
        "slide_right",
        "slide_up",
        "slide_down",
    ]
    duration_ms: int | None = Field(default=None, ge=0)
    easing: str | None = None


class CharacterAnimationKeyframe(StrictBaseModel):
    offset: float = Field(..., ge=0.0, le=1.0)
    opacity: float | None = None
    x: float | None = None
    y: float | None = None
    scale: float | None = None
    rotate: float | None = None
    blur: float | None = None
    brightness: float | None = None
    easing: str | None = None


class CharacterSpriteAnimationConfig(StrictBaseModel):
    kind: Literal["none", "fade", "move", "tween", "preset"]
    phase: Literal["enter", "exit", "emphasis"]
    duration_ms: int | None = Field(default=None, ge=0)
    delay_ms: int | None = Field(default=None, ge=0)
    easing: str | None = None
    direction: Literal["left", "right", "up", "down", "center", "none"] | None = None
    transform_origin: str | None = None
    keyframes: list[CharacterAnimationKeyframe] | None = None
    blocking: bool | None = None
    display_name: str | None = None
    preset_id: str | None = None


class DialogCommand(StrictBaseModel):
    type: Literal["dialog"] = "dialog"
    character_id: str
    text: str
    emotion: str | None = None
    portrait: str | None = None
    voice: str | None = None
    side: CharacterSide | None = None
    font_asset_id: str | None = None
    dialog_style: DialogVisualStyle | None = None
    dialog_style_mode: Literal["inherit", "manual"] | None = None


class NarrationCommand(StrictBaseModel):
    type: Literal["narration"] = "narration"
    text: str
    font_asset_id: str | None = None
    dialog_style: DialogVisualStyle | None = None
    dialog_style_mode: Literal["inherit", "manual"] | None = None


class HideDialogCommand(StrictBaseModel):
    type: Literal["hide_dialog"] = "hide_dialog"


class BackgroundCommand(StrictBaseModel):
    type: Literal["background"] = "background"
    background_id: str
    background_fit: BackgroundFit | None = None
    transition: str | None = None
    transition_display_name: str | None = None
    transition_config: VisualTransitionConfig | None = None


class ShowImageCommand(StrictBaseModel):
    type: Literal["show_image"] = "show_image"
    image_id: str
    image_fit: BackgroundFit = BackgroundFit.CONTAIN
    image_display_name: str | None = None
    caption: str | None = None
    alt: str | None = None
    backdrop_opacity: float = Field(default=0.62, ge=0.0, le=0.9)
    backdrop_blur_px: float = Field(default=12.0, ge=0.0, le=24.0)


class VideoCommand(StrictBaseModel):
    type: Literal["video"] = "video"
    video_id: str
    video_fit: BackgroundFit = BackgroundFit.CONTAIN
    fade_in_ms: int = Field(default=500, ge=0, le=10000)
    fade_out_ms: int = Field(default=500, ge=0, le=10000)


class SpriteCommand(StrictBaseModel):
    type: Literal["sprite"] = "sprite"
    character_id: str
    sprite_id: str
    position: str | None = None
    layer: int | None = None
    animation: str | None = None
    animation_display_name: str | None = None
    animation_config: CharacterSpriteAnimationConfig | None = None
    switch_transition: VisualTransitionConfig | None = None
    scale: float | None = Field(default=None, gt=0)
    visible: bool = True


class Choice(StrictBaseModel):
    choice_id: str
    choice_display_name: str | None = None
    text: str
    target_scene_id: str
    conditions: list[str | Condition] = Field(default_factory=list)


class ChoiceCommand(StrictBaseModel):
    type: Literal["choice"] = "choice"
    choices: list[Choice]


class StateUpdateCommand(StrictBaseModel):
    type: Literal["state_update"] = "state_update"
    key: str
    operation: StateOperation
    value: JsonValue = None
    value_type: StateValueType | None = None


class ConditionalJumpCommand(StrictBaseModel):
    type: Literal["conditional_jump"] = "conditional_jump"
    condition: str | Condition
    target_scene_id: str
    else_target_scene_id: str | None = None


class JumpCommand(StrictBaseModel):
    type: Literal["jump"] = "jump"
    target_scene_id: str


class AnimationCommand(StrictBaseModel):
    type: Literal["animation"] = "animation"
    animation_id: str
    animation_display_name: str | None = None
    target: str
    params: dict[str, Any] = Field(default_factory=dict)
    blocking: bool = True


class BgmCommand(StrictBaseModel):
    type: Literal["bgm"] = "bgm"
    bgm_id: str | None = None
    action: BgmAction
    volume: float | None = Field(default=None, ge=0.0, le=1.0)
    fade_ms: int | None = Field(default=None, ge=0)


class SfxCommand(StrictBaseModel):
    type: Literal["sfx"] = "sfx"
    sfx_id: str
    volume: float | None = Field(default=None, ge=0.0, le=1.0)


class CameraPoseV1(StrictBaseModel):
    center_x: float = Field(..., ge=0.0, le=1.0)
    center_y: float = Field(..., ge=0.0, le=1.0)
    zoom: float = Field(..., ge=0.5, le=4.0)


_CAMERA_EASING_PRESETS = {"linear", "ease", "ease-in", "ease-out", "ease-in-out"}
_CAMERA_BEZIER_PATTERN = re.compile(
    r"^cubic-bezier\(\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*"
    r"([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*"
    r"([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*"
    r"([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*\)$"
)


def _valid_camera_easing(value: str) -> bool:
    if value in _CAMERA_EASING_PRESETS:
        return True
    match = _CAMERA_BEZIER_PATTERN.fullmatch(value)
    if not match:
        return False
    x1, y1, x2, y2 = (float(item) for item in match.groups())
    return 0.0 <= x1 <= 1.0 and -1.0 <= y1 <= 2.0 and 0.0 <= x2 <= 1.0 and -1.0 <= y2 <= 2.0


class CameraReframeMotionV1(StrictBaseModel):
    schema_version: Literal[1] = 1
    kind: Literal["reframe"] = "reframe"
    to: CameraPoseV1
    duration_ms: int = Field(..., ge=0, le=10000)
    easing: str
    unsafe_overscan: Literal[True] | None = None

    @model_validator(mode="after")
    def validate_motion(self) -> "CameraReframeMotionV1":
        if not _valid_camera_easing(self.easing):
            raise ValueError("缓动曲线无法使用，请选择预设或重新填写。")
        zoom = self.to.zoom
        safe = (
            zoom >= 1.0
            and 0.5 / zoom <= self.to.center_x <= 1.0 - 0.5 / zoom
            and 0.5 / zoom <= self.to.center_y <= 1.0 - 0.5 / zoom
        )
        if not safe and self.unsafe_overscan is not True:
            raise ValueError("这个构图会露出舞台边缘，请明确允许露底。")
        return self


class CameraSequenceShotV1(StrictBaseModel):
    to: CameraPoseV1
    duration_ms: int = Field(..., ge=0, le=10000)
    easing: str

    @model_validator(mode="after")
    def validate_shot(self) -> "CameraSequenceShotV1":
        if not _valid_camera_easing(self.easing):
            raise ValueError("缓动曲线无法使用，请选择预设或重新填写。")
        return self


class CameraSequenceMotionV1(StrictBaseModel):
    schema_version: Literal[1] = 1
    kind: Literal["sequence"] = "sequence"
    shots: list[CameraSequenceShotV1] = Field(..., min_length=2, max_length=4)
    unsafe_overscan: Literal[True] | None = None

    @model_validator(mode="after")
    def validate_motion(self) -> "CameraSequenceMotionV1":
        for shot in self.shots:
            zoom = shot.to.zoom
            safe = (
                zoom >= 1.0
                and 0.5 / zoom <= shot.to.center_x <= 1.0 - 0.5 / zoom
                and 0.5 / zoom <= shot.to.center_y <= 1.0 - 0.5 / zoom
            )
            if not safe and self.unsafe_overscan is not True:
                raise ValueError("连续运镜包含会露出舞台边缘的构图，请明确允许露底。")
        return self


class CameraResetMotionV1(StrictBaseModel):
    schema_version: Literal[1] = 1
    kind: Literal["reset"] = "reset"
    duration_ms: int = Field(..., ge=0, le=10000)
    easing: str

    @model_validator(mode="after")
    def validate_motion(self) -> "CameraResetMotionV1":
        if not _valid_camera_easing(self.easing):
            raise ValueError("缓动曲线无法使用，请选择预设或重新填写。")
        return self


class CameraShakeMotionV1(StrictBaseModel):
    schema_version: Literal[1] = 1
    kind: Literal["shake"] = "shake"
    direction: Literal["horizontal", "vertical", "omni"]
    intensity: float = Field(..., ge=0.0, le=1.0)
    duration_ms: int = Field(..., ge=0, le=3000)


class CameraImpactMotionV1(StrictBaseModel):
    schema_version: Literal[1] = 1
    kind: Literal["impact"] = "impact"
    direction: Literal["from_left", "from_right", "from_top", "from_bottom", "omni"]
    intensity: float = Field(..., ge=0.0, le=1.0)
    duration_ms: int = Field(..., ge=0, le=3000)


CameraMotionV1 = Annotated[
    CameraReframeMotionV1
    | CameraSequenceMotionV1
    | CameraResetMotionV1
    | CameraShakeMotionV1
    | CameraImpactMotionV1,
    Field(discriminator="kind"),
]


class CameraCommand(StrictBaseModel):
    type: Literal["camera"] = "camera"
    action: str | None = None
    params: dict[str, Any] | None = None
    motion: CameraMotionV1 | None = None
    blocking: bool = True

    @model_validator(mode="after")
    def validate_format(self) -> "CameraCommand":
        has_motion = self.motion is not None
        has_legacy = self.action is not None or self.params is not None
        if has_motion and has_legacy:
            raise ValueError("这条运镜同时包含新旧设置，请保留其中一种格式。")
        if isinstance(self.motion, CameraSequenceMotionV1) and self.blocking is not True:
            raise ValueError("连续运镜必须等待整条路径播放结束后再继续剧情。")
        if not has_motion and self.action is None:
            raise ValueError("旧版运镜缺少动作名称。")
        if not has_motion and self.params is None:
            self.params = {}
        return self

    @model_serializer(mode="wrap")
    def serialize_camera(self, handler):
        payload = handler(self)
        return {key: value for key, value in payload.items() if value is not None}


class WaitCommand(StrictBaseModel):
    type: Literal["wait"] = "wait"
    duration_ms: int = Field(..., ge=0)


GameCommand = Annotated[
    DialogCommand
    | NarrationCommand
    | HideDialogCommand
    | BackgroundCommand
    | ShowImageCommand
    | VideoCommand
    | SpriteCommand
    | ChoiceCommand
    | StateUpdateCommand
    | ConditionalJumpCommand
    | JumpCommand
    | AnimationCommand
    | BgmCommand
    | SfxCommand
    | CameraCommand
    | WaitCommand,
    Field(discriminator="type"),
]
