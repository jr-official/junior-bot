# Media library (private stickers / images / GIFs)

Personal libraries for a fixed allow-list of users. Each user's library is private.

## Setup (Railway → Variables)
- `MEDIA_ALLOWED_USER_IDS` – comma-separated Discord user IDs. **Empty = feature disabled.**
- Optional: `MEDIA_MAX_USER_MB` (40), `MEDIA_MAX_FILE_MB` (8), `MEDIA_MAX_ITEMS` (100).
- No new credentials: files are stored in the existing MongoDB (`media_items`, `media_files`).
- The bot needs the **Message Content** privileged intent (already used) and, in servers,
  *Send Messages*, *Attach Files* and (to delete `!sticker_x` commands) *Manage Messages*.

## Use
- `/media` – opens your library (browse, preview, send, rename, delete).
- `/media file:<upload> name:<name> [type:image|gif|sticker]` – add an item. Stickers are resized to fit 320×320.
- `/sticker name:<name>` – same as the prefix command, with autocomplete; also works in DMs with friends
  (needs User Install enabled for the app, see below).
- **Shared library:** `/media shared:true` opens it (or adds when combined with `file`/`name`); `!shared_<name>` and
  `/sticker library:shared` send from it. Every allowed user can add and use items; each item shows who added it, and
  only that person can rename/delete it. Quota: `MEDIA_MAX_SHARED_MB` (40) / `MEDIA_MAX_SHARED_ITEMS` (100).
- `!sticker_<name>` (also `!gif_<name>`, `!img_<name>`) – sends your item; the command message is deleted
  where Discord allows (servers with Manage Messages; never in DMs).

## Security
Allow-list is enforced in every handler and again in `mediaService` (all queries are scoped by `ownerId`).
Outsiders get an ephemeral "not available" on `/media` and are silently ignored for `!` commands.

Slash commands are registered by the moderation feature in one `commands.set()` call
(`client.extraSlashCommands`), so media must be initialised before moderation in `main.js`.
