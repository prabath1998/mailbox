package api

import (
	"crypto/subtle"
	"fmt"
	"net/http"
	"strings"
)

// ParseCredentials reads "user:pass,user2:pass2" into a map.
func ParseCredentials(s string) (map[string]string, error) {
	creds := map[string]string{}
	for _, pair := range strings.Split(s, ",") {
		pair = strings.TrimSpace(pair)
		if pair == "" {
			continue
		}
		user, pass, ok := strings.Cut(pair, ":")
		if !ok || user == "" || pass == "" {
			return nil, fmt.Errorf("%q is not in the form user:password", pair)
		}
		creds[user] = pass
	}
	return creds, nil
}

// BasicAuth requires one of the given username/password pairs for every request.
// Browsers prompt for it once and resend it automatically, including on the
// live-update stream; API clients pass it with `curl -u user:pass`.
func BasicAuth(next http.Handler, creds map[string]string) http.Handler {
	if len(creds) == 0 {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		want, known := creds[user]
		// Compare even for unknown users so response time doesn't reveal which names exist.
		if !known {
			want = "\x00"
		}
		if !ok || subtle.ConstantTimeCompare([]byte(pass), []byte(want)) != 1 || !known {
			w.Header().Set("WWW-Authenticate", `Basic realm="MailBox", charset="UTF-8"`)
			http.Error(w, "Login required", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}
