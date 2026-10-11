// Package mailparse turns a raw RFC 5322 message into a storage.Message.
package mailparse

import (
	"bufio"
	"bytes"
	"html"
	"mime"
	"net/mail"
	"net/textproto"
	"regexp"
	"strings"
	"time"

	"mailbox/storage"

	"github.com/jhillyerd/enmime"
)

var wordDecoder = &mime.WordDecoder{CharsetReader: charsetReader}

// Parse builds a message from raw bytes. envelopeFrom and envelopeTo come from the
// SMTP session and fill in anything the headers leave out (recipients that are in
// the envelope but not in To/Cc are reported as Bcc).
func Parse(raw []byte, envelopeFrom string, envelopeTo []string) (*storage.Message, error) {
	env, err := enmime.ReadEnvelope(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}

	m := &storage.Message{Raw: raw}
	m.Received = time.Now()
	m.Size = len(raw)
	m.Subject = strings.TrimSpace(env.GetHeader("Subject"))
	m.MessageID = strings.Trim(env.GetHeader("Message-ID"), "<> ")
	m.Text = env.Text
	m.HTML = env.HTML

	if d, err := env.Date(); err == nil {
		m.Date = d
	} else {
		m.Date = m.Received
	}

	if from := addressList(env, "From"); len(from) > 0 {
		m.From = from[0]
	} else {
		m.From = storage.Address{Address: envelopeFrom}
	}
	m.To = addressList(env, "To")
	m.Cc = addressList(env, "Cc")
	m.ReplyTo = addressList(env, "Reply-To")
	m.Bcc = bccFromEnvelope(envelopeTo, m.To, m.Cc)
	if len(m.To) == 0 && len(m.Cc) == 0 && len(m.Bcc) > 0 {
		m.To, m.Bcc = m.Bcc, nil
	}

	m.Headers = orderedHeaders(raw)
	m.AttachmentParts = attachments(env)
	m.Snippet = snippet(m.Text, m.HTML)
	return m, nil
}

func addressList(env *enmime.Envelope, key string) []storage.Address {
	list, err := env.AddressList(key)
	if err != nil {
		// Fall back to a raw value so a malformed header still shows something.
		if v := strings.TrimSpace(env.GetHeader(key)); v != "" {
			return []storage.Address{{Address: v}}
		}
		return nil
	}
	out := make([]storage.Address, 0, len(list))
	for _, a := range list {
		out = append(out, storage.Address{Name: a.Name, Address: a.Address})
	}
	return out
}

func bccFromEnvelope(envelopeTo []string, to, cc []storage.Address) []storage.Address {
	seen := map[string]bool{}
	for _, a := range append(append([]storage.Address{}, to...), cc...) {
		seen[strings.ToLower(a.Address)] = true
	}
	var bcc []storage.Address
	for _, rcpt := range envelopeTo {
		if addr, err := mail.ParseAddress(rcpt); err == nil {
			rcpt = addr.Address
		}
		if !seen[strings.ToLower(rcpt)] {
			seen[strings.ToLower(rcpt)] = true
			bcc = append(bcc, storage.Address{Address: rcpt})
		}
	}
	return bcc
}

// orderedHeaders reads the top-level header block in its original order, which
// enmime's map loses, and decodes RFC 2047 encoded words for display.
func orderedHeaders(raw []byte) []storage.Header {
	r := textproto.NewReader(bufio.NewReader(bytes.NewReader(raw)))
	var headers []storage.Header
	for {
		line, err := r.ReadContinuedLine()
		if err != nil || line == "" {
			break
		}
		name, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		value = strings.TrimSpace(value)
		if decoded, err := wordDecoder.DecodeHeader(value); err == nil {
			value = decoded
		}
		headers = append(headers, storage.Header{Name: strings.TrimSpace(name), Value: value})
	}
	return headers
}

func attachments(env *enmime.Envelope) []storage.Attachment {
	var out []storage.Attachment
	add := func(p *enmime.Part, inline bool) {
		out = append(out, storage.Attachment{
			PartID:      p.PartID,
			FileName:    p.FileName,
			ContentType: p.ContentType,
			ContentID:   strings.Trim(p.ContentID, "<>"),
			Inline:      inline,
			Size:        len(p.Content),
			Data:        p.Content,
		})
	}
	for _, p := range env.Attachments {
		add(p, false)
	}
	for _, p := range env.Inlines {
		add(p, true)
	}
	// Images inside multipart/related often have a Content-ID but no disposition.
	for _, p := range env.OtherParts {
		if strings.HasPrefix(p.ContentType, "multipart/") {
			continue
		}
		add(p, p.ContentID != "")
	}
	return out
}

var (
	styleRe = regexp.MustCompile(`(?is)<(style|script|head)[^>]*>.*?</(style|script|head)>`)
	tagRe   = regexp.MustCompile(`(?s)<[^>]*>`)
)

// StripHTML returns the visible text of an HTML document, roughly.
func StripHTML(s string) string {
	s = styleRe.ReplaceAllString(s, " ")
	s = tagRe.ReplaceAllString(s, " ")
	return html.UnescapeString(s)
}

func snippet(text, htmlBody string) string {
	src := text
	if strings.TrimSpace(src) == "" {
		src = StripHTML(htmlBody)
	}
	s := strings.Join(strings.Fields(src), " ")
	if r := []rune(s); len(r) > 200 {
		s = string(r[:200])
	}
	return s
}
