from app.models.scene import SceneBeat


def test_scene_beat_accepts_cutscene_video_command() -> None:
    scene = SceneBeat(
        scene_id="scene_video",
        title="Video",
        summary="A blocking cutscene.",
        chapter=1,
        commands=[
            {
                "type": "video",
                "video_id": "opening_movie",
                "video_fit": "cover",
                "fade_in_ms": 350,
                "fade_out_ms": 700,
            }
        ],
    )

    command = scene.commands[0]
    assert command.type == "video"
    assert command.video_id == "opening_movie"
    assert command.video_fit == "cover"
    assert command.fade_in_ms == 350
    assert command.fade_out_ms == 700
