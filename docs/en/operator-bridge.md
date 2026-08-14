# NeuroBook Operator Bridge

::: tip You can hand this page straight to an AI
This page is an operations manual written for **the AI agent helping you deploy or troubleshoot**: commands, pass/fail criteria and failure handling, all worded for a machine to execute.

**Two ways to use it**: when you hit a deployment problem, send the link or the full text to whatever AI you are using and have it work through this procedure for you; or read it yourself as an operations cheat sheet. For everyday installation see [Quick Start](/en/quick-start); for everyday operation see [Running, Data and Privacy](/en/operations).
:::

This document targets agents assisting with deployment or troubleshooting. The source of truth for deployment is the standalone `@notnotype/neuro-book-manager`. Do not call the removed older deployment entry points, the `local-git` mode, `Dockerfile.source-runtime` or the old Windows Launcher.

## Information to Collect First

Before doing anything, confirm:

1. Operating system, architecture and, on Linux, the libc.
2. Target profile: `windows-portable`, `ghcr`, `product-bun`, `source-dev`, `source-product` or `source-docker`.
3. The absolute path of the Installation Root.
4. The stable/canary channel, the requested version and the port.
5. Whether `.deploy/installation.json` already exists.
6. Whether the Git profile has dirty or untracked files.
7. Whether a Product or Docker service is still running.

Do not run `git restore`, `git stash` or `git reset`, delete unknown files, or kill user processes just to let an update proceed.

## Core Directory Contract

The Installation Root is the single root for source and replaceable components:

```text
<root>/
├─ Git tracked source
├─ .output/                         # Product
├─ .runtime/
│  ├─ manager/<version>/
│  ├─ bun/<version>/
│  ├─ tools/<name>/<version>/
│  └─ bin/                          # stable wrappers
├─ .deploy/
│  ├─ installation.json
│  ├─ install.lock
│  ├─ staging/
│  ├─ backups/
│  └─ docker-compose.generated.yml
└─ State Root files
```

The State Root defaults to the Installation Root. On Windows Portable the State Root is `<root>/data`, containing `workspace/`, `config.yaml`, `.env` and `logs/`. The application process resolves these paths through `NEURO_BOOK_STATE_ROOT`; the public Project Path is still `workspace/<project>`.

Source, Product, Runtime, Tool, Deployment State and User State have separate ownership. An update may only replace paths owned by the component being updated.

## Standard Entry Points

Ordinary Windows users should download `neuro-book-windows-x64.zip` from a complete Release; do not mistake the Source archive or the Windows Product overlay for the Portable build. Advanced Windows deployments and all Linux deployments go through the Manager.

With Bun already present:

```bash
bunx --bun @notnotype/neuro-book-manager@canary install --profile ghcr
```

Canary uses `@canary`. Without Bun, Stage 0 places a pinned Bun in the user cache, verifies its SHA256, and then calls the same Manager. Stage 0 must not write that temporary Bun into the target Installation Root.

```powershell
irm https://raw.githubusercontent.com/notnotype/neuro-book/master/scripts/install/install.ps1 | iex
```

```bash
curl -fsSL https://raw.githubusercontent.com/notnotype/neuro-book/master/scripts/install/install.sh | sh
```

A complete Release also ships `install.ps1`, `install.cmd` and `install.sh`, all covered by `SHA256SUMS`. Linux Stage 0 supports x64 glibc only and requires `curl`, `unzip` and `sha256sum`.

Do not generate or suggest `bunx run @notnotype/neuro-book-manager`. `bunx run` treats the package name as a local script or path and cannot start the Manager. Until stable and a correct npm `latest` exist, every canary operation must state `@canary` explicitly.

A Release only counts as assembled once its official `release-manifest.json` is public. Candidate assets that exist only as Actions artifacts are not installable; a Release that is still building, failed verification or was cancelled must be skipped safely by the Resolver.

The stable entry point after installation:

```powershell
.\.runtime\bin\neuro-book.cmd status --json
```

```bash
./.runtime/bin/neuro-book status --json
```

For humans the subcommand can be omitted: the Manager detects the current directory offline and switches its menu between a managed instance, a corrupted manifest, an unadopted Git checkout, Portable State and an ordinary directory. Agents and CI must keep using `install`, `adopt`, `instances inspect/discover/import` and `--yes` explicitly. `--yes` on import only accepts runtime-state warnings; it cannot bypass a checksum, a wrapper or an Operation blocker.

## Profile Semantics

### windows-portable

- The directory the Release zip extracts into is the Installation Root; there is no `app/` sub Product Root.
- The root contains the complete Source, `.output`, `.runtime`, `.deploy` and the launcher scripts.
- `.runtime` bundles Bun, rg, PortableGit/bash and a versioned Manager.
- `data/` is the only user state directory that must survive a re-extraction.
- `Start/Update/Create Admin` are only platform front ends for the Manager; they do not maintain a second update protocol.
- Both CMD and PowerShell launchers call the `.runtime\\bin\\neuro-book.cmd` wrapper bound to their own Installation Root; the launchers themselves contain no `--root`, because the stable wrapper injects the bound root. Start/Update/Create Admin pass only `start`, `update`, or `admin create` and forward the Manager exit code; do not add migration, update or runtime switching logic to a launcher.

### ghcr

- The host does not clone the NeuroBook source.
- `.deploy/docker-compose.generated.yml` references the `image@sha256:digest` from the Release Manifest.
- The image's `/app` contains the full source and `.output`.
- The Runtime/Tool provider is `container`.
- The Workspace Root, Boot Config and logs under the State Root are persisted through volumes.

### product-bun

- Downloads the Source archive and the current platform's Product overlay at the same version.
- The Product's `sourceRevision` must match the Release Source revision.
- The root source does not require installing dependencies; the run entry point depends only on the vendored runtime inside `.output`.
- Bun may be `system`, or installed as `managed` by Stage 0 or the Manager.

### source-dev / source-product

- The Source provider is Git.
- Materialization uses `git init`, `remote add`, `fetch` and `switch`, and supports an existing checkout.
- `source-dev` installs dependencies and then runs the dev server.
- `source-product` builds in `.deploy/staging` and atomically swaps the root `.output`.
- A dirty worktree, unknown files or a non-fast-forward must stop the operation and be reported.

### source-docker

- The Git source is the build context.
- The full Dockerfile installs dependencies, builds Nuxt and produces the runner inside the container.
- The old hybrid flow — a host Bun build plus a runtime container mounting `.output` — no longer exists.

## Status and Diagnostics

Collect these first:

```bash
neuro-book status --json
neuro-book doctor --json
neuro-book runtime list
neuro-book tools list
```

Then read `.deploy/installation.json`. Look at:

- `profile`, `managerVersion`, `appVersion`, `channel`, `sourceRevision`.
- Whether `stateRoot` matches the profile.
- Whether the Source and Product revisions match.
- Each component's provider, version, platform, path and checksum.
- The official `sourceUrl`, `license` and `redistribution` of managed components.

When reading doctor output, separate "installation integrity" from "service state": a cleanly stopped service should produce only a warning and keep `healthy=true`; a running service is a fail only when its image, port, HTTP response or version does not match. Docker profiles must also compare the image in the Compose config, the container's actual image, and the pinned digest / revision tag in the Manifest. Never hand-edit the Manifest or loosen a check just to turn doctor green.

`installation.json` has a strict schema; do not hand-add arbitrary fields. If the recorded state disagrees with the filesystem, report it first — do not fabricate a manifest.

## Update Procedure

By default an update touches the application components of the current profile, not the Manager itself:

```bash
neuro-book update
neuro-book runtime update bun
neuro-book tools update rg
```

An update must:

1. Acquire `.deploy/install.lock`.
2. Download or build into `.deploy/staging/<operation>`.
3. Verify SHA256, the Release Manifest, platform, version and source revision.
4. Check for a dirty Git worktree, running services and locked files on Windows.
5. Back up the paths owned by the components being updated.
6. Swap atomically.
7. Run migrations and a minimal health check.
8. Write `installation.json` last.
9. Restore the previous Source/Product on failure.

Files must not be overwritten while the Manager or Bun is running. Both live in versioned directories; the stable wrapper switches target on the next process start.

## Runtime and Tools

```bash
neuro-book runtime install bun --version <version>
neuro-book runtime update bun
neuro-book tools install rg
neuro-book tools install git
neuro-book tools update
neuro-book tools path rg
```

- Windows and Linux x64 support managed Bun and rg.
- Windows x64 supports managed PortableGit, where Git and a real `bash.exe` come from the same audited distribution.
- On Linux and macOS, Git and bash come from the system or package manager.
- Python v1 only detects and advises on installation; it does not host downloads.
- The Manager only changes the PATH of its child processes, never the system PATH.

Treat version directories as immutable. An identical version that already exists must be reused and its wrapper refreshed; never delete a working version first and then download it again over the network.

## Admin and Authentication

```bash
neuro-book admin create admin
```

On Windows Portable you can run `Create Admin.cmd` in the root. The Boot Config lives at State Root `config.yaml`; the Product Env lives at State Root `.env`. Never write a password into a command, a log, the installation manifest or documentation.

## Docker Troubleshooting

The generated file is `.deploy/docker-compose.generated.yml`. Common read-only checks:

```bash
docker compose --env-file .env -f .deploy/docker-compose.generated.yml config
docker compose --env-file .env -f .deploy/docker-compose.generated.yml ps
docker compose --env-file .env -f .deploy/docker-compose.generated.yml logs --tail 200 app
```

On Windows Portable, `.env` lives in `data/`; Docker profiles default to the Installation Root. GHCR should show a digest-pinned image; Source Docker should show the root Dockerfile as the build context, not the deleted source runtime Dockerfile.

## Git Troubleshooting

Read-only checks that are allowed:

```bash
git status --short --branch
git remote -v
git rev-parse HEAD
git rev-parse origin/master
git merge-base HEAD origin/master
```

If the worktree is dirty, HEAD cannot fast-forward, the remote is wrong, or the target directory contains unknown files, stop and let the user decide. Do not repair the user's Git state automatically.

## Release Contract

An application Release must provide all of:

```text
release-manifest.json
SHA256SUMS
neuro-book-source.zip
neuro-book-product-windows-x64.zip
neuro-book-product-linux-x64-glibc.tar.gz
neuro-book-windows-x64.zip
ghcr.io/notnotype/neuro-book:<tag>
```

The Source archive contains only Git tracked files; the Product overlay contains only `.output` and component metadata; Windows Portable is Source + Windows Product + managed Runtime/Tool + Manager. The `minManagerVersion` in the Release Manifest must already be published to the matching npm channel.

The Manager uses its own `manager-v*` tags. Stable publishes to npm `latest`, prereleases publish to `canary`. Do not assume the Manager, the application, the GHCR tag and Bun share a version.

## Acceptance Boundaries

Recommended order: CLI status/doctor, migration, HTTP smoke, data path check, update retention check. Do not launch a browser automatically; once the CLI/HTTP smoke passes, ask the user to manually verify first launch, login, project data retention and the update prompt.
