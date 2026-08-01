export const CARTRIDGE_FORMAT_VERSION = "1.0.0";
export const MANIFEST_VERSION = "1.0.0";
export const GALLERY_VERSION = "1.0.0";
export const CHECKSUM_VERSION = "1.0.0";
export const SUPPORTED_RUNTIME_VERSION = "0.4.0";

export const CARTRIDGE_LIMITS = {
  maxPackageSizeMB: 2048,
  maxSingleFileSizeMB: 512,
  maxAssetCount: 10000,
  maxSceneCount: 50000,
  maxCommandCount: 500000
};

export const DANGEROUS_EXTENSIONS = [
  ".exe",
  ".dll",
  ".bat",
  ".cmd",
  ".sh",
  ".ps1",
  ".msi",
  ".app",
  ".apk",
  ".jar"
];

export const REQUIRED_CARTRIDGE_FILES = ["manifest.json", "script.json", "checksum.json"];
