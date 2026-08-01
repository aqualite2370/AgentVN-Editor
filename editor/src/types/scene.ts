import type { GameCommand } from "./commands";

export interface SceneBeat {
  scene_id: string;
  scene_display_name?: string | null;
  title: string;
  summary: string;
  commands: GameCommand[];
  tags: string[];
  chapter: number;
  is_ending?: boolean;
  ending_id?: string;
  ending_title?: string;
}
