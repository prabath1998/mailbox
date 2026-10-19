package checks

import (
	"html"
	"regexp"
	"strings"

	"github.com/prabath1998/mailbox/mailparse"
	"github.com/prabath1998/mailbox/storage"
)

// Extracted is what automated tests usually need from an email.
type Extracted struct {
	Links []ExtractedLink `json:"links"`
	// Codes are likely one-time codes, best guess first: numbers or upper-case
	// letter/digit strings, preferring ones that follow words like "code" or "OTP".
	Codes []string `json:"codes"`
}

type ExtractedLink struct {
	URL  string `json:"url"`
	Text string `json:"text"`
}

var (
	codeRe     = regexp.MustCompile(`\b[A-Z0-9]{4,10}\b`)
	codeWordRe = regexp.MustCompile(`(?i)\b(code|otp|pin|passcode|password|verification|verify|token|one[- ]time)\b`)
	digitRe    = regexp.MustCompile(`[0-9]`)
	letterRe   = regexp.MustCompile(`[A-Z]`)
	yearLikeRe = regexp.MustCompile(`^(19|20)\d\d$`)
	whitespace = regexp.MustCompile(`\s+`)
)

// Extract pulls the http(s) links and likely verification codes out of a message.
func Extract(m *storage.Message) Extracted {
	out := Extracted{Links: []ExtractedLink{}, Codes: []string{}}

	seen := map[string]bool{}
	addLink := func(u, text string) {
		u = strings.TrimSpace(html.UnescapeString(u))
		lower := strings.ToLower(u)
		if (!strings.HasPrefix(lower, "http://") && !strings.HasPrefix(lower, "https://")) || seen[u] {
			return
		}
		seen[u] = true
		out.Links = append(out.Links, ExtractedLink{URL: u, Text: text})
	}
	for _, mt := range anchorRe.FindAllStringSubmatch(m.HTML, -1) {
		addLink(mt[1], strings.TrimSpace(whitespace.ReplaceAllString(mailparse.StripHTML(mt[2]), " ")))
	}
	for _, u := range urlRe.FindAllString(m.Text, -1) {
		addLink(strings.TrimRight(u, ".,;:!?)"), "")
	}

	text := m.Text
	if strings.TrimSpace(text) == "" {
		text = mailparse.StripHTML(m.HTML)
	}
	// Digits inside URLs (tokens, ids) are not codes.
	text = urlRe.ReplaceAllString(text, " ")
	out.Codes = codes(text)
	return out
}

func codes(text string) []string {
	var near, other []string
	seen := map[string]bool{}
	for _, loc := range codeRe.FindAllStringIndex(text, -1) {
		c := text[loc[0]:loc[1]]
		if seen[c] || !digitRe.MatchString(c) {
			continue
		}
		allDigits := !letterRe.MatchString(c)
		if allDigits && len(c) > 8 || !allDigits && len(c) < 6 {
			continue
		}
		before := text[max(0, loc[0]-80):loc[0]]
		keyword := codeWordRe.MatchString(before)
		if !keyword && allDigits && yearLikeRe.MatchString(c) {
			continue
		}
		seen[c] = true
		if keyword {
			near = append(near, c)
		} else {
			other = append(other, c)
		}
	}
	return append(append([]string{}, near...), other...)
}
