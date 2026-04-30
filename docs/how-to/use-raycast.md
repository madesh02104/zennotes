# Use ZenNotes with Raycast on macOS

This guide shows how to search ZenNotes from Raycast and open notes back in ZenNotes.

## Requirements

You need:

- macOS
- Raycast
- ZenNotes desktop
- the ZenNotes CLI installed as `zen`

Raycast support is macOS-only because Raycast is macOS-only.

## 1. Install the ZenNotes CLI

Open ZenNotes and go to `Settings -> CLI`.

Click `Install`.

ZenNotes prefers a user-writable PATH directory such as `~/.local/bin`, `~/bin`, or Homebrew's bin directory. If the chosen directory is not already on PATH, Settings shows the exact shell command to add it. ZenNotes only falls back to `/usr/local/bin` with an admin prompt when it cannot find a writable PATH location.

Verify the install in a new terminal:

```bash
zen list
```

If a note path contains spaces, quote it or use `--path`:

```bash
zen read "hellointerview/system design.md"
zen read --path "hellointerview/system design.md"
```

## 2. Install the Raycast extension

For local testing, run the extension from the repo root:

```bash
cd integrations/raycast
npm install
npm run dev
```

Raycast opens the local extension in development mode. Run the command named `Search Notes`.

For the Raycast Store version, install the extension from Raycast instead of running the local development command.

## 3. Search and open notes

Use Raycast's `Search Notes` command.

The command lists notes from:

```bash
zen list --json --limit 2000
```

Selecting a result opens the note in ZenNotes through:

```text
zennotes://open?path=<vault-relative-note-path>
```

Use Raycast's action menu for:

- Open in ZenNotes
- Open in Floating Window
- Archive
- Unarchive
- Move to Trash
- Reveal in Finder
- Copy Note Path
- Copy Wikilink

The floating-window action uses:

```text
zennotes://open-window?path=<vault-relative-note-path>
```

The search bar dropdown includes folder and tag filters, so you can narrow search without leaving Raycast.

## Troubleshooting

If Raycast keeps loading:

- run `zen list` in a new terminal and make sure it prints notes
- open `Settings -> CLI` and reinstall the CLI if Raycast cannot find `zen`
- install a ZenNotes desktop release that supports `zennotes://open` and `zennotes://open-window`
- restart Raycast after changing PATH

If opening a note fails:

- make sure ZenNotes is installed in `/Applications` or is already running
- update ZenNotes to a release that includes deep-link support
- check that the note path is vault-relative, not an absolute filesystem path

## Related docs

- [Get Started on Desktop](../tutorials/get-started-desktop.md)
- [Settings Reference](../reference/settings-reference.md)
- [Vault and Folder Model](../reference/vault-and-folder-model.md)
