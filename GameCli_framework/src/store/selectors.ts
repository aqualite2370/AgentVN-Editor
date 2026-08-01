import { useRuntimeStore } from "./runtimeStore";

export function useCurrentScene() {
  return useRuntimeStore((state) => state.engine.currentScene());
}

export function useRuntimeDialog() {
  return useRuntimeStore((state) => state.engineState.dialog);
}
