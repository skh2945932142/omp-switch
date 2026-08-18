# Releasing OMP Switch

This document describes the release process for a supported version, beginning with `v0.2.0`.

## Preconditions

- `main` is green in CI.
- The release version is final in `package.json` and matches the planned Git tag.
- `CHANGELOG.md` and `docs/releases/vX.Y.Z.md` contain reviewed release notes.
- A clean Windows environment has validated installation, portable launch, OMP config loading, snapshots, secret bridge behavior, CLI JSON output, and upgrade/uninstall behavior.
- The release signer has reviewed the intended GitHub Release assets.

## Prepare the Tag

1. Update the version and release notes in a reviewable pull request.
2. Merge the pull request after CI passes.
3. Create and push an annotated tag in the form `vX.Y.Z`.
4. Confirm that the release workflow creates a draft, not a public release.

The workflow rejects a tag whose name does not match `package.json` and requires a matching `docs/releases/vX.Y.Z.md` file.

## Review the Draft

The workflow produces only these user-facing assets:

- NSIS installer (`OMP Switch Setup X.Y.Z.exe`)
- Portable executable (`OMP Switch X.Y.Z.exe`)
- `SHA256SUMS.txt`

It also creates GitHub build-provenance attestations for the executable assets. Review the artifact names, checksums, release notes, installation behavior, and provenance before publishing the draft.

Do not attach `.blockmap` files unless a future updater implementation explicitly consumes them.

## Update Manifest

The future in-app update checker requires a separately signed manifest. Keep the Ed25519 private key outside the repository and store it only in the protected `OMP_SWITCH_UPDATE_SIGNING_KEY` GitHub Environment secret. A release without that secret may still be published; it must not advertise an unsigned update manifest.

## Rollback

If an asset or release note is incorrect, keep the release in draft or unpublish it, revoke any related update manifest, publish corrected assets with fresh checksums and attestations, and document the corrective action in the next release notes.
