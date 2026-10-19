package main

import (
	"testing"
	"time"
)

func TestParseAge(t *testing.T) {
	cases := map[string]time.Duration{"": 0, "0": 0, "7d": 7 * 24 * time.Hour, "1.5d": 36 * time.Hour, "12h": 12 * time.Hour, "90m": 90 * time.Minute}
	for in, want := range cases {
		if got, err := parseAge(in); err != nil || got != want {
			t.Errorf("parseAge(%q) = %v, %v; want %v", in, got, err, want)
		}
	}
	for _, bad := range []string{"week", "-1d", "-5h", "7x"} {
		if _, err := parseAge(bad); err == nil {
			t.Errorf("parseAge(%q) should fail", bad)
		}
	}
}
