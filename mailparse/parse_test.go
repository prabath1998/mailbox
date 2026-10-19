package mailparse

import (
	"reflect"
	"strings"
	"testing"

	"github.com/prabath1998/mailbox/storage"
)

func crlf(s string) []byte { return []byte(strings.ReplaceAll(s, "\n", "\r\n")) }

func TestParsePlainText(t *testing.T) {
	m, err := Parse(crlf(`From: "Ana Silva" <ana@example.com>
To: dev@example.com
Subject: Hello
Message-ID: <abc@example.com>
Date: Mon, 19 Oct 2026 09:00:00 +0000

Hi there,
this is the body.
`), "bounce@example.com", []string{"dev@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if m.From != (storage.Address{Name: "Ana Silva", Address: "ana@example.com"}) {
		t.Errorf("from = %+v", m.From)
	}
	if m.Subject != "Hello" || m.MessageID != "abc@example.com" {
		t.Errorf("subject %q, message id %q", m.Subject, m.MessageID)
	}
	if m.Snippet != "Hi there, this is the body." {
		t.Errorf("snippet = %q", m.Snippet)
	}
	if m.Date.Year() != 2026 {
		t.Errorf("date = %v", m.Date)
	}
	if len(m.Bcc) != 0 {
		t.Errorf("bcc = %v", m.Bcc)
	}
}

func TestParseEncodedHeadersAndCharset(t *testing.T) {
	m, err := Parse(crlf(`From: =?UTF-8?B?Sm9zw6k=?= <jose@example.com>
To: dev@example.com
Subject: =?ISO-8859-1?Q?Caf=E9_ouvert?=
Content-Type: text/plain; charset=ISO-8859-1
Content-Transfer-Encoding: quoted-printable

Cr=E8me br=FBl=E9e
`), "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if m.From.Name != "José" || m.Subject != "Café ouvert" {
		t.Errorf("from %q, subject %q", m.From.Name, m.Subject)
	}
	if !strings.Contains(m.Text, "Crème brûlée") {
		t.Errorf("text = %q", m.Text)
	}
}

func TestParseHTMLWithAttachments(t *testing.T) {
	m, err := Parse(crlf(`From: app@example.com
To: dev@example.com
Subject: Report
Content-Type: multipart/mixed; boundary="outer"

--outer
Content-Type: multipart/related; boundary="rel"

--rel
Content-Type: text/html; charset=utf-8

<p>Logo: <img src="cid:logo@x"></p>
--rel
Content-Type: image/png
Content-ID: <logo@x>
Content-Transfer-Encoding: base64

iVBORw0KGgo=
--rel--
--outer
Content-Type: application/pdf; name="report.pdf"
Content-Disposition: attachment; filename="report.pdf"
Content-Transfer-Encoding: base64

JVBERi0xLjQ=
--outer--
`), "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(m.HTML, `cid:logo@x`) {
		t.Errorf("html = %q", m.HTML)
	}
	var names []string
	var inline []bool
	for _, a := range m.AttachmentParts {
		names = append(names, a.ContentType)
		inline = append(inline, a.Inline)
	}
	if len(m.AttachmentParts) != 2 {
		t.Fatalf("attachments = %v", names)
	}
	for _, a := range m.AttachmentParts {
		switch a.ContentType {
		case "application/pdf":
			if a.FileName != "report.pdf" || a.Inline || string(a.Data) != "%PDF-1.4" {
				t.Errorf("pdf attachment = %+v", a)
			}
		case "image/png":
			if a.ContentID != "logo@x" || !a.Inline {
				t.Errorf("inline image = %+v", a)
			}
		default:
			t.Errorf("unexpected attachment %q", a.ContentType)
		}
	}
	if m.Snippet != "Logo:" {
		t.Errorf("snippet = %q", m.Snippet)
	}
}

func TestBccFromEnvelope(t *testing.T) {
	m, err := Parse(crlf("From: a@x\nTo: b@x\nCc: c@x\nSubject: s\n\nbody\n"), "a@x", []string{"b@x", "<C@x>", "hidden@x"})
	if err != nil {
		t.Fatal(err)
	}
	if len(m.Bcc) != 1 || m.Bcc[0].Address != "hidden@x" {
		t.Errorf("bcc = %v", m.Bcc)
	}
}

func TestTags(t *testing.T) {
	got := Tags(" Billing , EU Region,billing,", []storage.Address{{Address: "dev+signup@x.com"}, {Address: "plain@x.com"}, {Address: "dev+Billing@x.com"}})
	want := []string{"billing", "eu-region", "signup"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Tags = %v, want %v", got, want)
	}
	m, err := Parse(crlf("From: a@x\nTo: app+welcome@x\nX-Tags: onboarding\nSubject: s\n\nbody\n"), "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(m.Tags, []string{"onboarding", "welcome"}) {
		t.Errorf("parsed tags = %v", m.Tags)
	}
}
