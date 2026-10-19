package smtp

import (
	"errors"
	"net"
	"path/filepath"
	"strings"
	"testing"

	"github.com/prabath1998/mailbox/events"
	"github.com/prabath1998/mailbox/inbox"
	"github.com/prabath1998/mailbox/storage"

	"github.com/emersion/go-sasl"
	gosmtp "github.com/emersion/go-smtp"
)

func start(t *testing.T, creds map[string]string) (string, *storage.SQLiteStorage) {
	t.Helper()
	store, err := storage.NewSQLiteStorage(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	srv := NewSMTPServer(&inbox.Inbox{Storage: store, Events: events.NewHub()}, creds)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go srv.Serve(ln)
	t.Cleanup(func() {
		srv.Close()
		store.Close()
	})
	return ln.Addr().String(), store
}

func send(addr string, auth sasl.Client, body string) error {
	c, err := gosmtp.Dial(addr)
	if err != nil {
		return err
	}
	defer c.Close()
	if auth != nil {
		if err := c.Auth(auth); err != nil {
			return err
		}
	}
	return c.SendMail("app@x", []string{"dev@x", "hidden@x"}, strings.NewReader(body))
}

const body = "From: app@x\r\nTo: dev@x\r\nSubject: Hello\r\n\r\nHi\r\n"

func TestDeliver(t *testing.T) {
	addr, store := start(t, nil)
	// Without required credentials, any login works, and so does no login.
	if err := send(addr, sasl.NewPlainClient("", "anything", "goes"), body); err != nil {
		t.Fatal(err)
	}
	if err := send(addr, nil, body); err != nil {
		t.Fatal(err)
	}
	page, err := store.List(storage.Query{Limit: 10})
	if err != nil || page.Total != 2 {
		t.Fatalf("stored %d messages, %v", page.Total, err)
	}
	m := page.Messages[0]
	if m.Subject != "Hello" || len(m.Bcc) != 1 || m.Bcc[0].Address != "hidden@x" {
		t.Fatalf("message = %+v", m)
	}
}

func TestRequiredCredentials(t *testing.T) {
	addr, store := start(t, map[string]string{"app": "secret"})

	var smtpErr *gosmtp.SMTPError
	if err := send(addr, nil, body); !errors.As(err, &smtpErr) || smtpErr.Code != 530 {
		t.Errorf("no login: err = %v, want 530", err)
	}
	if err := send(addr, sasl.NewPlainClient("", "app", "wrong"), body); !errors.As(err, &smtpErr) || smtpErr.Code != 535 {
		t.Errorf("wrong password: err = %v, want 535", err)
	}
	if err := send(addr, sasl.NewPlainClient("", "app", "secret"), body); err != nil {
		t.Errorf("right password: %v", err)
	}
	if page, _ := store.List(storage.Query{Limit: 10}); page.Total != 1 {
		t.Errorf("stored %d messages, want 1", page.Total)
	}
}
