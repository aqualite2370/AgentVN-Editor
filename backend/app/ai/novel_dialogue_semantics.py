"""Dialogue grounding and semantic validation for novel processing."""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Literal

from app.models.commands import DialogCommand, NarrationCommand
from app.models.novel_import import CharacterCandidate
from app.models.novel_process import SubagentModelOutput


SemanticIssueCode = Literal[
    "speaker_prefixed_narration",
    "merged_multi_speaker_command",
    "speaker_structure_unresolved",
    "narration_as_dialogue",
    "untrusted_dialogue_speaker",
    "narration_disguised_as_dialogue",
    "missing_narration_commands",
]

RESERVED_COLON_LABELS = {
    "时间",
    "地点",
    "章节",
    "提示",
    "注意",
    "留言",
    "系统",
    "旁白",
    "标题",
    "摘要",
    "场景",
    "作者",
    "日期",
    "状态",
    "说明",
    "备注",
    "警告",
    "选项",
    "time",
    "location",
    "chapter",
    "system",
    "narration",
    "narrator",
    "note",
    "warning",
}
SPEAKER_PRONOUNS = {
    "我",
    "你",
    "他",
    "她",
    "它",
    "我们",
    "你们",
    "他们",
    "她们",
    "它们",
    "大家",
    "有人",
    "那人",
    "这人",
    "后者",
    "前者",
    "对方",
    "自己",
}
SPEAKER_PRONOUN_PREFIXES = (
    "我",
    "你",
    "他",
    "她",
    "它",
    "我们",
    "你们",
    "他们",
    "她们",
    "它们",
)
INVALID_SPEAKER_PREFIXES = (
    "不等",
    "没等",
    "等到",
    "如果",
    "因为",
    "所以",
    "然后",
    "但是",
    "但他",
    "但她",
    "而且",
    "只是",
    "那就",
    "让他",
    "让她",
    "听说",
    "发现",
    "原来",
    "其实",
    "在道别时",
    "随口",
)
SPEECH_OR_ACTION_MARKERS = (
    "粗声粗气地开口",
    "压低声音",
    "用粗嗓门",
    "用标准的普通话",
    "大声说道",
    "低声说道",
    "轻声说道",
    "开口说道",
    "大声说",
    "低声说",
    "轻声说",
    "开口说",
    "回答道",
    "重复道",
    "讲道",
    "答道",
    "问道",
    "喊道",
    "叫道",
    "凑近",
    "看着",
    "望着",
    "转向",
    "回头",
    "点点头",
    "摇摇头",
    "微笑着",
    "笑着",
    "愤怒地",
    "呆呆地",
    "机械地",
    "不安地",
    "简单地",
    "厉声",
    "小声",
    "对同事",
)
CHAT_LINE_PATTERN = re.compile(
    r"(?m)^[ \t]*(?P<speaker>[A-Za-z][A-Za-z0-9_ .-]{0,31}|[\u3400-\u9fff]{1,12})[ \t]*[：:]"
)
INLINE_CHAT_PATTERN = re.compile(
    r"(?:^|[\s。！？?!；;])(?P<speaker>[A-Za-z][A-Za-z0-9_ .-]{0,31}|[\u3400-\u9fff]{1,12})[ \t]*[：:]"
)
QUOTED_PROSE_PATTERN = re.compile(
    r"“[^”]*”|‘[^’]*’|\"[^\"\n]*\"",
    re.DOTALL,
)
INVENTED_NARRATION_LABEL_PATTERN = re.compile(
    r"^\s*[（(【\[]\s*(?:内心独白|旁白|叙述|心理活动)\s*[）)】\]]\s*"
)
CHAPTER_HEADING_PATTERN = re.compile(
    r"(?m)^\s*(?:第[0-9零一二三四五六七八九十百千万两]+章\b[^\n]*|Chapter\s+\d+\b[^\n]*)\s*$",
    re.IGNORECASE,
)
HUMAN_ROLE_TERMS = tuple(
    sorted(
        {
            "中情局",
            "情报官员",
            "年轻警官",
            "少校军官",
            "纳米研究中心主任",
            "总工程师",
            "工程师",
            "警官",
            "军官",
            "少校",
            "中校",
            "上校",
            "将军",
            "官员",
            "主任",
            "司机",
            "首长",
            "队长",
            "教授",
            "博士",
            "同事",
        },
        key=len,
        reverse=True,
    )
)


@dataclass(frozen=True)
class DialogueSemanticIssue:
    code: SemanticIssueCode
    scene_index: int
    command_index: int
    evidence: str
    message: str
    container: Literal["scenes", "fragment"] = "scenes"

    @property
    def path(self) -> str:
        if self.container == "fragment":
            return f"fragment.commands[{self.command_index}]"
        return f"scenes[{self.scene_index}].commands[{self.command_index}]"


def _clean_chat_speaker(value: str) -> str | None:
    name = value.strip()
    key = name.casefold()
    if (
        not name
        or key in RESERVED_COLON_LABELS
        or key in SPEAKER_PRONOUNS
        or name.isdigit()
        or len(name) > 32
        or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_ .-]{0,31}|[\u3400-\u9fff]{1,12}", name)
        or name.startswith(INVALID_SPEAKER_PREFIXES)
        or any(marker in name for marker in SPEECH_OR_ACTION_MARKERS)
        or name.endswith(("说", "问", "是"))
    ):
        return None
    return name


def detect_speaker_names(text: str, limit: int = 60) -> list[str]:
    """Extract only explicit chat-record nicknames, never prose attributions."""

    found: list[tuple[int, str]] = []
    for match in CHAT_LINE_PATTERN.finditer(text):
        name = _clean_chat_speaker(match.group("speaker"))
        if name:
            found.append((match.start("speaker"), name))

    offset = 0
    for paragraph in re.split(r"(\n{2,})", text):
        if not paragraph or re.fullmatch(r"\n{2,}", paragraph):
            offset += len(paragraph)
            continue
        matches = [
            match
            for match in INLINE_CHAT_PATTERN.finditer(paragraph)
            if _clean_chat_speaker(match.group("speaker"))
        ]
        if len(matches) >= 2:
            for match in matches:
                name = _clean_chat_speaker(match.group("speaker"))
                if name:
                    found.append((offset + match.start("speaker"), name))
        offset += len(paragraph)

    result: list[str] = []
    seen: set[str] = set()
    for _offset, name in sorted(found, key=lambda item: item[0]):
        key = name.casefold()
        if key in seen:
            continue
        seen.add(key)
        result.append(name)
        if len(result) >= limit:
            break
    return result


def build_character_candidates(
    source_text: str,
    speaker_names: list[str],
    output: SubagentModelOutput | None = None,
) -> list[CharacterCandidate]:
    """Return only deterministic chat candidates; model output is never trusted as identity evidence."""

    del output
    return [
        CharacterCandidate(
            character_id=name,
            name=name,
            aliases=[],
            first_seen_offset=max(0, source_text.find(name)),
            description="从明确的“昵称：内容”聊天记录中识别，需人工复核。",
            speaking_style_hint="聊天昵称",
            confidence=0.92,
        )
        for name in speaker_names
    ]


def _speaker_prefix_pattern(speaker_names: list[str]) -> re.Pattern[str] | None:
    cleaned = [name for name in speaker_names if _clean_chat_speaker(name)]
    if not cleaned:
        return None
    alternatives = "|".join(re.escape(name) for name in sorted(cleaned, key=len, reverse=True))
    return re.compile(rf"(?P<speaker>{alternatives})[ \t]*[：:]")


def _is_invalid_speaker_phrase(character_id: str) -> bool:
    value = character_id.strip()
    key = value.casefold()
    return (
        not value
        or key in RESERVED_COLON_LABELS
        or key in SPEAKER_PRONOUNS
        or len(value) > 24
        or bool(re.search(r"[\n\r：:，,。！？?!；;“”‘’\"']", value))
        or value.startswith(INVALID_SPEAKER_PREFIXES)
        or (
            len(value) > 2
            and value.startswith(SPEAKER_PRONOUN_PREFIXES)
        )
        or any(marker in value for marker in SPEECH_OR_ACTION_MARKERS)
        or value.endswith(("说", "问", "是", "回"))
    )


def _is_source_grounded(character_id: str, source_text: str) -> bool:
    value = character_id.strip()
    if not source_text:
        return True
    if value in source_text:
        return True
    normalized_value = re.sub(r"[的一名位个两]", "", value)
    normalized_source = re.sub(r"[的一名位个两\s]", "", source_text)
    if normalized_value and normalized_value in normalized_source:
        return True
    remainder = value
    matched_terms: list[str] = []
    while remainder:
        term = next((candidate for candidate in HUMAN_ROLE_TERMS if remainder.startswith(candidate)), None)
        if term is None:
            return False
        matched_terms.append(term)
        remainder = remainder[len(term):]
    return len(matched_terms) >= 2 and all(term in source_text for term in matched_terms)


def _unquoted_prose(source_text: str) -> str:
    text = CHAPTER_HEADING_PATTERN.sub("", source_text)
    text = QUOTED_PROSE_PATTERN.sub("", text)
    return re.sub(r"\s+", "", text)


def _quoted_prose(source_text: str) -> str:
    return "".join(
        re.sub(r"\s+", "", match.group(0)[1:-1])
        for match in QUOTED_PROSE_PATTERN.finditer(source_text)
    )


def _is_unquoted_prose_disguised_as_dialogue(text: str, source_text: str) -> bool:
    normalized = re.sub(r"\s+", "", INVENTED_NARRATION_LABEL_PATTERN.sub("", text))
    if len(normalized) < 36 or not source_text:
        return False
    quoted = _quoted_prose(source_text)
    if normalized in quoted:
        return False
    return normalized in _unquoted_prose(source_text)


def _source_requires_narration(source_text: str, speaker_names: list[str]) -> bool:
    if not source_text or speaker_names:
        return False
    unquoted = _unquoted_prose(source_text)
    visible_source = re.sub(r"\s+", "", source_text)
    return len(unquoted) >= 48 and len(unquoted) >= len(visible_source) * 0.12


def validate_dialogue_semantics(
    output: SubagentModelOutput,
    speaker_names: list[str],
    source_text: str = "",
) -> list[DialogueSemanticIssue]:
    pattern = _speaker_prefix_pattern(speaker_names)
    issues: list[DialogueSemanticIssue] = []
    command_groups = [
        ("scenes", scene_index, scene.commands)
        for scene_index, scene in enumerate(output.scenes)
    ]
    if output.fragment is not None:
        command_groups.append(("fragment", -1, output.fragment.commands))

    for container, scene_index, commands in command_groups:
        narration_count = sum(isinstance(command, NarrationCommand) for command in commands)
        if commands and narration_count == 0 and _source_requires_narration(source_text, speaker_names):
            issues.append(
                DialogueSemanticIssue(
                    code="missing_narration_commands",
                    scene_index=scene_index,
                    command_index=0,
                    evidence=_unquoted_prose(source_text)[:240],
                    message="原文包含大量引号外叙述，但结构化结果没有任何 narration command。",
                    container=container,
                )
            )
        for command_index, command in enumerate(commands):
            if isinstance(command, NarrationCommand) and pattern is not None:
                matches = list(pattern.finditer(command.text))
                if matches:
                    issues.append(
                        DialogueSemanticIssue(
                            code="speaker_prefixed_narration",
                            scene_index=scene_index,
                            command_index=command_index,
                            evidence=command.text[:240],
                            message="明确聊天人物前缀被写入旁白。",
                            container=container,
                        )
                    )
                    if len(matches) > 1:
                        issues.append(
                            DialogueSemanticIssue(
                                code="merged_multi_speaker_command",
                                scene_index=scene_index,
                                command_index=command_index,
                                evidence=command.text[:240],
                                message="一条旁白合并了多条带说话人的聊天消息。",
                                container=container,
                            )
                        )
                continue

            if not isinstance(command, DialogCommand):
                continue

            character_id = command.character_id.strip()
            character_key = character_id.casefold()
            invented_label = INVENTED_NARRATION_LABEL_PATTERN.match(command.text)
            disguised_prose = _is_unquoted_prose_disguised_as_dialogue(
                command.text,
                source_text,
            )
            if (
                invented_label
                and invented_label.group(0).strip() not in source_text
            ) or disguised_prose:
                issues.append(
                    DialogueSemanticIssue(
                        code="narration_disguised_as_dialogue",
                        scene_index=scene_index,
                        command_index=command_index,
                        evidence=f"{character_id}: {command.text[:200]}",
                        message="模型把原文引号外叙述伪装成角色对白。",
                        container=container,
                    )
                )
            if not character_id:
                issues.append(
                    DialogueSemanticIssue(
                        code="speaker_structure_unresolved",
                        scene_index=scene_index,
                        command_index=command_index,
                        evidence=command.text[:240],
                        message="对白缺少 character_id。",
                        container=container,
                    )
                )
            elif character_key in {"narration", "narrator", "旁白"}:
                issues.append(
                    DialogueSemanticIssue(
                        code="narration_as_dialogue",
                        scene_index=scene_index,
                        command_index=command_index,
                        evidence=f"{character_id}: {command.text[:200]}",
                        message="旁白被错误写成角色对白；旁白必须使用 narration command。",
                        container=container,
                    )
                )
            elif _is_invalid_speaker_phrase(character_id) or not _is_source_grounded(character_id, source_text):
                issues.append(
                    DialogueSemanticIssue(
                        code="untrusted_dialogue_speaker",
                        scene_index=scene_index,
                        command_index=command_index,
                        evidence=f"{character_id}: {command.text[:200]}",
                        message="对白 character_id 不是原文中有依据的简短人物名、昵称或称谓。",
                        container=container,
                    )
                )

            if pattern is not None:
                matches = list(pattern.finditer(command.text))
                if matches:
                    code: SemanticIssueCode = (
                        "merged_multi_speaker_command"
                        if len(matches) > 1
                        or any(match.group("speaker") != character_id for match in matches)
                        else "speaker_structure_unresolved"
                    )
                    issues.append(
                        DialogueSemanticIssue(
                            code=code,
                            scene_index=scene_index,
                            command_index=command_index,
                            evidence=command.text[:240],
                            message="对白正文仍包含聊天人物前缀或合并了其他说话人。",
                            container=container,
                        )
                    )
    return issues


def semantic_correction_prompt(
    original_prompt: str,
    issues: list[DialogueSemanticIssue],
    speaker_names: list[str],
) -> str:
    issue_lines = "\n".join(
        f"- {issue.code} at {issue.path}: {issue.evidence}"
        for issue in issues[:20]
    )
    chat_constraint = (
        f"For explicit chat-record lines, use these exact nicknames: {speaker_names}\n"
        if speaker_names
        else ""
    )
    return (
        f"{original_prompt}\n\n"
        "[Semantic validation correction]\n"
        "The previous structured result was schema-valid but failed dialogue semantics.\n"
        f"{chat_constraint}"
        f"{issue_lines}\n"
        "Regenerate the complete SubagentModelOutput from chunkText. Infer prose speakers from quotation "
        "attribution and surrounding context. A dialog character_id must be a concise person name, "
        "nickname, or human title grounded verbatim in chunkText. Never use `narration`, `narrator`, "
        "`旁白`, a pronoun, an action, a location, quoted words, or a speech-attribution clause as "
        "character_id. Preserve source paragraph types and source order: text outside quotation marks "
        "must remain narration commands; quoted speech with a reliable speaker may become dialog. "
        "Never invent `(内心独白)`, `（内心独白）`, narrator labels, or assign third-person prose to a "
        "character. If the speaker cannot be identified reliably, keep that prose as narration instead "
        "of inventing an identity. Do not copy speaker prefixes into dialog text or merge messages from "
        "multiple speakers."
    )
