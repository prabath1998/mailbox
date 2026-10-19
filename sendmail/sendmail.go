// Package sendmail is a sendmail-compatible command that hands a message on stdin
// to a running MailBox over SMTP. Point PHP's sendmail_path (or anything else that
// shells out to sendmail) at `mailbox sendmail` to catch mail sent that way.
package sendmail

import (
	"bytes"
	"fmt"
	"io"
	"net/mail"
	"os"
	"os/user"
	"strings"

	"github.com/emersion/go-sasl"
	gosmtp "github.com/emersion/go-smtp"
)

// Options are the parts of the sendmail command line MailBox cares about.
type Options struct {
	Server     string   // -S host:port, default localhost:1025
	From       string   // -f / -r envelope sender
	Recipients []string // positional arguments
	FromHeader bool     // -t: read recipients from To, Cc and Bcc
}

// ParseArgs reads sendmail-style arguments. Flags that only matter to a real MTA
// (-i, -oi, -odi, -bm, -F name, ...) are accepted and ignored.
func ParseArgs(args []string) (Options, error) {
	o := Options{Server: "localhost:1025"}
	if v := os.Getenv("MAILBOX_SENDMAIL_SMTP"); v != "" {
		o.Server = v
	}
	value := func(i *int, a, flag string) (string, error) {
		if len(a) > len(flag) {
			return a[len(flag):], nil
		}
		if *i+1 >= len(args) {
			return "", fmt.Errorf("%s needs a value", flag)
		}
		*i++
		return args[*i], nil
	}
	for i := 0; i < len(args); i++ {
		a := args[i]
		var err error
		switch {
		case a == "--":
			o.Recipients = append(o.Recipients, args[i+1:]...)
			i = len(args)
		case a == "-t":
			o.FromHeader = true
		case strings.HasPrefix(a, "-f"):
			o.From, err = value(&i, a, "-f")
		case strings.HasPrefix(a, "-r"):
			o.From, err = value(&i, a, "-r")
		case strings.HasPrefix(a, "-S"):
			o.Server, err = value(&i, a, "-S")
		case a == "-F" || a == "-B" || a == "-N" || a == "-R" || a == "-V" || a == "-X":
			i++ // flags that take a separate value we don't use
		case strings.HasPrefix(a, "-"):
			// -i, -oi, -odi, -bm, -v and friends.
		default:
			o.Recipients = append(o.Recipients, strings.Split(a, ",")...)
		}
		if err != nil {
			return o, err
		}
	}
	return o, nil
}

// Run sends the message read from stdin.
func Run(args []string, stdin io.Reader) error {
	o, err := ParseArgs(args)
	if err != nil {
		return err
	}
	raw, err := io.ReadAll(stdin)
	if err != nil {
		return fmt.Errorf("reading the message: %w", err)
	}
	from, to, err := envelope(o, raw)
	if err != nil {
		return err
	}

	var auth sasl.Client
	if creds := os.Getenv("MAILBOX_SMTP_AUTH"); creds != "" {
		username, password, _ := strings.Cut(strings.Split(creds, ",")[0], ":")
		auth = sasl.NewPlainClient("", username, password)
	}
	if err := send(o.Server, auth, from, to, raw); err != nil {
		return fmt.Errorf("couldn't hand the message to MailBox at %s (is `mailbox` running?): %w", o.Server, err)
	}
	return nil
}

// send delivers over plain SMTP. gosmtp.SendMail insists on STARTTLS, which
// MailBox doesn't offer.
func send(addr string, auth sasl.Client, from string, to []string, raw []byte) error {
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
	if err := c.SendMail(from, to, bytes.NewReader(raw)); err != nil {
		return err
	}
	return c.Quit()
}

// envelope works out the sender and recipients from the options and, where they
// leave gaps, from the message headers.
func envelope(o Options, raw []byte) (string, []string, error) {
	msg, err := mail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		return "", nil, fmt.Errorf("the message on stdin has no valid headers: %w", err)
	}

	to := o.Recipients
	if o.FromHeader || len(to) == 0 {
		for _, key := range []string{"To", "Cc", "Bcc"} {
			list, err := msg.Header.AddressList(key)
			if err != nil {
				continue
			}
			for _, a := range list {
				to = append(to, a.Address)
			}
		}
	}
	var clean []string
	for _, r := range to {
		if r = strings.TrimSpace(r); r != "" {
			clean = append(clean, r)
		}
	}
	if len(clean) == 0 {
		return "", nil, fmt.Errorf("no recipients: pass them as arguments or use -t with a To header")
	}

	from := o.From
	if from == "" {
		if list, err := msg.Header.AddressList("From"); err == nil && len(list) > 0 {
			from = list[0].Address
		}
	}
	if from == "" {
		from = defaultSender()
	}
	return from, clean, nil
}

func defaultSender() string {
	name := "mailbox"
	if u, err := user.Current(); err == nil && u.Username != "" {
		name = u.Username
	}
	host, err := os.Hostname()
	if err != nil || host == "" {
		host = "localhost"
	}
	return name + "@" + host
}
