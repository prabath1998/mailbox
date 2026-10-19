package sendmail

import (
	"reflect"
	"testing"
)

func TestParseArgs(t *testing.T) {
	t.Setenv("MAILBOX_SENDMAIL_SMTP", "")
	cases := []struct {
		args []string
		want Options
	}{
		{[]string{"-t", "-i"}, Options{Server: "localhost:1025", FromHeader: true}},
		{[]string{"-oi", "-f", "app@x", "a@x,b@x"}, Options{Server: "localhost:1025", From: "app@x", Recipients: []string{"a@x", "b@x"}}},
		{[]string{"-fapp@x", "-S127.0.0.1:2525", "-F", "App Name", "a@x"}, Options{Server: "127.0.0.1:2525", From: "app@x", Recipients: []string{"a@x"}}},
		{[]string{"-r", "bounce@x", "--", "-weird@x"}, Options{Server: "localhost:1025", From: "bounce@x", Recipients: []string{"-weird@x"}}},
	}
	for _, c := range cases {
		got, err := ParseArgs(c.args)
		if err != nil {
			t.Fatalf("%v: %v", c.args, err)
		}
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("ParseArgs(%v) = %+v, want %+v", c.args, got, c.want)
		}
	}
	if _, err := ParseArgs([]string{"-f"}); err == nil {
		t.Error("-f without a value should fail")
	}
}

func TestParseArgsEnvServer(t *testing.T) {
	t.Setenv("MAILBOX_SENDMAIL_SMTP", "mail.local:25")
	o, _ := ParseArgs(nil)
	if o.Server != "mail.local:25" {
		t.Errorf("server = %q", o.Server)
	}
}

func TestEnvelope(t *testing.T) {
	raw := []byte("From: App <app@x>\nTo: a@x, B <b@x>\nCc: c@x\nBcc: d@x\nSubject: hi\n\nbody\n")

	from, to, err := envelope(Options{FromHeader: true}, raw)
	if err != nil || from != "app@x" || !reflect.DeepEqual(to, []string{"a@x", "b@x", "c@x", "d@x"}) {
		t.Errorf("-t: from %q to %v err %v", from, to, err)
	}
	from, to, err = envelope(Options{From: "bounce@x", Recipients: []string{"only@x"}}, raw)
	if err != nil || from != "bounce@x" || !reflect.DeepEqual(to, []string{"only@x"}) {
		t.Errorf("explicit: from %q to %v err %v", from, to, err)
	}
	if _, _, err := envelope(Options{}, []byte("Subject: none\n\nbody\n")); err == nil {
		t.Error("no recipients should fail")
	}
}
