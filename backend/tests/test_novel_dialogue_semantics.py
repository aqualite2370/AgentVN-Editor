from app.ai.novel_dialogue_semantics import (
    build_character_candidates,
    detect_speaker_names,
    validate_dialogue_semantics,
)
from app.models.novel_process import SceneFragment, SubagentModelOutput


def _fragment_output(commands: list[dict[str, str]]) -> SubagentModelOutput:
    return SubagentModelOutput(
        summary="测试片段",
        fragment=SceneFragment(summary="测试片段", commands=commands),
    )


def test_novel_speaker_detection_does_not_pre_extract_prose_speakers() -> None:
    source = (
        "“汪淼？”那人问。不等汪淼回答，他就向旁边示意。\n"
        "“请不要在我家里抽烟。”汪淼说。\n"
        "“成，那就在楼道里说吧。”史强说着，又吸了一口烟。“你问。”\n"
        "“我们没有说它不合法。”史强大声说。\n"
        "“我下午很忙。”汪淼简单地回答。\n"
        "“那我呢？”少校小声对同事说。\n"
        "主持会议的是一位叫常伟思的陆军少将。\n"
        "“同志们，会议开始。”常将军讲道。\n"
        "史强举手要求发言，没等常伟思表态就大声说道：“首长，我提个要求。”\n"
        "大史用粗嗓门说：“那我是戴罪立功了？”\n"
        "“科学边界试图寻找科学的局限。”丁仪点点头说。\n"
        "它的宗旨是：用科学的方法找出科学的局限性；简单地说就是：确定认知底线。"
    )

    speakers = detect_speaker_names(source)

    assert speakers == []


def test_chat_line_speaker_detection_remains_supported() -> None:
    assert detect_speaker_names("战斗暴龙兽：额。\n牙猎犬：晚上好。") == [
        "战斗暴龙兽",
        "牙猎犬",
    ]


def test_dialogue_validation_rejects_narration_and_untrusted_character_ids() -> None:
    output = _fragment_output(
        [
            {"type": "dialog", "character_id": "narration", "text": "汪淼觉得事情不对。"},
            {"type": "dialog", "character_id": "我们", "text": "汪教授，我们想了解一下。"},
            {"type": "dialog", "character_id": "史强凑近汪淼", "text": "汪教授，你好。"},
            {"type": "dialog", "character_id": "史强", "text": "这条对白合法。"},
        ]
    )

    issues = validate_dialogue_semantics(
        output,
        [],
        "汪淼觉得事情不对。史强说：“这条对白合法。”史强凑近汪淼。",
    )

    assert [issue.code for issue in issues] == [
        "narration_as_dialogue",
        "untrusted_dialogue_speaker",
        "untrusted_dialogue_speaker",
    ]
    assert [issue.command_index for issue in issues] == [0, 1, 2]


def test_character_candidates_never_trust_model_only_dialogue_ids() -> None:
    source = "“等等！”史强说。"
    output = _fragment_output(
        [
            {"type": "dialog", "character_id": "史强", "text": "等等！"},
            {"type": "dialog", "character_id": "我们", "text": "错误角色。"},
            {"type": "dialog", "character_id": "narration", "text": "错误旁白。"},
        ]
    )

    candidates = build_character_candidates(source, detect_speaker_names(source), output)

    assert candidates == []


def test_dialogue_validation_rejects_prose_disguised_as_character_inner_monologue() -> None:
    source = (
        "杨冬和总工程师走过来，在经过时她对他们微笑着点点头，没说一句话，"
        "但汪淼记住了她那清澈的眼睛。"
        "当天晚上汪淼坐在书房里，欣赏着挂在墙上的风景摄影作品。"
        "“名单上的这些物理学家，在不到两个月的时间里，先后自杀。”常伟思说。"
    )
    output = _fragment_output(
        [
            {
                "type": "dialog",
                "character_id": "汪淼",
                "text": "（内心独白）杨冬和总工程师走过来，在经过时她对他们微笑着点点头，没说一句话，但汪淼记住了她那清澈的眼睛。",
            },
            {
                "type": "dialog",
                "character_id": "常伟思",
                "text": "名单上的这些物理学家，在不到两个月的时间里，先后自杀。",
            },
        ]
    )

    issues = validate_dialogue_semantics(output, [], source)

    assert "narration_disguised_as_dialogue" in [issue.code for issue in issues]
    assert "missing_narration_commands" in [issue.code for issue in issues]


def test_dialogue_validation_rejects_unquoted_prose_assigned_to_a_real_character() -> None:
    prose = (
        "那是一年前，汪淼是中华二号高能加速器项目纳米构件部分的负责人。"
        "那天下午在良湘的工地上，一次短暂的休息中，他突然被眼前的一幅构图吸引了。"
    )
    source = f"{prose}“看什么看，干活儿！”主任喊道。"
    output = _fragment_output(
        [
            {"type": "dialog", "character_id": "汪淼", "text": prose},
            {"type": "dialog", "character_id": "主任", "text": "看什么看，干活儿！"},
        ]
    )

    issues = validate_dialogue_semantics(output, [], source)

    disguised = [issue for issue in issues if issue.code == "narration_disguised_as_dialogue"]
    assert len(disguised) == 1
    assert disguised[0].command_index == 0


def test_dialogue_validation_accepts_grounded_human_role_compositions() -> None:
    source = (
        "两位军官看着史强和他的同事走远。少校小声对同事说。"
        "一位中情局的情报官员用标准的普通话说。"
    )
    output = _fragment_output(
        [
            {"type": "dialog", "character_id": "军官同事", "text": "他劣迹斑斑。"},
            {"type": "dialog", "character_id": "中情局情报官员", "text": "不能再用常规思维。"},
        ]
    )

    issues = validate_dialogue_semantics(output, [], source)

    assert issues == []
