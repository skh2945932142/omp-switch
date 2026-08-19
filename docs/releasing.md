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

`package:win` passes `--publish never`. electron-builder otherwise detects the git tag and publishes
by itself, which needs a `GH_TOKEN` it is not given and would bypass the draft-and-review gate: the
workflow uploads the assets and creates the draft in a later step, deliberately. Keep the flag.

## Review the Draft

The workflow produces only these user-facing assets:

- NSIS installer (`OMP-Switch-Setup-X.Y.Z.exe`)
- Portable ZIP (`OMP-Switch-X.Y.Z-win.zip`)
- `SHA256SUMS.txt`

It also creates GitHub build-provenance attestations for both assets. Review the artifact names, checksums, release notes, installation behavior, and provenance before publishing the draft.

Do not attach `.blockmap` files unless a future updater implementation explicitly consumes them.

## Refresh the package-manager manifests

Run `pnpm render:packaging` **against the published release assets**, not a local rebuild: a local
build is not byte-identical to the CI build, so its hash would never match what users download.

```powershell
gh release download vX.Y.Z --dir dist-release
pnpm render:packaging -Source dist-release
```

That writes reviewed copies into `packaging/out/` for winget and Chocolatey submission, and updates
`bucket/omp-switch.json` in place. The Scoop bucket is served from this repository, so that file must
be committed with a real hash for `scoop install` to work at all.

**This creates an ordering problem, and the workflow enforces the answer.** electron-builder output is
not reproducible, so every build — including a re-tag of the same commit — produces a different hash.
The `draft-release` job therefore refuses to create the draft when `bucket/omp-switch.json` does not
match the assets just built. When that fires:

1. `gh run download <id> -n release-assets -D dist-release`
2. `pnpm render:packaging -Source dist-release`
3. Commit `bucket/omp-switch.json`.
4. Move the tag to the new commit and push it again.

A first release of a version therefore takes two passes: one to learn the hash, one to publish with it
committed. That is deliberate — the alternative is a Scoop manifest whose hash check fails for every
user.

## Update Manifest

The future in-app update checker requires a separately signed manifest. Keep the Ed25519 private key outside the repository and store it only in the protected `OMP_SWITCH_UPDATE_SIGNING_KEY` GitHub Environment secret. A release without that secret may still be published; it must not advertise an unsigned update manifest.

## Rollback

If an asset or release note is incorrect, keep the release in draft or unpublish it, revoke any related update manifest, publish corrected assets with fresh checksums and attestations, and document the corrective action in the next release notes.
