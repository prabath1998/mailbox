package smtp

import (
	"errors"
	"io"
	"log"
	"net"
	"time"

	"github.com/prabath1998/mailbox/events"
	"github.com/prabath1998/mailbox/mailparse"
	"github.com/prabath1998/mailbox/storage"

	"github.com/emersion/go-sasl"
	gosmtp "github.com/emersion/go-smtp"
)

const maxMessageBytes = 25 << 20

type SMTPServer struct {
	Storage *storage.SQLiteStorage
	Events  *events.Hub
	srv     *gosmtp.Server
}

func NewSMTPServer(store *storage.SQLiteStorage, hub *events.Hub) *SMTPServer {
	s := &SMTPServer{Storage: store, Events: hub}
	srv := gosmtp.NewServer(gosmtp.BackendFunc(func(*gosmtp.Conn) (gosmtp.Session, error) {
		return &session{srv: s}, nil
	}))
	s.srv = srv
	srv.Domain = "localhost"
	srv.MaxMessageBytes = maxMessageBytes
	srv.MaxRecipients = 500
	srv.ReadTimeout = 2 * time.Minute
	srv.WriteTimeout = 2 * time.Minute
	// This is a dev sandbox: accept any credentials over plain text.
	srv.AllowInsecureAuth = true

	return s
}

// Serve accepts SMTP connections on l until Close is called.
func (s *SMTPServer) Serve(l net.Listener) error {
	return s.srv.Serve(l)
}

// Close stops accepting mail and closes open connections.
func (s *SMTPServer) Close() error {
	return s.srv.Close()
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
