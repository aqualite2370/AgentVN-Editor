"""Editor and runtime export-oriented project contracts."""

from pydantic import Field

from app.models.assets import AssetRef
from app.models.common import StrictBaseModel
from app.models.scene import SceneBeat


class RuntimeScript(StrictBaseModel):
    """Runtime-safe script without editor or AI metadata."""

    project_id: str
    title: str
    scenes: list[SceneBeat] = Field(default_factory=list)


class AssetManifest(StrictBaseModel):
    assets: list[AssetRef] = Field(default_factory=list)


class EditorProject(StrictBaseModel):
    project_id: str
    title: str
    scenes: list[SceneBeat] = Field(default_factory=list)
    assets: list[AssetRef] = Field(default_factory=list)
