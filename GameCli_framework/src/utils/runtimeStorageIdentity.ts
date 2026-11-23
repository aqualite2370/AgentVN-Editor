import { sha256String } from "../../../shared/cartridge/checksum";
import type { RuntimeMode } from "../app/launchConfig";
import type { LibraryGame } from "../types/cartridge";

export const externalPreviewInstallId = async (gameId: string): Promise<string> =>
  `external_preview_${await sha256String(gameId)}`;

export async function persistentGalleryId(mode: RuntimeMode, game: LibraryGame): Promise<string> {
  const id = game.install_id;
  if (mode === "preview") return `preview_gallery_${await sha256String(game.game_id)}`;
  // Embedded releases retain their legacy *save* install ID (the native
  // portable-save path relies on it). Gallery had no persisted data on this
  // path; use a separate stable identity without migrating or touching saves.
  return mode === "fixed" && id === "preview_gamecli"
    ? `embedded_gallery_${await sha256String(game.game_id)}` : id;
}
