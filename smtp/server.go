package smtp

import (
	"crypto/subtle"
	"errors"
	"io"
	"log"
	"net"
	"time"

	"github.com/prabath1998/mailbox/inbox"

	"github.com/emersion/go-sasl"
	gosmtp "github.com/emersion/go-smtp"
)

const maxMessageBytes = 25 << 20

type SMTPServer struct {
	Inbox *inbox.Inbox
	// Credentials, when not empty, are the only username/password pairs accepted,
	// and sending requires logging in. When empty, any login (or none) is accepted.
	Credentials map[string]string
	srv         *gosmtp.Server
}

func NewSMTPServer(in *inbox.Inbox, credentials map[string]string) *SMTPServer {
	s := &SMTPServer{Inbox: in, Credentials: credentials}
	srv := gosmtp.NewServer(gosmtp.BackendFunc(func(*gosmtp.Conn) (gosmtp.Session, error) {
		return &session{srv: s}, nil
	}))
	s.srv = srv
	srv.Domain = "localhost"
	srv.MaxMessageBytes = maxMessageBytes
	srv.MaxRecipients = 500
	srv.ReadTimeout = 2 * time.Minute
	srv.WriteTimeout = 2 * time.Minute
	// This is a dev sandbox without TLS, so allow logging in over plain text.
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

func (s *SMTPServer) checkLogin(username, password string) error {
	if len(s.Credentials) == 0 {
		return nil
	}
	want, ok := s.Credentials[username]
	if !ok || subtle.ConstantTimeCompare([]byte(want), []byte(password)) != 1 {
		return &gosmtp.SMTPError{Code: 535, EnhancedCode: gosmtp.EnhancedCode{5, 7, 8}, Message: "Invalid username or password"}
	}
	return nil
}

var errAuthRequired = &gosmtp.SMTPError{Code: 530, EnhancedCode: gosmtp.EnhancedCode{5, 7, 0}, Message: "Authentication required"}

type session struct {
	srv    *SMTPServer
	authed bool
	from   string
	to     []string
}

func (s *session) AuthMechanisms() []string {
	return []string{sasl.Plain, sasl.Login}
}

func (s *session) Auth(mech string) (sasl.Server, error) {
	login := func(username, password string) error {
		if err := s.srv.checkLogin(username, password); err != nil {
			return err
		}
		s.authed = true
		return nil
	}
	switch mech {
	case sasl.Plain:
		return sasl.NewPlainServer(func(_, username, password string) error { return login(username, password) }), nil
	case sasl.Login:
		return sasl.NewLoginServer(login), nil
	}
	return nil, gosmtp.ErrAuthUnsupported
}

func (s *session) Mail(from string, _ *gosmtp.MailOptions) error {
	if len(s.srv.Credentials) > 0 && !s.authed {
		return errAuthRequired
	}
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
	if _, err := s.srv.Inbox.Deliver(raw, s.from, s.to); err != nil {
		log.Printf("Rejected message from %s: %v", s.from, err)
		if errors.Is(err, inbox.ErrParse) {
			return &gosmtp.SMTPError{Code: 554, EnhancedCode: gosmtp.EnhancedCode{5, 6, 0}, Message: "Could not parse message"}
		}
		return errors.New("could not store message")
	}
	return nil
}

func (s *session) Reset() {
	s.from = ""
	s.to = nil
}

func (s *session) Logout() error {
	return nil
}
