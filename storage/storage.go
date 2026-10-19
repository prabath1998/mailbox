package storage

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

var ErrNotFound = errors.New("message not found")

type Address struct {
	Name    string `json:"name"`
	Address string `json:"address"`
}

type Header struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type Attachment struct {
	ID          int64  `json:"id"`
	PartID      string `json:"partId"`
	FileName    string `json:"fileName"`
	ContentType string `json:"contentType"`
	ContentID   string `json:"contentId"`
	Inline      bool   `json:"inline"`
	Size        int    `json:"size"`
	Data        []byte `json:"-"`
}

// Summary is what the message list needs; it never carries bodies.
type Summary struct {
	ID          int64     `json:"id"`
	MessageID   string    `json:"messageId"`
	From        Address   `json:"from"`
	To          []Address `json:"to"`
	Cc          []Address `json:"cc"`
	Bcc         []Address `json:"bcc"`
	ReplyTo     []Address `json:"replyTo"`
	Subject     string    `json:"subject"`
	Snippet     string    `json:"snippet"`
	Date        time.Time `json:"date"`
	Received    time.Time `json:"received"`
	Size        int       `json:"size"`
	Read        bool      `json:"read"`
	Attachments int       `json:"attachments"`
	Tags        []string  `json:"tags"`
}

type Message struct {
	Summary
	Text            string       `json:"text"`
	HTML            string       `json:"html"`
	Headers         []Header     `json:"headers"`
	AttachmentParts []Attachment `json:"attachmentParts"`
	Raw             []byte       `json:"-"`
}

type Query struct {
	Search string
	// Since, when set, only matches messages received after it.
	Since  time.Time
	Limit  int
	Offset int
}

// TagCount is a tag and how many messages carry it.
type TagCount struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// timeLayout is fixed-width UTC, so stored times also sort correctly as text.
const timeLayout = "2006-01-02T15:04:05.000000000Z"

func formatTime(t time.Time) string { return t.UTC().Format(timeLayout) }

type Page struct {
	Messages []Summary `json:"messages"`
	Total    int       `json:"total"`
	Unread   int       `json:"unread"`
}

type SQLiteStorage struct {
	db *sql.DB
}

func NewSQLiteStorage(dbPath string) (*SQLiteStorage, error) {
	db, err := sql.Open("sqlite", dbPath+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &SQLiteStorage{db: db}
	if err := s.init(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *SQLiteStorage) init() error {
	_, err := s.db.Exec(`
	CREATE TABLE IF NOT EXISTS messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		message_id TEXT NOT NULL DEFAULT '',
		from_name TEXT NOT NULL DEFAULT '',
		from_addr TEXT NOT NULL DEFAULT '',
		to_json TEXT NOT NULL DEFAULT '[]',
		cc_json TEXT NOT NULL DEFAULT '[]',
		bcc_json TEXT NOT NULL DEFAULT '[]',
		reply_to_json TEXT NOT NULL DEFAULT '[]',
		subject TEXT NOT NULL DEFAULT '',
		snippet TEXT NOT NULL DEFAULT '',
		date TEXT NOT NULL,
		received TEXT NOT NULL,
		size INTEGER NOT NULL DEFAULT 0,
		read INTEGER NOT NULL DEFAULT 0,
		attachment_count INTEGER NOT NULL DEFAULT 0,
		text_body TEXT NOT NULL DEFAULT '',
		html_body TEXT NOT NULL DEFAULT '',
		headers_json TEXT NOT NULL DEFAULT '[]',
		raw BLOB
	);
	CREATE INDEX IF NOT EXISTS idx_messages_received ON messages(received DESC);
	CREATE TABLE IF NOT EXISTS attachments (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		message_id INTEGER NOT NULL,
		part_id TEXT NOT NULL DEFAULT '',
		file_name TEXT NOT NULL DEFAULT '',
		content_type TEXT NOT NULL DEFAULT '',
		content_id TEXT NOT NULL DEFAULT '',
		inline INTEGER NOT NULL DEFAULT 0,
		size INTEGER NOT NULL DEFAULT 0,
		data BLOB
	);
	CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);
	`)
	if err != nil {
		return err
	}
	return s.migrate()
}

// migrate adds columns introduced after the first release to existing databases.
func (s *SQLiteStorage) migrate() error {
	rows, err := s.db.Query("SELECT name FROM pragma_table_info('messages')")
	if err != nil {
		return err
	}
	cols := map[string]bool{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			rows.Close()
			return err
		}
		cols[name] = true
	}
	rows.Close()
	if !cols["tags"] {
		// Stored as ",a,b," so a tag can be matched exactly with LIKE '%,a,%'.
		if _, err := s.db.Exec("ALTER TABLE messages ADD COLUMN tags TEXT NOT NULL DEFAULT ''"); err != nil {
			return fmt.Errorf("adding tags column: %w", err)
		}
	}
	return nil
}

func encodeTags(tags []string) string {
	if len(tags) == 0 {
		return ""
	}
	return "," + strings.Join(tags, ",") + ","
}

func decodeTags(s string) []string {
	out := []string{}
	for _, t := range strings.Split(strings.Trim(s, ","), ",") {
		if t != "" {
			out = append(out, t)
		}
	}
	return out
}

func toJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func fromJSON[T any](s string) T {
	var v T
	_ = json.Unmarshal([]byte(s), &v)
	return v
}

func (s *SQLiteStorage) Save(m *Message) (*Summary, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	res, err := tx.Exec(`
	INSERT INTO messages (message_id, from_name, from_addr, to_json, cc_json, bcc_json, reply_to_json,
		subject, snippet, date, received, size, attachment_count, text_body, html_body, headers_json, raw, tags)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		m.MessageID, m.From.Name, m.From.Address, toJSON(nonNil(m.To)), toJSON(nonNil(m.Cc)), toJSON(nonNil(m.Bcc)),
		toJSON(nonNil(m.ReplyTo)), m.Subject, m.Snippet, formatTime(m.Date),
		formatTime(m.Received), m.Size, len(m.AttachmentParts), m.Text, m.HTML,
		toJSON(m.Headers), m.Raw, encodeTags(m.Tags))
	if err != nil {
		return nil, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	for _, a := range m.AttachmentParts {
		if _, err := tx.Exec(`
		INSERT INTO attachments (message_id, part_id, file_name, content_type, content_id, inline, size, data)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			id, a.PartID, a.FileName, a.ContentType, a.ContentID, a.Inline, a.Size, a.Data); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	m.ID = id
	sum := m.Summary
	sum.Attachments = len(m.AttachmentParts)
	if sum.Tags == nil {
		sum.Tags = []string{}
	}
	return &sum, nil
}

func nonNil(a []Address) []Address {
	if a == nil {
		return []Address{}
	}
	return a
}

const summaryCols = `id, message_id, from_name, from_addr, to_json, cc_json, bcc_json, reply_to_json,
	subject, snippet, date, received, size, read, attachment_count, tags`

type scanner interface{ Scan(dest ...any) error }

func scanSummary(row scanner, extra ...any) (*Summary, error) {
	var sm Summary
	var to, cc, bcc, replyTo, date, received, tags string
	dest := append([]any{&sm.ID, &sm.MessageID, &sm.From.Name, &sm.From.Address, &to, &cc, &bcc, &replyTo,
		&sm.Subject, &sm.Snippet, &date, &received, &sm.Size, &sm.Read, &sm.Attachments, &tags}, extra...)
	if err := row.Scan(dest...); err != nil {
		return nil, err
	}
	sm.To = fromJSON[[]Address](to)
	sm.Cc = fromJSON[[]Address](cc)
	sm.Bcc = fromJSON[[]Address](bcc)
	sm.ReplyTo = fromJSON[[]Address](replyTo)
	sm.Date, _ = time.Parse(time.RFC3339Nano, date)
	sm.Received, _ = time.Parse(time.RFC3339Nano, received)
	sm.Tags = decodeTags(tags)
	return &sm, nil
}

// buildWhere turns a search string into SQL. Plain words match sender, recipients,
// subject and body; the filters is:read, is:unread, has:attachment, from:, to:,
// subject: and tag: narrow further. All terms must match.
func buildWhere(search string, since time.Time) (string, []any) {
	var conds []string
	var args []any
	if !since.IsZero() {
		conds = append(conds, "julianday(received) > julianday(?)")
		args = append(args, formatTime(since))
	}
	like := func(s string) string { return "%" + strings.ReplaceAll(strings.ToLower(s), "%", `\%`) + "%" }

	for _, term := range splitTerms(search) {
		lower := strings.ToLower(term)
		switch {
		case lower == "is:unread":
			conds = append(conds, "read = 0")
		case lower == "is:read":
			conds = append(conds, "read = 1")
		case lower == "has:attachment" || lower == "has:attachments":
			conds = append(conds, "attachment_count > 0")
		case strings.HasPrefix(lower, "from:") && len(term) > 5:
			conds = append(conds, `(lower(from_name) LIKE ? ESCAPE '\' OR lower(from_addr) LIKE ? ESCAPE '\')`)
			args = append(args, like(term[5:]), like(term[5:]))
		case strings.HasPrefix(lower, "to:") && len(term) > 3:
			conds = append(conds, `(lower(to_json) LIKE ? ESCAPE '\' OR lower(cc_json) LIKE ? ESCAPE '\' OR lower(bcc_json) LIKE ? ESCAPE '\')`)
			args = append(args, like(term[3:]), like(term[3:]), like(term[3:]))
		case strings.HasPrefix(lower, "tag:") && len(term) > 4:
			conds = append(conds, `lower(tags) LIKE ? ESCAPE '\'`)
			args = append(args, like(","+term[4:]+","))
		case strings.HasPrefix(lower, "subject:") && len(term) > 8:
			conds = append(conds, `lower(subject) LIKE ? ESCAPE '\'`)
			args = append(args, like(term[8:]))
		default:
			conds = append(conds, `(lower(subject) LIKE ? ESCAPE '\' OR lower(from_name) LIKE ? ESCAPE '\' OR lower(from_addr) LIKE ? ESCAPE '\'
				OR lower(to_json) LIKE ? ESCAPE '\' OR lower(cc_json) LIKE ? ESCAPE '\' OR lower(text_body) LIKE ? ESCAPE '\')`)
			l := like(term)
			args = append(args, l, l, l, l, l, l)
		}
	}
	if len(conds) == 0 {
		return "", nil
	}
	return " WHERE " + strings.Join(conds, " AND "), args
}

// splitTerms splits a search on whitespace, keeping double-quoted phrases together:
// subject:"reset password" is one term, `subject:reset password`.
func splitTerms(s string) []string {
	var terms []string
	var cur strings.Builder
	quoted := false
	for _, r := range s {
		switch {
		case r == '"':
			quoted = !quoted
		case !quoted && (r == ' ' || r == '\t' || r == '\n'):
			if cur.Len() > 0 {
				terms = append(terms, cur.String())
				cur.Reset()
			}
		default:
			cur.WriteRune(r)
		}
	}
	if cur.Len() > 0 {
		terms = append(terms, cur.String())
	}
	return terms
}

func (s *SQLiteStorage) List(q Query) (*Page, error) {
	where, args := buildWhere(q.Search, q.Since)
	page := &Page{Messages: []Summary{}}

	if err := s.db.QueryRow("SELECT COUNT(*) FROM messages"+where, args...).Scan(&page.Total); err != nil {
		return nil, err
	}
	if err := s.db.QueryRow("SELECT COUNT(*) FROM messages WHERE read = 0").Scan(&page.Unread); err != nil {
		return nil, err
	}

	rows, err := s.db.Query("SELECT "+summaryCols+" FROM messages"+where+" ORDER BY received DESC, id DESC LIMIT ? OFFSET ?",
		append(args, q.Limit, q.Offset)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		sm, err := scanSummary(rows)
		if err != nil {
			return nil, err
		}
		page.Messages = append(page.Messages, *sm)
	}
	return page, rows.Err()
}

func (s *SQLiteStorage) Get(id int64) (*Message, error) {
	var m Message
	var headers string
	row := s.db.QueryRow("SELECT "+summaryCols+", text_body, html_body, headers_json, raw FROM messages WHERE id = ?", id)
	sm, err := scanSummary(row, &m.Text, &m.HTML, &headers, &m.Raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	m.Summary = *sm
	m.Headers = fromJSON[[]Header](headers)

	rows, err := s.db.Query(`SELECT id, part_id, file_name, content_type, content_id, inline, size
		FROM attachments WHERE message_id = ? ORDER BY id`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	m.AttachmentParts = []Attachment{}
	for rows.Next() {
		var a Attachment
		if err := rows.Scan(&a.ID, &a.PartID, &a.FileName, &a.ContentType, &a.ContentID, &a.Inline, &a.Size); err != nil {
			return nil, err
		}
		m.AttachmentParts = append(m.AttachmentParts, a)
	}
	return &m, rows.Err()
}

func (s *SQLiteStorage) GetAttachment(messageID, attachmentID int64) (*Attachment, error) {
	var a Attachment
	err := s.db.QueryRow(`SELECT id, part_id, file_name, content_type, content_id, inline, size, data
		FROM attachments WHERE message_id = ? AND id = ?`, messageID, attachmentID).
		Scan(&a.ID, &a.PartID, &a.FileName, &a.ContentType, &a.ContentID, &a.Inline, &a.Size, &a.Data)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &a, err
}

func placeholders(n int) string {
	return strings.TrimSuffix(strings.Repeat("?,", n), ",")
}

func idArgs(ids []int64) []any {
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	return args
}

// SetRead marks the given messages read or unread; no ids means every message.
func (s *SQLiteStorage) SetRead(ids []int64, read bool) error {
	if len(ids) == 0 {
		_, err := s.db.Exec("UPDATE messages SET read = ?", read)
		return err
	}
	_, err := s.db.Exec("UPDATE messages SET read = ? WHERE id IN ("+placeholders(len(ids))+")",
		append([]any{read}, idArgs(ids)...)...)
	return err
}

// Delete removes the given messages; no ids means every message.
func (s *SQLiteStorage) Delete(ids []int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if len(ids) == 0 {
		if _, err := tx.Exec("DELETE FROM attachments"); err != nil {
			return err
		}
		if _, err := tx.Exec("DELETE FROM messages"); err != nil {
			return err
		}
	} else {
		in := "(" + placeholders(len(ids)) + ")"
		if _, err := tx.Exec("DELETE FROM attachments WHERE message_id IN "+in, idArgs(ids)...); err != nil {
			return err
		}
		if _, err := tx.Exec("DELETE FROM messages WHERE id IN "+in, idArgs(ids)...); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// Prune deletes everything but the newest keep messages (keep <= 0 means no limit)
// and everything received before olderThan (zero means no limit). It returns the
// deleted ids.
func (s *SQLiteStorage) Prune(keep int, olderThan time.Time) ([]int64, error) {
	var conds []string
	var args []any
	if keep > 0 {
		conds = append(conds, "id IN (SELECT id FROM messages ORDER BY id DESC LIMIT -1 OFFSET ?)")
		args = append(args, keep)
	}
	if !olderThan.IsZero() {
		conds = append(conds, "julianday(received) < julianday(?)")
		args = append(args, formatTime(olderThan))
	}
	if len(conds) == 0 {
		return nil, nil
	}
	rows, err := s.db.Query("SELECT id FROM messages WHERE "+strings.Join(conds, " OR "), args...)
	if err != nil {
		return nil, err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil || len(ids) == 0 {
		return nil, err
	}
	return ids, s.Delete(ids)
}

// Tags lists every tag in use, most used first.
func (s *SQLiteStorage) Tags() ([]TagCount, error) {
	rows, err := s.db.Query("SELECT tags FROM messages WHERE tags != ''")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	counts := map[string]int{}
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			return nil, err
		}
		for _, tag := range decodeTags(t) {
			counts[tag]++
		}
	}
	out := []TagCount{}
	for name, n := range counts {
		out = append(out, TagCount{Name: name, Count: n})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Name < out[j].Name
	})
	return out, rows.Err()
}

func (s *SQLiteStorage) Close() error {
	return s.db.Close()
}
