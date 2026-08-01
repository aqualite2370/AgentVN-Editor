import { SUPPORTED_RUNTIME_VERSION } from "../../../shared/cartridge/constants";
import { loadCartridgeFromArrayBuffer, loadCartridgeFromFile } from "../../../shared/cartridge/unpacker";
import { validateUISkinHealth, validateUISkinLayout } from "../../../shared/cartridge/uiSkin";
import { validateAssetReferences, validateGallery, validateManifest, validateNoAIMetadata, validateNoEditorFields, validateRuntimeScript, validateVersionCompatibility } from "../../../shared/cartridge/validators";
import type { CartridgePackage, CartridgeValidationResult, ValidationIssue } from "../../../shared/cartridge/types";

export interface RuntimeCartridgeImportResult {
  cartridge: CartridgePackage;
  validation: CartridgeValidationResult;
}

function mergeResults(results: CartridgeValidationResult[]): CartridgeValidationResult {
  const errors: ValidationIssue[] = results.flatMap((result) => result.errors);
  const warnings: ValidationIssue[] = results.flatMap((result) => result.warnings);
  return { ok: errors.length === 0, errors, warnings };
}

export function validateRuntimeCartridge(cartridge: CartridgePackage): CartridgeValidationResult {
  const validation = mergeResults([
    validateManifest(cartridge.manifest),
    validateRuntimeScript(cartridge.script, cartridge.manifest),
    validateGallery(cartridge.gallery),
    validateAssetReferences(cartridge.script, cartridge.manifest),
    validateVersionCompatibility(cartridge.manifest, SUPPORTED_RUNTIME_VERSION),
    cartridge.uiSkin ? validateUISkinLayout(cartridge.uiSkin) : { ok: true, errors: [], warnings: [] },
    cartridge.uiSkin ? validateUISkinHealth(cartridge.uiSkin, {
      availableAssetIds: cartridge.manifest.assets.map((asset) => asset.asset_id),
      availableAssetPaths: cartridge.manifest.assets.map((asset) => asset.path),
    }) : { ok: true, errors: [], warnings: [] },
    validateNoEditorFields(cartridge),
    validateNoAIMetadata(cartridge)
  ]);
  return validation;
}

function assertRuntimeCartridgeIsValid(cartridge: CartridgePackage): CartridgeValidationResult {
  const validation = validateRuntimeCartridge(cartridge);
  if (!validation.ok) {
    throw new Error(validation.errors.map((error) => error.message).join("; "));
  }
  return validation;
}

export async function importRuntimeCartridge(file: File): Promise<RuntimeCartridgeImportResult> {
  const cartridge = await loadCartridgeFromFile(file, { runtimeVersion: SUPPORTED_RUNTIME_VERSION });
  const validation = assertRuntimeCartridgeIsValid(cartridge);
  return { cartridge, validation };
}

export async function importRuntimeCartridgeFromArrayBuffer(
  buffer: ArrayBuffer,
  sourceFileName?: string,
): Promise<RuntimeCartridgeImportResult> {
  const cartridge = await loadCartridgeFromArrayBuffer(buffer, {
    runtimeVersion: SUPPORTED_RUNTIME_VERSION,
    sourceFileName,
  } as never);
  const validation = assertRuntimeCartridgeIsValid(cartridge);
  return { cartridge, validation };
}
