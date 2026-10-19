# MailBox

Catches the email your app sends and shows it in a web UI, so you can test email
without sending any. Point your app's SMTP at `localhost:1025` and open
http://localhost:8025.

MailBox also checks each email: how it renders in the major clients, how it looks
in dark mode, whether it's accessible, whether its links work, and how spammy it
looks.

## Features

- **Live inbox** with toasts and optional desktop notifications
- **Search** with `from:`, `to:`, `subject:`, `tag:`, `is:unread`, `is:read`, `has:attachment` and `"quoted phrases"`
- **Preview** in light mode, in dark mode (the email's own dark styles, as in Apple Mail) and in forced dark mode (inverted colours, as in the Gmail and Outlook apps), at desktop or mobile width
- **Accessibility check**: missing alt text, low-contrast text (measured on the rendered email), vague link text, tiny text, image-only emails, missing language and headings, layout tables
- **Client compatibility check** against Gmail, Outlook, Apple Mail, Yahoo and Samsung Email
- **Link checker** for broken links and images, and a built-in **spam score**
- **Testing API**: wait for an email in your end-to-end tests and pull out its links and one-time codes
- **Tags** from an `X-Tags` header or plus-addressing (`dev+billing@example.com`), so several apps can share one inbox
- **Webhooks**, a **sendmail** replacement for PHP's `mail()`, automatic cleanup, and optional logins for shared servers
- Text, headers, raw source and `.eml` download; attachments and inline images
- Keyboard shortcuts: `j`/`k` move, `/` search, `e` delete, `u` unread, `x` select, `r` refresh, `?` help

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
| `-max-messages` | `MAILBOX_MAX_MESSAGES` | `500`: older mail is deleted automatically. `0` keeps everything. |
| `-max-age` | `MAILBOX_MAX_AGE` | Off. Delete mail older than this, e.g. `7d` or `12h`. |
| `-webhook` | `MAILBOX_WEBHOOK` | Off. URL to POST each new message to. |
| `-ui-auth` | `MAILBOX_UI_AUTH` | Off. Require a login for the web UI and API: `user:pass[,user2:pass2]`. |
| `-smtp-auth` | `MAILBOX_SMTP_AUTH` | Off, so any SMTP login is accepted. Set `user:pass[,...]` to accept only those. |
| `-open` | | Open the web UI on start |
| `-version` | | Print the version |

### Catch mail sent with PHP `mail()` (sendmail)

Apps that send through a local `sendmail` binary instead of SMTP can use
`mailbox sendmail`, which hands the message to the running MailBox. In `php.ini`:

```ini
sendmail_path = "/usr/local/bin/mailbox sendmail -t -i"
```

It accepts the usual sendmail flags (`-t`, `-i`, `-f`). Use `-S host:port`, or set
`MAILBOX_SENDMAIL_SMTP`, if MailBox isn't on `localhost:1025`. You can also
symlink the binary as `sendmail`.

### Tags

A message is tagged from its `X-Tags` header (`X-Tags: billing, eu`) and from
plus-addressed recipients (`dev+billing@example.com` is tagged `billing`). Tags
show in the sidebar; search with `tag:billing`.

### Sharing one MailBox with a team

```bash
mailbox -ui-auth "ana:pw1,bob:pw2" -smtp-auth "app:secret" -max-age 7d
```

The browser asks for the login once. API clients pass it with `curl -u ana:pw1`.
SMTP has no TLS, so keep MailBox on a private network or VPN rather than the open
internet.

## Testing API

End-to-end tests can trigger an email, wait for it, and act on it:

```bash
# Wait up to 30s for a matching email received after `since` (Unix ms or RFC 3339).
curl "http://localhost:8025/api/messages/wait?q=to:ana@example.com%20subject:confirm&since=1760860800000&timeout=30"

# Its links (with link text) and likely one-time codes, best guess first.
curl http://localhost:8025/api/messages/42/extract
# {"links":[{"url":"https://app.test/confirm?t=abc","text":"Confirm email"}],"codes":["482913"]}
```

`wait` returns the full message as soon as one matches (immediately if one already
has), or `404` after the timeout (default 30s, at most 2 minutes). It doesn't mark
the message read. `q` uses the same syntax as the search box.

Ready-to-copy helpers:

- **Playwright**: [`examples/playwright/mailbox.ts`](examples/playwright/mailbox.ts) and an [example test](examples/playwright/signup.spec.ts)
- **Laravel** (PHPUnit or Dusk): [`InteractsWithMailBox`](examples/laravel/tests/Concerns/InteractsWithMailBox.php) and an [example test](examples/laravel/tests/Feature/PasswordResetEmailTest.php)

In GitHub Actions, run MailBox as a service:

```yaml
services:
  mailbox:
    image: ghcr.io/prabath1998/mailbox
    ports: ["1025:1025", "8025:8025"]
```

### Webhooks

With `-webhook URL`, every new message is POSTed as JSON (retried once on failure):

```json
{
  "event": "message.received",
  "message": { "id": 42, "subject": "Welcome", "from": { "name": "", "address": "app@x.dev" }, "tags": ["signup"], "...": "..." },
  "url": "http://localhost:8025/#/message/42"
}
```

## Development

The web UI is built into `web/dist` and embedded in the binary. `web/dist` is
committed so `go install` works without Node, so rebuild and commit it when the
frontend changes (CI checks this).

```bash
cd frontend && npm install && npm run build && cd ..   # rebuild the embedded UI
go run .                                                # terminal 1: API + SMTP
cd frontend && npm run dev                              # terminal 2: http://localhost:5173 with hot reload
go test -race ./...                                     # run the tests
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
| GET | `/api/messages/wait?q=&since=&timeout=` | Wait for a matching message (see [Testing API](#testing-api)) |
| GET | `/api/messages/{id}` | Full message (marks it read) |
| DELETE | `/api/messages` | Delete `{"ids": [...]}`, or everything with no body |
| DELETE | `/api/messages/{id}` | Delete one |
| PUT | `/api/messages/read` | `{"ids": [...], "read": true}`; empty ids = all |
| GET | `/api/messages/{id}/raw` | Raw source (`?download` for .eml) |
| GET | `/api/messages/{id}/attachments/{aid}` | Attachment (`?download`) |
| GET | `/api/messages/{id}/spam` | Spam report |
| GET | `/api/messages/{id}/links` | Link check |
| GET | `/api/messages/{id}/extract` | Links and one-time codes |
| GET | `/api/tags` | Tags with message counts |
| GET | `/api/events` | Server-Sent Events stream |
