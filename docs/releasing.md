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
- `latest.json` + `latest.json.sig` (the signed update manifest; present only when the
  `OMP_UPDATE_ED25519` secret is set — see "Update Manifest" below)

It also creates GitHub build-provenance attestations for both install assets. Review the artifact
names, checksums, release notes, installation behavior, and provenance before publishing the draft.
When the manifest is present, confirm `latest.json` carries the correct release version and that
`latest.json.sig` was uploaded alongside it.

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

**The Scoop hash is only final at publication, and a workflow handles it.** electron-builder output is
not reproducible, so every build — including a re-tag of the same commit — produces a different hash.
That makes it impossible to commit the correct hash *before* the build that will ship: whatever you
commit, the next build invalidates it.

So `bucket/omp-switch.json` is maintained by `.github/workflows/sync-scoop-bucket.yml`, which runs on
`release: published`, reads the hash out of the published `SHA256SUMS.txt`, and commits it to `main`.
Nothing to do by hand. `render:packaging` can still update the file locally, which is useful when
publishing a release built outside the workflow.

If the sync ever needs re-running, `workflow_dispatch` takes a tag:

```powershell
gh workflow run sync-scoop-bucket.yml -f tag=vX.Y.Z
```

## Update Manifest

The in-app update checker (`packages/core/src/update.ts` + `electron/update-checker.ts`) fetches a
separately signed manifest from each release's `latest` alias
(`releases/download/latest/latest.json` + `latest.json.sig`). Keep the Ed25519 private key outside
the repository and store it only in the protected `OMP_UPDATE_ED25519` repository secret, as PKCS8
DER base64. The `draft-release` job signs the manifest bytes with `crypto.sign` and re-verifies
against the app's hardcoded public key (`VERIFY_PUBLIC_KEY` in `update.ts`) before uploading, so a
key mismatch fails the release rather than shipping an unverifiable manifest. A release without that
secret may still be published; the job warns, skips the manifest assets, and the in-app checker
silently reports nothing until a later release that ships one.

Generate a keypair and obtain the values:

```powershell
node -e "const c=require('crypto');const {publicKey,privateKey}=c.generateKeyPairSync('ed25519');const der=publicKey.export({type:'spki',format:'der'});console.log('PUB:'+der.subarray(der.length-32).toString('base64'));console.log('PRIV:'+privateKey.export({type:'pkcs8',format:'der'}).toString('base64'));"
```

Store the `PRIV:` value as the `OMP_UPDATE_ED25519` secret. Paste the `PUB:` value into
`packages/core/src/update.ts` (`VERIFY_PUBLIC_KEY`) **and** the matching constant inside the
`draft-release` job's verification step — both must agree, or the release-time self-check fails.

## One-time setup for the container image

`publish-cli-image` pushes to GHCR successfully, but GitHub creates the container package as
**private**, and container visibility cannot be set from a workflow or the REST API. Until an owner
flips it once — Settings → Packages → `omp-switch-cli` → Change visibility → Public — an anonymous
`docker pull` returns `401 unauthorized`. Verify with:

```bash
curl -sI https://ghcr.io/v2/<owner>/omp-switch-cli/manifests/<version>
```

A `401` means it is still private.

## Rollback

If an asset or release note is incorrect, keep the release in draft or unpublish it, revoke any related update manifest, publish corrected assets with fresh checksums and attestations, and document the corrective action in the next release notes.
