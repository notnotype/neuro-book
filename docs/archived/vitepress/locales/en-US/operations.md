# Running, Data and Privacy

This page answers the four things self-hosting users care about most: **how to manage the service, where the data lives, how to back it up, and what must never leave your machine.**

## Starting and Stopping the Service

Once started, it listens on port **3000** by default (`NUXT_PORT` or `PORT` overrides it).

```bash
.runtime/bin/neuro-book start
```

::: warning The Manager does not provide stop or restart
The Manager CLI has `install / manage / instances / adopt / update / start / status / doctor / runtime / tools / admin / uninstall`; **there is no `stop` or `restart` command**. Stopping the service is on you and depends on how you deployed; use the `uninstall` command below when removing an installation.
:::

| Deployment | How to stop |
| --- | --- |
| Windows Portable | Close the console window that `Start Neuro Book.cmd` opened |
| GHCR / container | `docker compose --env-file .env -f .deploy/docker-compose.generated.yml stop` |
| Product Bun / Source | Kill the process running `neuro-book start` (`Ctrl+C` in the foreground) |

Manager v1 **does not take over systemd, pm2 or generic background processes**. To start on boot, or to keep the service alive after an SSH session drops, write your own unit or service file. Container deployments can just use Compose's `restart` policy.

Reverse proxies and HTTPS are equally outside the Manager's scope: point the proxy at the listening port, and remember to let SSE through — the agent's streaming output relies on long-lived connections, so buffering must be off for those paths.

## Updates and Release Channels

```bash
neuro-book update                      # Update on the current channel
neuro-book update --channel stable     # Switch to stable
neuro-book update --channel canary     # Switch to canary
```

The Manager only installs complete releases that have published a final `release-manifest.json`; versions still building or already cancelled are safely skipped. **That means the version you actually get may be lower than the newest one described in the docs** — use `neuro-book status` to see what is really installed.

::: warning Currently in canary
The project is still iterating fast. Known issues: under rootless Podman, `podman-compose stop` deletes the container along with it; Docker / Podman deployments on Apple Silicon have not been verified on real hardware.
:::

## Uninstalling and Data Retention

By default, uninstall removes the program, Cache, Desktop/WebView and logs, but preserves user data in the State Root; an external Project Workspace is never deleted. Interactive terminals can confirm the operation; automation and non-TTY execution must pass `--yes` explicitly:

```bash
neuro-book uninstall --yes
```

Add `--delete-data` only when you explicitly want to remove the managed State Root:

```bash
neuro-book uninstall --yes --delete-data
```

Windows Portable and Installed Windows may finish deletion through an external Host after the current Manager exits. With `--json`, wait for the final receipt; do not treat `scheduled` as completed.

## Where Your Data Lives

`NEURO_BOOK_STATE_ROOT` is the source of truth for state paths. By default the State Root equals the install directory; for Windows Portable it is `data/` inside the install directory.

| Contents | Path (relative to State Root) |
| --- | --- |
| **Your work** (prose, worldbuilding, World Engine config) | `workspace/{project}/` |
| Project database (story structure, promises, decisions) | `workspace/{project}/.nbook/project.sqlite` |
| File history (including full-text snapshots) | `workspace/{project}/.nbook/history.sqlite` |
| Application database (session index, accounts) | `workspace/.nbook/neuro-book.sqlite` |
| Global config | `workspace/.nbook/config.json` |
| Boot config (port, authentication) | `config.yaml` |
| Agent session records | `workspace/.nbook/agent/` |
| Request traces (full prompts and prose) | `workspace/.nbook/agent/traces/` |
| Logs | `logs/` |

**Backing up means copying the whole State Root.** It is all ordinary files and SQLite databases, with no external dependencies, and restoring means putting the directory back. Note that SQLite uses WAL files: **when copying a live install, do not take only the `.sqlite` file and miss `-wal` / `-shm`**. The safest route is to stop the service first.

The prose and worldbuilding are Markdown files that open in any editor; you do not need NeuroBook to read them.

## Privacy Boundaries

Read this section to the end, especially before you send a project or a log bundle to anyone.

**What gets sent to your model provider**: on every call the agent sends the current context — which may include worldbuilding, prose excerpts and story structure — to **the provider you configured yourself**. It does not pass through any NeuroBook server. If you enable embedding retrieval, the indexed content also goes to the embedding endpoint you configured. Check a provider's data-use terms yourself before choosing it.

**Three kinds of sensitive local files**, most sensitive first:

| File | What it holds | Risk when shared |
| --- | --- | --- |
| `traces/` | **Full prompts and novel prose** | Highest. Keeps the most recent 100 per session by default; can be turned off under "Observability" in settings |
| `history.sqlite` | **Full-text snapshots, including content you have deleted** | High. The project download package includes it |
| `project.sqlite` | Story structure, promises, decisions | Medium. No prose |

**The shareable log bundle is safe**: the diagnostic bundle exported by `/api/app/logs/download` goes through an allowlist and **contains only logs and a manifest, no config, no databases and no prose**. Use it when reporting a bug, instead of zipping up the whole State Root.

**The project download package is not safe**: it contains its own snapshot of `history.sqlite`, which means it contains content you have deleted. The frontend warns you about this at download time. To let someone read your work, send the Markdown files under `manuscript/` directly.

## Troubleshooting

```bash
neuro-book status    # Current instance state and version
neuro-book doctor    # Environment check
```

Logs live under `logs/` in the State Root; for container deployments, read the container logs:

```bash
docker compose --env-file .env -f .deploy/docker-compose.generated.yml logs --tail 200 app
```

To have AI help you troubleshoot, hand it [Operator Bridge](/en/operator-bridge) — that document is written for operations agents.

## Keep Reading

- [Deployment](/en/deployment): choosing among the six profiles, and where each one stops.
- [Quick Start](/en/quick-start): the shortest install path.
- [Operator Bridge](/en/operator-bridge): the full index for operations agents.
