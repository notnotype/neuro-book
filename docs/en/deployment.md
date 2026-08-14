# Deployment

Every NeuroBook installation form is managed by a standalone package, `@notnotype/neuro-book-manager`, whose public command is `neuro-book`. The old deployment entry points, `local-git`, and the hybrid host-build + runtime-container mode have all been removed.

## Choosing a Profile

Pick from this table first, then read the per-profile details below.

| Profile | Choose it if and only if | Prerequisites | Builds on your machine | Not for |
| --- | --- | --- | --- | --- |
| `windows-portable` | You are on Windows and want unzip-and-run | None | No | Non-Windows; multiple instances |
| `ghcr` | Deploying to a Linux/macOS server | Docker or Podman + Compose | No, pulls a pinned-digest image | No container environment; you need to modify the source |
| `product-bun` | You do not want containers and the machine already has Bun | Bun | No, downloads a prebuilt `.output` | You need to modify the source |
| `source-dev` | Developing NeuroBook itself | Git + Bun | dev server | Production |
| `source-product` | You need a production build from your own source | Git + Bun + **build memory (2G+ recommended)** | **Yes**, runs the Nuxt build locally | Low-spec VPS |
| `source-docker` | You need to build the image from source | Git + Docker/Podman | **Yes**, builds inside the container | Low-spec VPS; pointless if you are not modifying the source |

Things to weigh:

- **Only the `source-*` profiles build on your machine.** `ghcr` / `product-bun` / `windows-portable` all download finished artifacts. Do not pick source-product or source-docker on a low-spec machine.
- **`ghcr` is the first choice for servers.** Unless you need to modify the source, run on an unofficial architecture, or cannot reach GHCR from your network, you do not need `source-docker`.
- **Migration**: every profile keeps its data in the State Root, so switching profiles or machines means moving that one directory. See [Running, Data and Privacy](/en/operations#where-your-data-lives).
- **Stopping the service and starting on boot** are not the Manager's job. Read [Starting and Stopping](/en/operations#starting-and-stopping-the-service) before you deploy.

Where each profile's components come from:

| Profile | Source | Product | Runtime / Tool |
| --- | --- | --- | --- |
| `windows-portable` | Release source | Windows `.output` | Managed Bun, rg, PortableGit/bash |
| `ghcr` | Image `/app` | Image `.output` | container |
| `product-bun` | Release source | Platform `.output` | system Bun/Tool |
| `source-dev` | Git | None | system Bun/Tool |
| `source-product` | Git | Local staging build | system Bun/Tool |
| `source-docker` | Git build context | Built inside the container | container |

The official platforms are Windows x64, Linux x64/AArch64 glibc, and macOS x64/ARM64. Windows ARM64, Linux musl and other architectures are explicitly rejected — there is no fallback to x64 assets.

## Where Each User Starts

- Ordinary Windows users download the exact file name `neuro-book-windows-x64.zip` from a complete GitHub Release, unzip it, and run `Start Neuro Book.cmd`. The source archive and the product overlay are not launchable portables.
- Advanced Windows users go through the Manager to deploy multiple instances, Docker, Product Bun or a source profile; with no Bun on the machine, use the PowerShell Stage 0.
- On Linux/macOS, every local, server and development deployment starts from the Manager. With Docker/Podman available the default recommendation is `ghcr`; with no container engine, pick `product-bun` or the matching source profile.

## Stage 0

If the machine already has Bun, run:

```bash
bunx --bun @notnotype/neuro-book-manager@canary
```

With no arguments you get the Clack install wizard, which explains and asks for the profile, Installation Root, instance name, update channel, port and authentication one step at a time. CI or automated deployments use an explicit command:

```bash
bunx --bun @notnotype/neuro-book-manager@canary install --profile ghcr --yes
```

The canary Manager uses `@canary`. With no Bun on the machine, use the platform Stage 0 shipped in the repository:

Do not use `bunx run @notnotype/neuro-book-manager`; that form makes Bun resolve the package name as a local script or path, and the Manager will not start. Until a stable Manager and a correct npm `latest` exist, the public docs keep using `@canary`.

```powershell
irm https://raw.githubusercontent.com/notnotype/neuro-book/master/scripts/install/install.ps1 | iex
```

```bash
curl -fsSL https://raw.githubusercontent.com/notnotype/neuro-book/master/scripts/install/install.sh | sh
```

The POSIX Stage 0 supports Linux x64/AArch64 glibc and macOS x64/ARM64, and depends on `curl` and `unzip`. On Linux it uses `sha256sum` and verifies glibc; on macOS it uses the system `shasum -a 256`. Piped with no arguments, it tries to restore the Manager's interactive input from `/dev/tty`; with no TTY it fails before downloading anything, so automation should use:

```bash
curl -fsSL https://raw.githubusercontent.com/notnotype/neuro-book/master/scripts/install/install.sh | sh -s -- --profile ghcr --yes
```

Stage 0 downloads a pinned Bun version into the user cache, re-verifies the executable's SHA256, version and execute bit after unpacking, cleans up the temporary directory, and only then calls Manager `@canary`; it does not write `.runtime` into the Installation Root first. The Windows Stage 0 uses the native OS architecture and rejects Windows ARM64 before downloading; the cache and the first unpack go through the same executable checksum/version gate.

Every fully assembled application Release also publishes `install.ps1`, `install.cmd` and `install.sh` on their own, all three covered by the same `SHA256SUMS`. The raw GitHub commands are for a quick install; the Release assets are for auditing the script contents and checksums first and bootstrapping online afterwards. They are not offline application installers.

The Manager only installs complete GitHub Releases that have published a final `release-manifest.json`. The manifest goes public only after the candidate assets pass verification inside Actions; releases that are still building, failed verification or were cancelled are skipped by the resolver.

## Installation Root and State Root

```text
neuro-book/
├─ Git tracked source
├─ .output/
├─ .runtime/
│  ├─ manager/<version>/
│  ├─ bun/<version>/
│  ├─ tools/<name>/<version>/
│  └─ bin/
├─ .deploy/
│  ├─ installation.json
│  ├─ install.lock
│  ├─ staging/
│  ├─ backups/
│  └─ docker-compose.generated.yml
├─ workspace/
├─ config.yaml
└─ .env
```

`NEURO_BOOK_STATE_ROOT` decides the physical root of user state. Unset, it equals the Installation Root; Windows Portable sets it to `<root>/data`, so the physical files land in `data/workspace`, `data/config.yaml`, `data/.env` and `data/logs`. The public project path always stays `workspace/<project>`.

A release update only replaces paths owned by a component; it never overwrites the State Root.

`neuro-book update` applies an atomic update for the current profile and does not accept `--component` to split source from product; when the version is unchanged and the Manager checksum matches, it simply reports that you are already up to date. Runtime and tools update separately, with `neuro-book runtime update bun` and `neuro-book tools update <rg|git>`. For release candidates or audits, `--release-manifest <local path or HTTPS URL>` is available; it is mutually exclusive with `--version` and still verifies channel, revision, platform, asset file names and checksums.

## Common Commands

```text
neuro-book                              # Interactive install wizard
neuro-book manage                       # Multi-instance TUI
neuro-book install --profile <profile> [--dir <path>] [--version <version> | --release-manifest <path-or-url>]
    [--channel <stable|canary>] [--port <port>]
    [--auth <enabled|disabled>] [--yes] [--dry-run [--json]]

neuro-book instances list [--json]
neuro-book instances add <path> [--name <name>] [--default]
neuro-book instances import <path> [--name <name>] [--default]
neuro-book instances inspect [path] [--json]
neuro-book instances discover [--root <path>...] [--json]
neuro-book instances roots list|add|remove
neuro-book adopt [path] --profile <source-dev|source-product|source-docker>
neuro-book instances forget <name-or-id>
neuro-book instances default <name-or-id>
neuro-book instances config

neuro-book update [--version <version> | --release-manifest <path-or-url>] [--dry-run]
neuro-book start
neuro-book status [--json]
neuro-book doctor [--json]
neuro-book uninstall --yes [--delete-data] [--json]

neuro-book runtime list
neuro-book runtime install bun [--version <version>]
neuro-book runtime update bun

neuro-book tools list
neuro-book tools install <rg|git>
neuro-book tools update [rg|git]
neuro-book tools path <rg|git>
neuro-book admin create [username]
```

`update/start/status/doctor/runtime/tools/admin/uninstall` accept the global `--root <path>` or `--instance <name-or-id>`. With neither given, the Manager prefers the instance that owns the current directory; run from outside any instance, it uses the default instance from your user config.

Global flags must come before the subcommand, for example `neuro-book --root <path> update`. Application or runtime target versions come after the subcommand, for example `neuro-book install --version <app-version>` or `neuro-book runtime install bun --version <bun-version>`; a bare `neuro-book --version` only prints the Manager's own version.

## User-Level Manager Configuration

The Manager config lives at `~/.neuro-book-manager/config.json` by default. It stores only:

- Install wizard preferences, such as the channel and the last install directory.
- The name, absolute Installation Root and default flag of each registered instance.

The config does not duplicate application versions, component checksums, or runtime and product state; that information exists only in each instance's `.deploy/installation.json`. It can hold a limited set of `discoveryRoots`, which by default scan at most three levels down and skip dependency, build and Manager directories rather than walking the whole disk. A corrupted or deleted config breaks no instance — run `neuro-book instances import <path>` again to rebuild the index.

The no-argument entry point switches between managing the current directory, handling a broken instance, adopting, and the deployment menu; in a non-TTY it only prints the offline detection result and the next command, and creates no files. Candidate discovery spawns no environment subprocesses such as Bun or Docker, and other Git repositories never become candidates. `instances import` verifies the manifest, component checksums, wrapper, product, State Root and operations, but a stopped service or container only produces a warning. `adopt` accepts only a clean NeuroBook Git checkout with a valid remote/branch/upstream; all three source profiles first prepare a short-path detached worktree in the system temp directory, which avoids Windows long paths and guarantees the main checkout is untouched until commit.

`status` is a lightweight run-state check and does not recompute checksums for every large file; only `doctor` runs the full offline integrity and service check. A cleanly stopped native service or container returns a warning but keeps `healthy=true` and points you at `start`. A missing Docker/Compose, a mismatch between Compose and the manifest image, a running container on the wrong image, an unreachable HTTP endpoint or a wrong version are all failures. After Docker `up -d`, `start` waits on the version endpoint instead of treating a Compose exit code of 0 as proof that the app is available.

The blessed TUI behind `neuro-book manage` supports viewing multiple instances, status, diagnostics, starting, transactional updates, registering, setting the default and forgetting a record. Long operations such as install, start and update exit the TUI and continue in a normal terminal, so subprocess output does not wreck the interface.

After installation, prefer the stable wrapper under the Installation Root: `.runtime\bin\neuro-book.cmd` on Windows, `.runtime/bin/neuro-book` on POSIX. The Manager only modifies the PATH of the subprocesses it starts; it never touches the system PATH.

Install preflight is the shared gate for Clack, `install --yes` and `install --dry-run --json`. One report covers native and process architecture, profile support, Git, Docker/Podman, Compose, port, Installation Root identity, release integrity and component provenance; blockers stop execution, warnings continue after confirmation in the interactive entry points. The Manager rejects Rosetta, Windows x64 emulation and any other environment where the native and process architectures disagree, and it never interprets a cross-architecture install as an update or a repair.

The version directories for managed Bun, ripgrep and PortableGit are immutable components. The unified managed asset repository only reuses a directory when the currently valid manifest can prove its archive/source URL, all checksums, execute bits and real version; a fresh install does not read the current checksums of existing files and bless them after the fact. On a verification failure the whole version is rebuilt, and the stable wrapper is refreshed only after every managed asset is complete.

## Windows Portable

Download `neuro-book-windows-x64.zip` from the GitHub Release, unzip it into a new directory, and **double-click `Start Neuro Book.cmd`** to start.

To launch it from PowerShell, remember the file name contains a space: you must use the call operator with quotes, or PowerShell will treat `.\Start` as the command:

```powershell
& '.\Start Neuro Book.cmd'
```

The package already contains the source, the Windows product build, Bun, rg, PortableGit/bash and the Manager. `Start Neuro Book.cmd`, `Update Neuro Book.cmd` and `Create Admin.cmd` all call the `.runtime\\bin\\neuro-book.cmd` wrapper bound to their own Installation Root; the launchers themselves contain no `--root`, because the stable wrapper injects the bound root. Start passes `start`, Update passes `update`, and Create Admin passes `admin create`; all three forward the Manager exit code. Updates preserve the whole `data/` directory.

The older `app/data/runtime/launcher` portable makes no promise of an in-place upgrade. For the first migration, unzip the new package fresh and then copy the old `data/` into the new Installation Root.

## GHCR

```bash
bunx --bun @notnotype/neuro-book-manager@canary install \
  --profile ghcr --dir /opt/neuro-book --port 3000 --yes
cd /opt/neuro-book
.runtime/bin/neuro-book start
```

The Manager does not clone the source onto the host; it generates a Compose file from the release manifest, pins the image by `ref@sha256:digest`, and mounts the Workspace Root, boot config and logs from the State Root. The first install verifies the Docker/Podman CLI, Compose and engine info, then persists that choice; every later start, update, rollback, interrupted-operation recovery, doctor and create-admin uses that same engine. create-admin uses `compose exec`, which both `docker compose` and `podman compose` support, instead of depending on a provider-specific `ps --status`. The image's `/app` holds the full source and `.output`.

## Product Bun

```bash
bunx --bun @notnotype/neuro-book-manager@canary install \
  --profile product-bun --dir "$HOME/neuro-book" --yes
cd "$HOME/neuro-book"
.runtime/bin/neuro-book start
```

The Manager downloads the source archive and the current platform's product overlay from the same release, and checks that both report the same `sourceRevision`. Running only depends on the product runtime inside `.output`, not on a root `node_modules`; the root source is there for auditing, agent collaboration and later rebuilds.

## Source Profile

Development run:

```bash
bunx --bun @notnotype/neuro-book-manager@canary install \
  --profile source-dev --dir "$HOME/neuro-book" --yes
```

Local production build:

```bash
bunx --bun @notnotype/neuro-book-manager@canary install \
  --profile source-product --dir "$HOME/neuro-book" --yes
```

The Manager materializes the repository with `git init/fetch/switch`, and accepts an empty directory, a directory holding only `.runtime/.deploy/data`, or an existing checkout. A dirty worktree, unknown files or a non-fast-forward update all stop the operation; it never restores, stashes or resets on your behalf.

`source-product` writes the Nuxt build into `.deploy/staging/<operation>/.output` first, and switches the root `.output` only after verification passes. If the build fails, the old product build keeps running.

## Source Docker

```bash
bunx --bun @notnotype/neuro-book-manager@canary install \
  --profile source-docker --dir /opt/neuro-book --yes
cd /opt/neuro-book
.runtime/bin/neuro-book start
```

The Git source is the Docker build context. The full multi-stage Dockerfile runs `bun install --frozen-lockfile` and the Nuxt build inside the container; the host no longer builds `.output` first and mounts it into a runtime container.

## Update and Rollback Boundaries

The update order is: install lock, staging download or build, checksum/manifest/platform verification, run-state check, component backup, switch, migration and minimal checks, and finally committing `installation.json`. A failed release source or product update restores the old components.

Manager v1 does not take over systemd, pm2 or generic background processes. If a native product build is running or a Windows file is locked, the update stops and asks you to shut the service down first. Runtime and Manager use version directories, and the wrapper points at the new version on the next start.

## Release Assets

Every application release contains:

```text
release-manifest.json
SHA256SUMS
neuro-book-source.zip
neuro-book-product-windows-x64.zip
neuro-book-product-linux-x64-glibc.tar.gz
neuro-book-product-linux-aarch64-glibc.tar.gz
neuro-book-product-darwin-x64.tar.gz
neuro-book-product-darwin-aarch64.tar.gz
neuro-book-windows-x64.zip
ghcr.io/notnotype/neuro-book:<tag>
```

Release Manifest v5 records the unified build ID, application version, Git revision, channel, minimum Manager version, asset URLs and SHA256 for the five platforms, the Windows Portable asset, the GHCR digest and the Application State migration declaration. All five platforms must be present and unique, and Source, Product, Portable and Installation must belong to the same build ID; the product packaging command also refuses to cross-label the current host's `.output` as another platform. The resolver reads the stable envelope first and tells you to upgrade the Manager, then parses the platform payload strictly. Installation Manifest v5 and Operation Journal v5 are a hard cutover; old installations are not migrated automatically.

### Migrating older instances to v5

- Stop the instance and back up the entire State Root first. For Windows Portable, that means backing up all of `data/`; Windows Portable and Installed Windows may initially report `scheduled` from `uninstall --json`, so wait for the external Host's final receipt.
- Reinstall the same profile into a new Installation Root and reuse only the State Root; do not copy the old `.deploy`, `.runtime`, `.output`, generated Compose file or wrapper.
- If a portable install used an absolute `DATABASE_URL` as a temporary login fix, restore it to `file:./workspace/.nbook/neuro-book.sqlite` after migrating.
- Old installation manifests and unfinished operations require manual review of the manifest, product, Git, Compose and SQLite state; the v5 Manager neither converts nor ignores them.
- When an old agent session carries a full Pi model and cannot prove its provider config ID, use the per-entry mapping maintenance command described in the [0.8.9 migration notes](./changelog/v0.8#session-model-refs).

## Recommended Acceptance Checks

The release and PR workflows run Manager, Stage 0, native package, HTTP and browser smoke tests against the native product build. The final release index additionally waits on the public gates for Linux x64 Docker, Linux ARM64 Docker, Linux x64 rootless Podman, and Windows Portable data reuse; the GHCR chain covers migration, admin creation, login, restart, doctor and operation recovery. Even so, it is still worth manually verifying the first launch, login, project creation, the update prompt, and data retention after an update.

::: warning Currently unverified / known issues
- **Docker Desktop and rootless Podman deployments on Apple Silicon have not been verified on real hardware.**
- Under rootless Podman, `podman-compose stop` deletes the container along with it.
- The Manager only installs releases with a fully published index, so the version you actually get may be lower than the latest version number. Confirm with `neuro-book status`.
:::
