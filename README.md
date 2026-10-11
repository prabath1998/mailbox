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

## Run

```bash
cd frontend && npm install && npm run build && cd ..   # builds the UI into web/
go run .
```

Flags: `-smtp :1025`, `-http :8025`, `-db ./emails.db`.

## Frontend development

```bash
go run .                      # terminal 1: API + SMTP
cd frontend && npm run dev    # terminal 2: http://localhost:5173 with hot reload
```

## API

| Method | Path | |
| --- | --- | --- |
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
