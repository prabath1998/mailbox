package sendmail_test

import (
	"net"
	"path/filepath"
	"strings"
	"testing"

	"github.com/prabath1998/mailbox/events"
	"github.com/prabath1998/mailbox/inbox"
	"github.com/prabath1998/mailbox/sendmail"
	"github.com/prabath1998/mailbox/smtp"
	"github.com/prabath1998/mailbox/storage"
)

// PHP's mail() runs `sendmail -t -i` with LF line endings; that must reach the inbox.
func TestRunDeliversToServer(t *testing.T) {
	store, err := storage.NewSQLiteStorage(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	srv := smtp.NewSMTPServer(&inbox.Inbox{Storage: store, Events: events.NewHub()}, nil)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	go srv.Serve(ln)
	defer srv.Close()

	msg := "From: App <app@x>\nTo: dev@x\nSubject: From PHP\n\nLine one\n.\nLine three\n"
	if err := sendmail.Run([]string{"-t", "-i", "-S", ln.Addr().String()}, strings.NewReader(msg)); err != nil {
		t.Fatal(err)
	}
	page, err := store.List(storage.Query{Limit: 10})
	if err != nil || page.Total != 1 {
		t.Fatalf("stored %d, %v", page.Total, err)
	}
	m, _ := store.Get(page.Messages[0].ID)
	if m.Subject != "From PHP" || !strings.Contains(m.Text, "Line one\r\n.\r\nLine three") {
		t.Fatalf("subject %q text %q", m.Subject, m.Text)
	}
}

func TestRunReportsUnreachableServer(t *testing.T) {
	err := sendmail.Run([]string{"-S", "127.0.0.1:1", "dev@x"}, strings.NewReader("Subject: x\n\nbody\n"))
	if err == nil || !strings.Contains(err.Error(), "is `mailbox` running?") {
		t.Fatalf("err = %v", err)
	}
}
