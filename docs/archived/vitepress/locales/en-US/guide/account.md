# Account and Cloud Backup

::: warning This is optional
NeuroBook is **fully usable without an account**. Everything runs locally, and the account exists only to carry cloud backup and, later, asset distribution. If you would rather stay offline, skip this page.
:::

The **NeuroBook Account** section of the settings page handles this.

## Linking a Device

Linking uses a **device code flow**: the client gets a code, you approve it in a browser, and the client polls until it receives credentials. At no point does anything like an API key pass in the clear between the two sides.

You can **unlink** at any time. Credentials support rotation, and rotating revokes the old credential chain, so a credential leaked from one device does not stay valid for long.

## Cloud Backup

Once linked, you can back **the entire instance data** up to the cloud — not a single project, but the workspace, config and secrets under your State Root.

Backups are **cold snapshots**: the database is snapshotted consistently first, then packed and uploaded as a stream, so you will not end up with half a database just because you happened to be writing. The upload is streamed, so a large project will not blow up memory. Quota is limited, and old backups rotate out once you exceed it.

The panel shows the backup list, backup times and comments, and lets you delete backups you no longer want.

**Restoring is semi-automatic**: a downloaded backup is unpacked into a staging directory, and then you have to **stop the service and swap it in by hand**. That is deliberate — automatically overwriting the data of a work in progress is too risky, and one extra manual confirmation is worth it.

::: danger What a backup contains
A cloud backup packs up **the entire instance data**, and the scope is wider than you might assume:

- Every project's workspace (prose, worldbook, World Engine database)
- The **file history database**, which means content you have deleted
- **Secrets such as `.env` and `config.yaml`**, which hold your model API keys and the instance password

That is what a backup is supposed to do (a restored instance that cannot start would be useless), but it also means **the backup file itself must be treated as a secret**. Note as well: after restoring from a backup, settings such as the instance password revert to their backup-time state.

What the server stores is an account-scoped opaque blob.
:::

## Local Backup Is Still the First Choice

Cloud backup is extra insurance, not the only method. **The most reliable backup is still copying the State Root directory** — it is all ordinary files and SQLite, with no external dependencies, and it works straight off an external drive. See [Where Your Data Lives](/en/operations#where-your-data-lives).

## Workshop

The Workshop is the companion distribution platform, used to share and download installable assets such as profiles, Skills and templates.

::: warning Not open yet
The Workshop site **is not publicly live**, and one-click install inside the NeuroBook client **is not wired up** either. The current version has no Workshop entry point at all.

What this section documents is the planned shape, not something you can use today. It will be rewritten as real usage instructions once the site launches.
:::

## Status

Both the client and the server side of account linking and cloud backup are implemented, but **full browser acceptance checks are still in progress**. If you care about data safety, rely mainly on local backups for now.

## Keep Reading

- [Settings](/en/guide/settings)
- [Running, Data and Privacy](/en/operations)
