# Third-Party Notices and Release Audit

AgentVN includes or depends on third-party material governed by separate
licenses. The AgentVN Editor Source-Available License does not relicense that
material.

This file is a release audit aid, not yet a complete binary-distribution
notices bundle. Before each public binary release, generate a dependency SBOM
and include the exact license texts and notices required by the versions
actually shipped.

## Known dependency license families

- JavaScript runtime and UI dependencies are predominantly MIT, ISC,
  BSD-3-Clause, Apache-2.0, Zlib, or dual MIT/Apache-2.0.
- JSZip is available under MIT or GPL-3.0-or-later; AgentVN uses the MIT
  option.
- Rust/Tauri dependencies are predominantly MIT, Apache-2.0, BSD, Zlib,
  Unicode-3.0, or MPL-2.0. MPL-covered files remain governed by MPL-2.0.
- Python runtime dependencies are predominantly MIT, BSD-3-Clause,
  Apache-2.0, or similarly permissive terms.
- PyInstaller is a build tool under GPL-2.0-or-later with its special
  exception permitting distribution of non-free applications.
- Sharp/libvips appears only in the player package's development toolchain.
  Some distributed libvips packages are LGPL-3.0-or-later; do not ship the
  development `node_modules` tree, and preserve all required notices if those
  binaries are ever redistributed.
- `caniuse-lite` data is CC-BY-4.0 and requires its applicable attribution
  when redistributed.

## Excluded local assets

The public source repository excludes the generated Android source tree,
private example cartridges, generated project assets, local databases,
screenshots, recordings, and release packages. These materials are not
licensed or distributed by this repository.

Before separately publishing or distributing any local example cartridge:

1. retain written evidence that the underlying story may be adapted and
   redistributed publicly;
2. record the provider, model, generation date, and applicable commercial-use
   terms for every generated asset;
3. verify that reference images and prompts did not introduce third-party
   copyrighted material;
4. correct the font entry, which is currently mislabeled as AI-generated;
5. identify the exact font build and include its SIL Open Font License and
   copyright notice if it is Source Han Serif or another OFL font; and
6. remove the cartridge from the public repository and release artifacts if
   any provenance cannot be documented.

Logos, icons, the QR-code image, example projects, recordings, screenshots,
databases, and test output also require an ownership and privacy review before
publication.
