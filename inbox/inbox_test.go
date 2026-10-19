package inbox

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/prabath1998/mailbox/events"
	"github.com/prabath1998/mailbox/storage"
)

func newInbox(t *testing.T) *Inbox {
	t.Helper()
	store, err := storage.NewSQLiteStorage(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	return &Inbox{Storage: store, Events: events.NewHub()}
}

const raw = "From: app@x\r\nTo: dev@x\r\nSubject: Hi\r\n\r\nbody\r\n"

func TestMaxMessages(t *testing.T) {
	in := newInbox(t)
	in.MaxMessages = 2
	ch, cancel := in.Events.Subscribe()
	defer cancel()

	var last *storage.Summary
	for i := 0; i < 3; i++ {
		s, err := in.Deliver([]byte(raw), "app@x", []string{"dev@x"})
		if err != nil {
			t.Fatal(err)
		}
		last = s
	}
	page, _ := in.Storage.List(storage.Query{Limit: 10})
	if page.Total != 2 || page.Messages[0].ID != last.ID {
		t.Fatalf("kept %d messages, newest %d", page.Total, page.Messages[0].ID)
	}

	// The UI is told about both the new mail and what was pruned.
	var sawDelete bool
	for len(ch) > 0 {
		if e := <-ch; e.Type == "deleted" && len(e.IDs) == 1 && e.IDs[0] == 1 {
			sawDelete = true
		}
	}
	if !sawDelete {
		t.Error("no deleted event for the pruned message")
	}
}

func TestWebhook(t *testing.T) {
	got := make(chan WebhookPayload, 1)
	hook := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var p WebhookPayload
		json.NewDecoder(r.Body).Decode(&p)
		got <- p
	}))
	defer hook.Close()

	in := newInbox(t)
	in.Webhook = hook.URL
	in.BaseURL = "http://localhost:8025"
	sum, err := in.Deliver([]byte(raw), "app@x", []string{"dev@x"})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case p := <-got:
		if p.Event != "message.received" || p.Message.ID != sum.ID || p.Message.Subject != "Hi" || p.URL != "http://localhost:8025/#/message/1" {
			t.Errorf("payload = %+v", p)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("webhook not called")
	}
}
