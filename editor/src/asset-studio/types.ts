import type { AssetType } from "../types/assets";
import type {
  ImageOperation,
  ImageProviderFeatureSet,
  ReferenceImage,
  SavedGenerationProvenance,
  SafetyLevel,
} from "../providers/types";
import type { GeneratedAssetCandidate } from "../asset-generation/session";

export type AssetStudioAssetType = Extract<AssetType, "background" | "sprite" | "portrait" | "ui"> | "cg";

export interface AssetStudioProviderSnapshot {
  providerId: string;
  connectionName: string;
  displayName: string;
  model: string;
  features: ImageProviderFeatureSet;
}

export interface ImageGenerationRecipeV1 {
  version: 1;
  recipeId: string;
  createdAt: string;
  updatedAt: string;
  operation: ImageOperation;
  assetType: AssetStudioAssetType;
  prompt: string;
  originalPrompt?: string;
  optimizedPrompt?: string;
  negativePrompt: string;
  stylePreset: string;
  projectContext: string;
  aspectRatio: string;
  width: number;
  height: number;
  count: number;
  seed?: number;
  safetyLevel: SafetyLevel;
  strength: number;
  upscaleFactor: 2 | 4;
  outpaintInsets: { top: number; right: number; bottom: number; left: number };
  references: ReferenceImage[];
  sourceImage?: ReferenceImage;
  maskImage?: ReferenceImage;
  provider?: AssetStudioProviderSnapshot;
}

export type ImageGenerationJobStatus =
  | "queued"
  | "validating"
  | "running"
  | "partial"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface ImageGenerationJobError {
  code:
    | "validation"
    | "missing_provider"
    | "missing_key"
    | "rate_limited"
    | "safety_blocked"
    | "network"
    | "unsupported"
    | "empty_result"
    | "unknown";
  message: string;
  recoverable: boolean;
}

export interface ImageGenerationJob {
  jobId: string;
  projectId: string;
  recipe: ImageGenerationRecipeV1;
  status: ImageGenerationJobStatus;
  progress: number;
  phase: string;
  candidates: GeneratedAssetCandidate[];
  selectedCandidateIds: string[];
  warnings: string[];
  error?: ImageGenerationJobError;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  attempt: number;
  parentJobId?: string;
  failedOutputCount?: number;
}

export interface AssetStudioPreferences {
  version: 1;
  advancedOpen: boolean;
  railTab: "queue" | "results" | "history";
  leftWidth: number;
  rightWidth: number;
  rightOpen: boolean;
  mobilePane: "compose" | "stage" | "production";
}

export interface AssetStudioOpenContext {
  nodeId?: string;
  commandIndex?: number;
  field?: string;
  recommendedAssetType?: AssetStudioAssetType;
  targetFolderId?: string;
  sourceGeneration?: SavedGenerationProvenance;
  sourceImage?: ReferenceImage;
}

export interface AssetStudioProjectCache {
  version: 1;
  projectId: string;
  recipe: ImageGenerationRecipeV1;
  jobs: ImageGenerationJob[];
  preferences: AssetStudioPreferences;
  savedAt: string;
}

export type { SavedGenerationProvenance };

export interface AssetStudioValidationIssue {
  code: string;
  path: string;
  message: string;
  severity: "error" | "warning";
}
