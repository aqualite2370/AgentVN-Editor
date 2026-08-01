import type { PreviewPathStep } from "../../../shared/preview/livePreviewProtocol";
import {
  DEFAULT_CAMERA_POSE,
  isStructuredCameraCommand,
  validateStructuredCameraCommand,
  type CameraPoseV1,
} from "../../../shared/camera/cameraMotion";
import type { RuntimeScript } from "../../../shared/cartridge/types";
import type { EditorEdge, EditorNode } from "../types/nodes";

export interface PreviewEntryPathCandidate {
  id: string;
  label: string;
  steps: PreviewPathStep[];
  nodeIds: string[];
}

function runtimeSceneId(node: EditorNode | undefined): string | undefined {
  if (!node || node.data.nodeKind === "start") return undefined;
  return node.data.scene?.scene_id ?? `${node.data.nodeKind}_${node.id}`;
}

function stepForEdge(
  source: EditorNode,
  target: EditorNode,
  edge: EditorEdge,
): PreviewPathStep | undefined {
  const sceneId = runtimeSceneId(source);
  const targetSceneId = runtimeSceneId(target);
  if (!sceneId || !targetSceneId) return undefined;
  const sourceHandle = edge.sourceHandle ?? "default";

  if (source.data.nodeKind === "choice" && source.data.choice) {
    const choice = source.data.choice.choices.find((item) => item.choice_id === sourceHandle);
    if (choice) {
      return { kind: "choice", sceneId, commandIndex: 0, choiceId: choice.choice_id, targetSceneId };
    }
  }

  if (source.data.nodeKind === "condition") {
    return {
      kind: "conditional",
      sceneId,
      commandIndex: 0,
      branch: sourceHandle === "false" ? "fallback" : "matched",
      targetSceneId,
    };
  }

  const commands = source.data.scene?.commands ?? [];
  for (let index = commands.length - 1; index >= 0; index -= 1) {
    const command = commands[index];
    if (command.type === "choice") {
      const choice = command.choices.find((item) => item.choice_id === sourceHandle);
      if (choice) {
        return { kind: "choice", sceneId, commandIndex: index, choiceId: choice.choice_id, targetSceneId };
      }
    }
    if (command.type === "jump" && command.target_scene_id === targetSceneId) {
      return { kind: "jump", sceneId, commandIndex: index, targetSceneId };
    }
    if (command.type === "conditional_jump") {
      if (command.target_scene_id === targetSceneId) {
        return { kind: "conditional", sceneId, commandIndex: index, branch: "matched", targetSceneId };
      }
      if (command.else_target_scene_id === targetSceneId) {
        return { kind: "conditional", sceneId, commandIndex: index, branch: "fallback", targetSceneId };
      }
    }
  }

  return { kind: "scene_end", sceneId, targetSceneId };
}

export function findPreviewEntryPaths(
  nodes: EditorNode[],
  edges: EditorEdge[],
  targetNodeId: string,
  limit = 12,
): PreviewEntryPathCandidate[] {
  const start = nodes.find((node) => node.data.nodeKind === "start");
  const target = nodes.find((node) => node.id === targetNodeId);
  if (!start || !target) return [];
  const targetLabel = target.data.label;
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, EditorEdge[]>();
  for (const edge of edges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
  }
  const results: PreviewEntryPathCandidate[] = [];

  function walk(nodeId: string, visited: Set<string>, steps: PreviewPathStep[], route: string[]) {
    if (results.length >= limit) return;
    if (nodeId === targetNodeId) {
      const labels = route
        .map((id) => nodesById.get(id)?.data.label)
        .filter((label): label is string => Boolean(label));
      results.push({
        id: route.join(">"),
        label: labels.join(" → ") || targetLabel,
        steps,
        nodeIds: route,
      });
      return;
    }
    if (visited.has(nodeId)) return;
    const source = nodesById.get(nodeId);
    if (!source) return;
    const nextVisited = new Set(visited).add(nodeId);
    for (const edge of outgoing.get(nodeId) ?? []) {
      const next = nodesById.get(edge.target);
      if (!next) continue;
      const step = source.data.nodeKind === "start" ? undefined : stepForEdge(source, next, edge);
      walk(edge.target, nextVisited, step ? [...steps, step] : steps, [...route, edge.target]);
    }
  }

  walk(start.id, new Set(), [], [start.id]);
  return results;
}

export function previewInheritedCameraPose(
  script: RuntimeScript,
  entryPath: PreviewPathStep[],
  targetSceneId: string,
  commandIndex: number,
): CameraPoseV1 {
  let pose = { ...DEFAULT_CAMERA_POSE };
  const scenes = new Map(script.scenes.map((scene) => [scene.scene_id, scene]));

  function reduceScene(sceneId: string, endExclusive: number) {
    const scene = scenes.get(sceneId);
    if (!scene) return;
    for (const command of scene.commands.slice(0, endExclusive)) {
      if (!isStructuredCameraCommand(command) || validateStructuredCameraCommand(command).length > 0) {
        continue;
      }
      if (command.motion.kind === "reset") pose = { ...DEFAULT_CAMERA_POSE };
      if (command.motion.kind === "reframe") pose = { ...command.motion.to };
      if (command.motion.kind === "sequence") {
        const lastShot = command.motion.shots[command.motion.shots.length - 1];
        if (lastShot) pose = { ...lastShot.to };
      }
    }
  }

  for (const step of entryPath) {
    const scene = scenes.get(step.sceneId);
    reduceScene(
      step.sceneId,
      step.kind === "scene_end" ? (scene?.commands.length ?? 0) : step.commandIndex,
    );
  }
  reduceScene(targetSceneId, commandIndex);
  return pose;
}
