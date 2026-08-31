# Release process

A green build is not a Runtime Evolution Workbench release.

## Fixed release inputs

- RunCase Interchange: `v0.1.1`, pinned to the exact GitHub Release tarball and SHA-512 integrity.
- Node.js: 22.23.2 in CI and release evidence; the product contract remains compatible with Node 22.x.
- Codex CLI used by the real App Server gate: `0.150.0-alpha.8`.
- The real gate uses the maintainer's existing local Codex authentication. No model credential is stored in GitHub.

`scripts/Check.ps1` also enforces that RunCase Interchange comes from the exact HTTPS GitHub Release asset with the expected SHA-512 lock integrity. A Git, SSH, mutable branch, or unpinned source fails the release.

## Pull-request gate

Windows CI runs the strict server/web build, 16 focused regression tests, plugin validation, installation data-root safety checks, and one synthetic UI golden scenario. The UI gate must retain three Runs, show an observation gap, import one standard Factory Case, fit the mobile viewport, and report no browser/page errors.

## Optional authenticated code-freeze gate

After every code and documentation change is committed, run:

```powershell
.\scripts\Prepare-ReleaseEvidence.ps1 -Version 0.1.0
```

The script repeats the full check and uses the local authenticated Codex to prove two different things. First, ordinary Hook ingestion survives independently and declares its App Server observation gap. Second, a disposable Git repository must complete the real product loop: reproduce one objective failure, pass a distinct protection Run, create an evidence-backed Issue and one-file `AGENTS.md` proposal, execute the four real App Server comparison cells, obtain the `fail/pass/pass/pass` verifier matrix, approve and publish, preserve a later user edit as a rollback conflict, then restore the exact original. All six managed Runs must retain live structured events and explicit reasoning exclusion. The disposable checkout defaults to a `_tmp` directory beside the repository parent so Windows sandbox ACLs are tested on the same volume; `REW_RELEASE_GATE_ROOT` may select another dedicated scratch root. A failed seed stops before the four comparison Runs. Any missing condition fails, and temporary Run/repository data is deleted after the probe.

The sanitized JSON includes product, Node, Codex, and tested commit versions, but no local path, prompt history, credential, or repository content. Review it and commit only `release-evidence/runtime-product-gate-0.1.0.json`. This gate was deliberately not required for the 0.1.0 technical preview; its absence must remain visible and still blocks any stable label.

The archive embeds `release-source.json`, so its installation lifecycle can identify the reviewed commit even after extraction without a `.git` directory. The tag workflow independently runs the isolated Windows installation lifecycle and publishes `runtime-installation-evidence.json` beside the archive. The attested release manifest identifies the release as a Windows-only technical preview and records that authenticated real-Run evidence is not included.

## Tag gate

The reviewed repository must be made public before the release tag is pushed. GitHub does not issue build-provenance attestations for a private repository owned by an individual account. Make the repository public only after the final reviews pass, immediately enable secret scanning, push protection, Dependabot security updates, and strict `main` checks, and then push the tag. The release workflow fails before checkout when the repository is still private.

The tag workflow verifies that:

1. the repository is public so GitHub provenance can be issued;
2. the tag version matches the package and curated notes;
3. product checks and the asserted synthetic UI gate pass on the tagged commit;
4. the extracted archive passes the Windows install, repair, start, remove, and final-absence lifecycle;
5. the manifest records `technical_preview`, Windows-only support, and `authenticated_product_gate.status = not_run`.

It then repeats offline checks and the UI gate, creates a Windows archive containing reviewed source plus compiled server/UI, verifies required files, emits a commit-bound manifest and SHA-256, attaches build provenance, and publishes a GitHub prerelease using the version-matched notes under `docs/releases/`. A missing notes file blocks publication; an automatically generated commit summary is not accepted as the product release page.

Fresh Windows installation, authenticated product execution, user-visible UI review, uninstall, and no-residue evidence remain stable-release gates. The 0.1.0 workflow always publishes a GitHub prerelease and cannot turn its CI evidence into those claims.
