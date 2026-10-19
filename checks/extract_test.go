package checks

import (
	"reflect"
	"testing"

	"github.com/prabath1998/mailbox/storage"
)

func TestExtractLinks(t *testing.T) {
	m := &storage.Message{
		HTML: `<a href="https://app.test/confirm?t=1&amp;u=2"><b>Confirm</b> email</a> <a href="mailto:x@y">mail</a>
			<a href='https://app.test/confirm?t=1&u=2'>dup</a>`,
		Text: "Or open https://app.test/plain. Thanks",
	}
	got := Extract(m).Links
	want := []ExtractedLink{{URL: "https://app.test/confirm?t=1&u=2", Text: "Confirm email"}, {URL: "https://app.test/plain"}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("links = %+v, want %+v", got, want)
	}
}

func TestExtractCodes(t *testing.T) {
	cases := []struct {
		name, text string
		want       []string
	}{
		{"numeric after keyword", "Your verification code is 482913. It expires in 10 minutes.", []string{"482913"}},
		{"alphanumeric", "Use code AB12CD to sign in", []string{"AB12CD"}},
		{"keyword match ranks first", "Order 55512 shipped. Your OTP: 9921", []string{"9921", "55512"}},
		{"years skipped without keyword", "© 2026 Acme. Ticket 77881", []string{"77881"}},
		{"digits in urls ignored", "Visit https://x.test/reset/123456 now", []string{}},
		{"plain words ignored", "HELLO WORLD from ACME", []string{}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := Extract(&storage.Message{Text: c.text}).Codes
			if !reflect.DeepEqual(got, c.want) {
				t.Errorf("codes = %v, want %v", got, c.want)
			}
		})
	}
}

func TestExtractCodesFromHTML(t *testing.T) {
	got := Extract(&storage.Message{HTML: "<style>.a{}</style><p>Your code:</p><h1>123456</h1>"}).Codes
	if !reflect.DeepEqual(got, []string{"123456"}) {
		t.Errorf("codes = %v", got)
	}
}
