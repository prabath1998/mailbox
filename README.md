# MailBox

A local mail catcher for development. Point your app's SMTP at `localhost:1025`
and read caught mail at http://localhost:8025. Any username/password is accepted;
there is no TLS.

## Features

- Live inbox (Server-Sent Events), toasts and optional desktop notifications
- Search with filters: `from:`, `to:`, `subject:`, `is:unread`, `is:read`, `has:attachment`
- Read/unread, bulk select, delete, delete all, pagination
- HTML preview (sandboxed, desktop/mobile width), text, headers, raw source, `.eml` download
- Attachments and inline `cid:` images, Cc/Bcc detection
- HTML compatibility check against major email clients
- Link checker for broken links and images
- Built-in spam score (no SpamAssassin needed)
- Keyboard: `j`/`k` move, `/` search, `e` delete, `u` unread, `x` select, `r` refresh

## Install

MailBox is a single binary. It listens on port 8025 for the web UI and port 1025 for SMTP.

### Homebrew (macOS and Linux)

```bash
brew install prabath1998/tap/mailbox
brew services start mailbox   # optional: keep it running in the background
```

### Install script (Linux and macOS)

Installs to `/usr/local/bin/mailbox`:

```bash
sudo sh < <(curl -sL https://raw.githubusercontent.com/prabath1998/mailbox/master/install.sh)
```

Set `INSTALL_PATH` to install somewhere else, or `VERSION` to pin a release:

```bash
sudo INSTALL_PATH=/usr/bin VERSION=v0.1.0 sh < <(curl -sL https://raw.githubusercontent.com/prabath1998/mailbox/master/install.sh)
```

Without `sudo`, it installs to `~/.local/bin`. The script verifies the download against the release checksums.

### Download a binary (Windows, Linux and macOS)

Get the archive for your platform from the [releases page](https://github.com/prabath1998/mailbox/releases),
extract `mailbox` (`mailbox.exe` on Windows), and run it or copy it onto your `PATH`.

### Docker

```bash
docker run -d --name mailbox -p 1025:1025 -p 8025:8025 -v mailbox:/data ghcr.io/prabath1998/mailbox
```

Images are published for amd64 and arm64.

### Go

```bash
go install github.com/prabath1998/mailbox@latest
```

### Run it automatically with systemd (Linux)

Save as `~/.config/systemd/user/mailbox.service`:

```ini
[Unit]
Description=MailBox mail catcher

[Service]
ExecStart=/usr/local/bin/mailbox
Restart=on-failure

[Install]
WantedBy=default.target
```

Then run `systemctl --user enable --now mailbox`.

## Run

```bash
mailbox          # then open http://localhost:8025
mailbox -open    # also opens the web UI in your browser
```

Then point your app at it. For Laravel:

```dotenv
MAIL_MAILER=smtp
MAIL_HOST=127.0.0.1
MAIL_PORT=1025
MAIL_USERNAME=null
MAIL_PASSWORD=null
MAIL_ENCRYPTION=null
```

| Flag | Env | Default |
| --- | --- | --- |
| `-smtp` | `MAILBOX_SMTP` | `:1025` |
| `-http` | `MAILBOX_HTTP` | `:8025` |
| `-db` | `MAILBOX_DB` | `mailbox/mailbox.db` in your user cache directory (`~/.cache` on Linux, `~/Library/Caches` on macOS, `%LocalAppData%` on Windows) |
| `-open` | | Open the web UI on start |
| `-version` | | Print the version |

## Development

The web UI is built into `web/dist` and embedded in the binary. `web/dist` is
committed so `go install` works without Node, so rebuild and commit it when the
frontend changes (CI checks this).

```bash
cd frontend && npm install && npm run build && cd ..   # rebuild the embedded UI
go run .                                                # terminal 1: API + SMTP
cd frontend && npm run dev                              # terminal 2: http://localhost:5173 with hot reload
```

## Releasing

Push a version tag. GitHub Actions builds binaries for every platform with
GoReleaser, attaches them to a GitHub release, and pushes a multi-arch image to
`ghcr.io/prabath1998/mailbox`.

```bash
git tag v0.1.0 && git push origin v0.1.0
```

The Homebrew formula is published to `github.com/prabath1998/homebrew-tap` when the
repository secret `HOMEBREW_TAP_TOKEN` is set: a fine-grained token with
*Contents: read and write* on that repo. Without it, releases skip Homebrew.

## API

| Method | Path | |
| --- | --- | --- |
| GET | `/api/info` | Server info (SMTP address) |
| GET | `/api/messages?q=&limit=&offset=` | List and search |
| GET | `/api/messages/{id}` | Full message (marks it read) |
| DELETE | `/api/messages` | Delete `{"ids": [...]}`, or everything with no body |
| DELETE | `/api/messages/{id}` | Delete one |
| PUT | `/api/messages/read` | `{"ids": [...], "read": true}`; empty ids = all |
| GET | `/api/messages/{id}/raw` | Raw source (`?download` for .eml) |
| GET | `/api/messages/{id}/attachments/{aid}` | Attachment (`?download`) |
| GET | `/api/messages/{id}/spam` | Spam report |
| GET | `/api/messages/{id}/links` | Link check |
| GET | `/api/events` | Server-Sent Events stream |
