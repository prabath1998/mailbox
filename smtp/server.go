package smtp

import (
	"errors"
	"io"
	"log"
	"time"

	"mailbox/events"
	"mailbox/mailparse"
	"mailbox/storage"

	"github.com/emersion/go-sasl"
	gosmtp "github.com/emersion/go-smtp"
)

const maxMessageBytes = 25 << 20

type SMTPServer struct {
	Addr    string
	Storage *storage.SQLiteStorage
	Events  *events.Hub
}

func (s *SMTPServer) Start() error {
	srv := gosmtp.NewServer(gosmtp.BackendFunc(func(*gosmtp.Conn) (gosmtp.Session, error) {
		return &session{srv: s}, nil
	}))
	srv.Addr = s.Addr
	srv.Domain = "localhost"
	srv.MaxMessageBytes = maxMessageBytes
	srv.MaxRecipients = 500
	srv.ReadTimeout = 2 * time.Minute
	srv.WriteTimeout = 2 * time.Minute
	// This is a dev sandbox: accept any credentials over plain text.
	srv.AllowInsecureAuth = true

	log.Printf("SMTP server listening on %s", s.Addr)
	return srv.ListenAndServe()
}

type session struct {
	srv  *SMTPServer
	from string
	to   []string
}

// Accept any username and password so apps configured with SMTP auth still work.
func (s *session) AuthMechanisms() []string {
	return []string{sasl.Plain, sasl.Login}
}

func (s *session) Auth(mech string) (sasl.Server, error) {
	switch mech {
	case sasl.Plain:
		return sasl.NewPlainServer(func(_, _, _ string) error { return nil }), nil
	case sasl.Login:
		return sasl.NewLoginServer(func(_, _ string) error { return nil }), nil
	}
	return nil, gosmtp.ErrAuthUnsupported
}

func (s *session) Mail(from string, _ *gosmtp.MailOptions) error {
	s.from = from
	return nil
}

func (s *session) Rcpt(to string, _ *gosmtp.RcptOptions) error {
	s.to = append(s.to, to)
	return nil
}

func (s *session) Data(r io.Reader) error {
	raw, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	msg, err := mailparse.Parse(raw, s.from, s.to)
	if err != nil {
		log.Printf("Error parsing message: %v", err)
		return &gosmtp.SMTPError{Code: 554, EnhancedCode: gosmtp.EnhancedCode{5, 6, 0}, Message: "Could not parse message"}
	}
	sum, err := s.srv.Storage.Save(msg)
	if err != nil {
		log.Printf("Error saving message: %v", err)
		return errors.New("could not store message")
	}
	log.Printf("Received message %d from %s: %q", sum.ID, sum.From.Address, sum.Subject)
	s.srv.Events.Publish(events.Event{Type: "new", IDs: []int64{sum.ID}, Payload: sum})
	return nil
}

func (s *session) Reset() {
	s.from = ""
	s.to = nil
}

func (s *session) Logout() error {
	return nil
}
