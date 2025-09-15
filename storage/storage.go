package storage

import (
	"database/sql"	
	"time"
	_ "modernc.org/sqlite"
)

// Email represents a captured email message
type Email struct {
	ID        string    `json:"id"`
	MessageID string    `json:"message_id"` // The 'Message-ID' header
	From      string    `json:"from"`
	To        string    `json:"to"`
	Subject   string    `json:"subject"`
	Date      time.Time `json:"date"`
	TextBody  string    `json:"text_body"`
	HTMLBody  string    `json:"html_body"`
}

// Storage interface defines the methods our storage layer must implement.
type Storage interface {
	Init() error
	SaveEmail(email *Email) error
	GetEmails(limit, offset int) ([]Email, error)
	GetEmailByID(id string) (*Email, error)
	Close() error
}

// SQLiteStorage implements the Storage interface
type SQLiteStorage struct {
	db *sql.DB
}

// NewSQLiteStorage creates a new SQLite storage connection
func NewSQLiteStorage(dbPath string) (*SQLiteStorage, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, err
	}
	s := &SQLiteStorage{db: db}
	if err := s.Init(); err != nil {
		return nil, err
	}
	return s, nil
}

// Init creates the necessary tables
func (s *SQLiteStorage) Init() error {
	query := `
	CREATE TABLE IF NOT EXISTS emails (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		message_id TEXT,
		sender TEXT,
		recipient TEXT,
		subject TEXT,
		date DATETIME,
		text_body TEXT,
		html_body TEXT
	);
	`
	_, err := s.db.Exec(query)
	return err
}

// SaveEmail inserts a new email into the database
func (s *SQLiteStorage) SaveEmail(email *Email) error {
	// Convert time to RFC3339 format for consistent storage
	dateStr := email.Date.Format(time.RFC3339)
	
	query := `
	INSERT INTO emails (message_id, sender, recipient, subject, date, text_body, html_body)
	VALUES (?, ?, ?, ?, ?, ?, ?)
	`
	_, err := s.db.Exec(query, email.MessageID, email.From, email.To, email.Subject, dateStr, email.TextBody, email.HTMLBody)
	return err
}

// GetEmails retrieves a list of emails, most recent first
func (s *SQLiteStorage) GetEmails(limit, offset int) ([]Email, error) {
	query := `
	SELECT id, message_id, sender, recipient, subject, date, text_body, html_body
	FROM emails
	ORDER BY date DESC
	LIMIT ? OFFSET ?
	`
	rows, err := s.db.Query(query, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var emails []Email
	for rows.Next() {
		var e Email
		var dateStr string // Scan the date as a string first
		
		err := rows.Scan(&e.ID, &e.MessageID, &e.From, &e.To, &e.Subject, &dateStr, &e.TextBody, &e.HTMLBody)
		if err != nil {
			return nil, err
		}
		
		// Parse the date string back into time.Time
		e.Date, err = time.Parse(time.RFC3339, dateStr)
		if err != nil {
			// If parsing fails, use the current time as fallback
			e.Date = time.Now()
		}
		
		emails = append(emails, e)
	}
	return emails, nil
}

// GetEmailByID retrieves a specific email by its database ID
func (s *SQLiteStorage) GetEmailByID(id string) (*Email, error) {
	query := `
	SELECT id, message_id, sender, recipient, subject, date, text_body, html_body
	FROM emails
	WHERE id = ?
	`
	row := s.db.QueryRow(query, id)
	
	var e Email
	var dateStr string
	
	err := row.Scan(&e.ID, &e.MessageID, &e.From, &e.To, &e.Subject, &dateStr, &e.TextBody, &e.HTMLBody)
	if err != nil {
		return nil, err
	}
	
	// Parse the date string back into time.Time
	e.Date, err = time.Parse(time.RFC3339, dateStr)
	if err != nil {
		e.Date = time.Now()
	}
	
	return &e, nil
}

func (s *SQLiteStorage) Close() error {
	return s.db.Close()
}