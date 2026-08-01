"""Runtime export helpers."""

from app.models.project import RuntimeScript
from app.models.scene import SceneBeat


class ExportService:
    """Creates runtime-safe payloads without AI or database metadata."""

    def build_runtime_script(self, project_id: str, title: str, scenes: list[SceneBeat]) -> RuntimeScript:
        return RuntimeScript(project_id=project_id, title=title, scenes=scenes)
