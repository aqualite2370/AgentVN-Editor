# Cartridge Export

The editor exports by calling `exportScript()` to create a clean `RuntimeScript`, scanning resource references, generating `manifest.json`, generating optional `gallery.json` and metadata, creating `checksum.json`, then packing everything with JSZip.

Exported runtime data includes:

- scenes, commands, choices, endings, and state updates;
- `characters` collected from dialog and sprite commands;
- project-level `characterDialogStyles` merged into `characters[].dialog_style`;
- `loading_animation` from the start node;
- sprite `animation_config` and legacy `animation` values;
- optional runtime UI skin at `ui/layout.json`;
- player shell visual assets from package appearance: home splash, title icon, settings panel background, and settings entry image;
- assets referenced by commands, dialog styles, loading animation, UI skin, gallery, and manifest metadata.

Editor-only data is stripped:

- React Flow nodes and coordinates;
- inspector state and project draft metadata;
- AI provider settings and API keys;
- novel import raw text, source mapping records, validation reports, and quality reports.

## Validation

Export validation checks:

- project graph structure and single start node;
- entry scene, default continuation, and choice targets;
- script scene uniqueness;
- asset references and asset type matches;
- `manifest.shell` visual references and dialog style UI references;
- loading animation asset references;
- character sprite animation config values;
- `AnimationCommand.target` values such as `sprite:<character_id>`;
- editor field leakage and AI metadata leakage.

Errors block export and are shown in the UI. Warnings are displayed and may still allow export when the cartridge remains safe to play.

## Runtime Visuals and Dialog Defaults

`PackageAppearanceSettings.titleBackgroundAssetId` is exported as `manifest.shell.background` and is used by GameCLI as the home splash / main menu background. `titleBackgroundFit` is exported as `manifest.shell.background_fit`. `settingsPanelBackgroundAssetId` and `settingsEntryImageAssetId` are exported as `manifest.shell.settings_panel_background` and `manifest.shell.settings_entry_image`; `settingsPanelBackgroundFit` is exported as `manifest.shell.settings_panel_background_fit`.

Background fit values are `stretch`, `contain`, and `cover`. Missing or invalid values are treated as `stretch` by editor sanitize, export, and GameCLI runtime rendering.

Character dialog defaults live in `ProjectSettings.characterDialogStyles`. During export, the editor merges those defaults into `script.characters[].dialog_style`. A dialog command with `dialog_style_mode: "manual"` keeps its own `dialog_style` and will not be overwritten by later role defaults.
