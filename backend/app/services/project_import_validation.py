"""Pre-commit validation for the file importer, not for saving an editable draft.

Graph rules mirror editor/src/utils/validation.ts and the project file parser.
Both runtimes must accept the same graph (including duplicate identical edges
and unreachable draft scenes). Ordinary project saves can contain unfinished
graphs and must not use these rules.
"""

from typing import Any


_SPECIAL_HANDLES = {None, "", "default", "true", "false"}


def _reject(code: str, message: str) -> None:
    raise ValueError(f"PROJECT_IMPORT_INVALID/{code}: {message} 工程未写入，可修正文件后重新导入。")


def validate_project_import(project: dict[str, Any]) -> None:
    if (
        any(not isinstance(project.get(field), str) for field in (
            "schema_version", "project_id", "title", "author", "memory_mode",
        ))
        or not project["project_id"].strip()
        or any(not isinstance(project.get(field), list) for field in ("nodes", "edges", "asset_manifest"))
        or any(not isinstance(project.get(field), dict) for field in ("viewport", "editor_settings"))
    ):
        _reject("invalid_project_shape", "这不是有效的 AgentVN 工程文件。")

    if any(not isinstance(asset, dict) or not isinstance(asset.get("metadata"), dict)
           for asset in project["asset_manifest"]):
        _reject("invalid_project_shape", "工程的素材清单结构不完整。")

    nodes = project["nodes"]
    edges = project["edges"]
    first_nodes: dict[str, dict[str, Any]] = {}
    starts: list[str] = []
    for node in nodes:
        if (not isinstance(node, dict) or not isinstance(node.get("id"), str)
                or not isinstance(node.get("data"), dict) or not isinstance(node["data"].get("nodeKind"), str)):
            _reject("invalid_graph_item", "剧本含有不完整的节点。")
        data = node["data"]
        first_nodes.setdefault(node["id"], data)
        if data["nodeKind"] == "start":
            starts.append(node["id"])
        scene = data.get("scene")
        if scene is not None and (not isinstance(scene, dict) or not isinstance(scene.get("commands"), list)
                                  or any(not isinstance(command, dict) for command in scene["commands"])):
            _reject("invalid_graph_item", "场景的事件列表结构不完整。")

    for edge in edges:
        if (not isinstance(edge, dict) or any(not isinstance(edge.get(key), str) for key in ("id", "source", "target"))
                or any(edge.get(key) is not None and not isinstance(edge[key], str)
                       for key in ("sourceHandle", "targetHandle"))):
            _reject("invalid_graph_item", "剧本含有不完整的连线。")

    if len(starts) != 1:
        _reject("single_start_node", f"需要唯一的入口节点，文件中有 {len(starts)} 个。")

    defaults: dict[str, set[str]] = {}
    for edge in edges:
        if edge.get("sourceHandle") in (None, "", "default"):
            # Match the editor's distinct-edge key and handling of blank handles.
            key = f"{edge['target']}|default|{edge.get('targetHandle') or 'default'}"
            defaults.setdefault(edge["source"], set()).add(key)
    start_connections = len(defaults.get(starts[0], ()))
    if start_connections == 0:
        _reject("start_connection", "入口节点没有连接第一场景。请添加一条从入口到第一场景的默认连线。")
    if start_connections != 1:
        _reject("start_connection", f"入口节点必须恰好连接一个默认后续，当前有 {start_connections} 个不同目标。")

    for edge in edges:
        if edge["source"] not in first_nodes or edge["target"] not in first_nodes:
            _reject("broken_edge", "存在指向已删除节点的连线，请从现有节点重新连接。")

    choice_handles: dict[str, set[str]] = {}
    for edge in edges:
        handle = edge.get("sourceHandle")
        if handle in _SPECIAL_HANDLES:
            continue
        source = edge["source"]
        data = first_nodes[source]
        if data["nodeKind"] not in {"scene", "choice"}:
            continue
        if source not in choice_handles:
            if data["nodeKind"] == "choice":
                choice = data.get("choice") or {}
                groups = [choice.get("choices", [])] if isinstance(choice, dict) else [None]
            else:
                scene = data.get("scene") or {}
                groups = [command.get("choices") for command in scene.get("commands", []) if command.get("type") == "choice"]
            if any(not isinstance(group, list) or any(not isinstance(choice, dict) for choice in group)
                   for group in groups):
                _reject("invalid_graph_item", "节点的选项列表结构不完整。")
            choice_handles[source] = {choice["choice_id"] for group in groups for choice in group
                                      if isinstance(choice.get("choice_id"), str)}
        if handle not in choice_handles[source]:
            _reject("broken_choice_handle", "连线引用了不存在的选项编号，请从现有选项重新连接。")

    if any(len(keys) > 1 for keys in defaults.values()):
        _reject("multiple_default_successors", "节点只能连接一个默认后续。如需分支，请用选项连线。")
