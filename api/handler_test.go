package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/prabath1998/mailbox/checks"
	"github.com/prabath1998/mailbox/events"
	"github.com/prabath1998/mailbox/inbox"
	"github.com/prabath1998/mailbox/storage"
)

type env struct {
	srv   *httptest.Server
	inbox *inbox.Inbox
}

func setup(t *testing.T, creds map[string]string) *env {
	t.Helper()
	store, err := storage.NewSQLiteStorage(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	hub := events.NewHub()
	static := fstest.MapFS{"index.html": {Data: []byte("<html>ui</html>")}}
	srv := httptest.NewServer(BasicAuth(NewHandler(store, hub, ":1025", static).Router, creds))
	t.Cleanup(func() {
		srv.Close()
		store.Close()
	})
	return &env{srv: srv, inbox: &inbox.Inbox{Storage: store, Events: hub}}
}

func (e *env) deliver(t *testing.T, to, subject, body string) *storage.Summary {
	t.Helper()
	raw := fmt.Sprintf("From: app@x\r\nTo: %s\r\nSubject: %s\r\n\r\n%s\r\n", to, subject, body)
	sum, err := e.inbox.Deliver([]byte(raw), "app@x", []string{to})
	if err != nil {
		t.Fatal(err)
	}
	return sum
}

func get(t *testing.T, url string, out any) int {
	t.Helper()
	resp, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if out != nil && resp.StatusCode == 200 {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			t.Fatal(err)
		}
	}
	return resp.StatusCode
}

func TestWaitReturnsExistingMatch(t *testing.T) {
	e := setup(t, nil)
	e.deliver(t, "ana@x", "Welcome", "hi")
	var m storage.Message
	if code := get(t, e.srv.URL+"/api/messages/wait?q=to:ana@x&timeout=1", &m); code != 200 || m.Subject != "Welcome" {
		t.Fatalf("code %d, message %+v", code, m.Summary)
	}
	if m.Read {
		t.Error("wait must not mark the message read")
	}
}

func TestWaitBlocksUntilArrival(t *testing.T) {
	e := setup(t, nil)
	e.deliver(t, "ana@x", "Old", "earlier mail must not satisfy the wait")
	since := time.Now()
	go func() {
		time.Sleep(200 * time.Millisecond)
		e.deliver(t, "bob@x", "Unrelated", "")
		e.deliver(t, "ana@x", "Your code", "Your code is 123456")
	}()
	start := time.Now()
	var m storage.Message
	url := fmt.Sprintf("%s/api/messages/wait?q=to:ana@x&since=%d&timeout=5s", e.srv.URL, since.UnixMilli())
	if code := get(t, url, &m); code != 200 || m.Subject != "Your code" {
		t.Fatalf("code %d, subject %q", code, m.Subject)
	}
	if waited := time.Since(start); waited < 150*time.Millisecond || waited > 2*time.Second {
		t.Errorf("waited %v", waited)
	}

	var x checks.Extracted
	if code := get(t, fmt.Sprintf("%s/api/messages/%d/extract", e.srv.URL, m.ID), &x); code != 200 || len(x.Codes) != 1 || x.Codes[0] != "123456" {
		t.Errorf("extract: code %d, %+v", code, x)
	}
}

func TestWaitTimesOut(t *testing.T) {
	e := setup(t, nil)
	start := time.Now()
	if code := get(t, e.srv.URL+"/api/messages/wait?q=to:nobody@x&timeout=300ms", nil); code != http.StatusNotFound {
		t.Fatalf("code %d, want 404", code)
	}
	if time.Since(start) < 300*time.Millisecond {
		t.Error("returned before the timeout")
	}
	if code := get(t, e.srv.URL+"/api/messages/wait?timeout=soon", nil); code != http.StatusBadRequest {
		t.Errorf("bad timeout: code %d, want 400", code)
	}
}

func TestTagsEndpoint(t *testing.T) {
	e := setup(t, nil)
	e.deliver(t, "dev+billing@x", "Invoice", "")
	var tags []storage.TagCount
	if code := get(t, e.srv.URL+"/api/tags", &tags); code != 200 || len(tags) != 1 || tags[0].Name != "billing" {
		t.Fatalf("code %d, tags %v", code, tags)
	}
	var page storage.Page
	get(t, e.srv.URL+"/api/messages?q=tag:billing", &page)
	if page.Total != 1 {
		t.Errorf("tag search found %d", page.Total)
	}
}

func TestBasicAuth(t *testing.T) {
	e := setup(t, map[string]string{"dev": "s3cret"})
	for _, path := range []string{"/", "/api/messages", "/api/events"} {
		if code := get(t, e.srv.URL+path, nil); code != http.StatusUnauthorized {
			t.Errorf("%s without login: %d, want 401", path, code)
		}
	}
	try := func(user, pass string) int {
		req, _ := http.NewRequest("GET", e.srv.URL+"/api/messages", nil)
		req.SetBasicAuth(user, pass)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	if code := try("dev", "wrong"); code != http.StatusUnauthorized {
		t.Errorf("wrong password: %d", code)
	}
	if code := try("nobody", "s3cret"); code != http.StatusUnauthorized {
		t.Errorf("unknown user: %d", code)
	}
	if code := try("dev", "s3cret"); code != http.StatusOK {
		t.Errorf("right password: %d", code)
	}
}

func TestParseCredentials(t *testing.T) {
	got, err := ParseCredentials("a:1, b:pa:ss ,")
	if err != nil || len(got) != 2 || got["a"] != "1" || got["b"] != "pa:ss" {
		t.Errorf("got %v, %v", got, err)
	}
	for _, bad := range []string{"nopassword", ":x", "u:"} {
		if _, err := ParseCredentials(bad); err == nil {
			t.Errorf("%q should fail", bad)
		}
	}
}

func TestStaticCacheHeaders(t *testing.T) {
	e := setup(t, nil)
	resp, err := http.Get(e.srv.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if cc := resp.Header.Get("Cache-Control"); !strings.Contains(cc, "no-cache") {
		t.Errorf("index Cache-Control = %q", cc)
	}
}
