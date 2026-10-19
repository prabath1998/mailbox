package storage

import (
	"database/sql"
	"path/filepath"
	"testing"
	"time"
)

func newStore(t *testing.T) *SQLiteStorage {
	t.Helper()
	s, err := NewSQLiteStorage(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func save(t *testing.T, s *SQLiteStorage, m Message) *Summary {
	t.Helper()
	if m.Received.IsZero() {
		m.Received = time.Now()
	}
	if m.Date.IsZero() {
		m.Date = m.Received
	}
	sum, err := s.Save(&m)
	if err != nil {
		t.Fatal(err)
	}
	return sum
}

func msg(subject, from, to string) Message {
	return Message{Summary: Summary{Subject: subject, From: Address{Address: from}, To: []Address{{Address: to}}}}
}

func ids(p *Page) []int64 {
	var out []int64
	for _, m := range p.Messages {
		out = append(out, m.ID)
	}
	return out
}

func TestSaveAndGet(t *testing.T) {
	s := newStore(t)
	m := msg("Welcome", "app@example.com", "dev@example.com")
	m.HTML = "<p>Hi</p>"
	m.Tags = []string{"signup"}
	m.AttachmentParts = []Attachment{{FileName: "a.txt", ContentType: "text/plain", Data: []byte("hello"), Size: 5}}
	sum := save(t, s, m)

	got, err := s.Get(sum.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Subject != "Welcome" || got.HTML != "<p>Hi</p>" || got.Attachments != 1 || len(got.AttachmentParts) != 1 {
		t.Fatalf("unexpected message: %+v", got)
	}
	if len(got.Tags) != 1 || got.Tags[0] != "signup" {
		t.Fatalf("tags = %v", got.Tags)
	}
	a, err := s.GetAttachment(sum.ID, got.AttachmentParts[0].ID)
	if err != nil || string(a.Data) != "hello" {
		t.Fatalf("attachment = %q, %v", a.Data, err)
	}
	if _, err := s.Get(999); err != ErrNotFound {
		t.Fatalf("Get(999) error = %v, want ErrNotFound", err)
	}
}

func TestSearchFilters(t *testing.T) {
	s := newStore(t)
	a := save(t, s, msg("Reset your password", "auth@example.com", "ana@example.com"))
	bm := msg("Invoice 42", "billing@example.com", "bob@example.com")
	bm.Tags = []string{"billing"}
	bm.AttachmentParts = []Attachment{{FileName: "invoice.pdf"}}
	b := save(t, s, bm)
	s.SetRead([]int64{a.ID}, true)

	cases := map[string][]int64{
		"":                        {b.ID, a.ID},
		"password":                {a.ID},
		"from:billing":            {b.ID},
		"to:ana":                  {a.ID},
		"subject:invoice":         {b.ID},
		`subject:"your password"`: {a.ID},
		`"invoice 42"`:            {b.ID},
		`"42 invoice"`:            nil,
		"is:read":                 {a.ID},
		"is:unread":               {b.ID},
		"has:attachment":          {b.ID},
		"tag:billing":             {b.ID},
		"tag:bill":                nil, // tags match exactly
		"tag:billing reset":       nil,
	}
	for q, want := range cases {
		page, err := s.List(Query{Search: q, Limit: 10})
		if err != nil {
			t.Fatal(err)
		}
		if got := ids(page); !equal(got, want) {
			t.Errorf("search %q = %v, want %v", q, got, want)
		}
	}
}

func TestSince(t *testing.T) {
	s := newStore(t)
	old := msg("old", "a@x", "b@x")
	old.Received = time.Now().Add(-time.Hour)
	save(t, s, old)
	cutoff := time.Now().Add(-time.Minute)
	recent := save(t, s, msg("new", "a@x", "b@x"))

	page, err := s.List(Query{Since: cutoff, Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if got := ids(page); !equal(got, []int64{recent.ID}) {
		t.Fatalf("since = %v, want [%d]", got, recent.ID)
	}
}

func TestPrune(t *testing.T) {
	s := newStore(t)
	old := msg("old", "a@x", "b@x")
	old.Received = time.Now().Add(-48 * time.Hour)
	o := save(t, s, old)
	var keep []int64
	for i := 0; i < 3; i++ {
		keep = append([]int64{save(t, s, msg("m", "a@x", "b@x")).ID}, keep...)
	}

	deleted, err := s.Prune(0, time.Now().Add(-24*time.Hour))
	if err != nil || !equal(deleted, []int64{o.ID}) {
		t.Fatalf("prune by age deleted %v, %v", deleted, err)
	}
	deleted, err = s.Prune(2, time.Time{})
	if err != nil || !equal(deleted, []int64{keep[2]}) {
		t.Fatalf("prune by count deleted %v, %v; want [%d]", deleted, err, keep[2])
	}
	page, _ := s.List(Query{Limit: 10})
	if got := ids(page); !equal(got, keep[:2]) {
		t.Fatalf("left %v, want %v", got, keep[:2])
	}
	if deleted, _ := s.Prune(0, time.Time{}); deleted != nil {
		t.Fatalf("no limits deleted %v", deleted)
	}
}

func TestTags(t *testing.T) {
	s := newStore(t)
	for _, tags := range [][]string{{"billing"}, {"billing", "eu"}, nil} {
		m := msg("m", "a@x", "b@x")
		m.Tags = tags
		save(t, s, m)
	}
	got, err := s.Tags()
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0] != (TagCount{"billing", 2}) || got[1] != (TagCount{"eu", 1}) {
		t.Fatalf("tags = %v", got)
	}
}

// Databases created before tags existed get the column added on open.
func TestMigrateAddsTags(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL DEFAULT '',
		from_name TEXT NOT NULL DEFAULT '', from_addr TEXT NOT NULL DEFAULT '', to_json TEXT NOT NULL DEFAULT '[]',
		cc_json TEXT NOT NULL DEFAULT '[]', bcc_json TEXT NOT NULL DEFAULT '[]', reply_to_json TEXT NOT NULL DEFAULT '[]',
		subject TEXT NOT NULL DEFAULT '', snippet TEXT NOT NULL DEFAULT '', date TEXT NOT NULL, received TEXT NOT NULL,
		size INTEGER NOT NULL DEFAULT 0, read INTEGER NOT NULL DEFAULT 0, attachment_count INTEGER NOT NULL DEFAULT 0,
		text_body TEXT NOT NULL DEFAULT '', html_body TEXT NOT NULL DEFAULT '', headers_json TEXT NOT NULL DEFAULT '[]', raw BLOB);
		INSERT INTO messages (subject, date, received) VALUES ('legacy', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00+05:30');`); err != nil {
		t.Fatal(err)
	}
	db.Close()

	s, err := NewSQLiteStorage(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	page, err := s.List(Query{Limit: 10})
	if err != nil || len(page.Messages) != 1 || page.Messages[0].Subject != "legacy" || len(page.Messages[0].Tags) != 0 {
		t.Fatalf("after migration: %+v, %v", page, err)
	}
}

func equal(a, b []int64) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
