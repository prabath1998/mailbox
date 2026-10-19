// Package checks runs quality checks against a stored message.
package checks

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"unicode"

	"github.com/prabath1998/mailbox/mailparse"
	"github.com/prabath1998/mailbox/storage"
)

type SpamRule struct {
	Name        string  `json:"name"`
	Score       float64 `json:"score"`
	Description string  `json:"description"`
}

type SpamReport struct {
	Score     float64    `json:"score"`
	Threshold float64    `json:"threshold"`
	IsSpam    bool       `json:"isSpam"`
	Rules     []SpamRule `json:"rules"`
}

const spamThreshold = 5.0

var spamPhrases = []string{
	"act now", "100% free", "click here", "limited time", "winner", "risk-free", "risk free",
	"no credit check", "urgent", "congratulations", "earn money", "guaranteed", "cash bonus",
	"free gift", "you have been selected", "once in a lifetime", "no obligation", "order now",
	"double your", "100% satisfied", "lowest price", "work from home", "miracle",
}

var shorteners = []string{"bit.ly", "tinyurl.com", "goo.gl", "t.co", "ow.ly", "is.gd", "buff.ly", "rebrand.ly", "cutt.ly"}

var (
	anchorRe = regexp.MustCompile(`(?is)<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>(.*?)</a>`)
	imgRe    = regexp.MustCompile(`(?i)<img\b`)
	urlRe    = regexp.MustCompile(`https?://[^\s"'<>()]+`)
)

func header(m *storage.Message, name string) string {
	for _, h := range m.Headers {
		if strings.EqualFold(h.Name, name) {
			return h.Value
		}
	}
	return ""
}

// Spam scores a message with built-in heuristics modelled on common SpamAssassin
// rules. It is meant to flag obvious problems, not to match a real filter exactly.
func Spam(m *storage.Message) SpamReport {
	var rules []SpamRule
	add := func(name string, score float64, desc string) {
		rules = append(rules, SpamRule{Name: name, Score: score, Description: desc})
	}

	if header(m, "Message-ID") == "" {
		add("MISSING_MID", 1.0, "No Message-ID header. Real mail servers always add one.")
	}
	if header(m, "Date") == "" {
		add("MISSING_DATE", 1.0, "No Date header.")
	}
	if strings.TrimSpace(m.Subject) == "" {
		add("MISSING_SUBJECT", 1.0, "The message has no subject.")
	} else {
		letters, upper := 0, 0
		for _, r := range m.Subject {
			if unicode.IsLetter(r) {
				letters++
				if unicode.IsUpper(r) {
					upper++
				}
			}
		}
		if letters >= 8 && upper == letters {
			add("SUBJ_ALL_CAPS", 1.5, "The subject is written entirely in capitals.")
		}
		if strings.Count(m.Subject, "!") >= 3 || strings.Contains(m.Subject, "$$$") {
			add("SUBJ_EXCESS_PUNCT", 1.0, "The subject uses excessive ! or $ characters.")
		}
	}

	if m.HTML != "" && strings.TrimSpace(m.Text) == "" {
		add("MIME_HTML_ONLY", 1.5, "HTML with no plain-text alternative. Add a text/plain part.")
	}

	visible := m.Text
	if strings.TrimSpace(visible) == "" {
		visible = mailparse.StripHTML(m.HTML)
	}
	if m.HTML != "" && imgRe.MatchString(m.HTML) && len(strings.TrimSpace(strings.Join(strings.Fields(mailparse.StripHTML(m.HTML)), " "))) < 400 {
		add("HTML_IMAGE_RATIO", 1.5, "Mostly images with very little text. Filters treat image-heavy mail as suspicious.")
	}

	haystack := strings.ToLower(m.Subject + " " + visible)
	var hits []string
	for _, p := range spamPhrases {
		if strings.Contains(haystack, p) {
			hits = append(hits, p)
		}
	}
	if len(hits) > 0 {
		score := 0.5 * float64(len(hits))
		if score > 2.5 {
			score = 2.5
		}
		add("SPAMMY_PHRASES", score, fmt.Sprintf("Contains phrases common in spam: %s.", quoteJoin(hits)))
	}

	links := urlRe.FindAllString(m.Text+" "+m.HTML, -1)
	for _, l := range links {
		if u, err := url.Parse(l); err == nil && contains(shorteners, strings.ToLower(u.Hostname())) {
			add("URL_SHORTENER", 1.0, fmt.Sprintf("Uses a link shortener (%s), which hides the real destination.", u.Hostname()))
			break
		}
	}

	for _, match := range anchorRe.FindAllStringSubmatch(m.HTML, -1) {
		text := strings.TrimSpace(mailparse.StripHTML(match[2]))
		shown := urlRe.FindString(text)
		if shown == "" {
			continue
		}
		hu, err1 := url.Parse(match[1])
		su, err2 := url.Parse(shown)
		if err1 == nil && err2 == nil && hu.Hostname() != "" && !sameSite(hu.Hostname(), su.Hostname()) {
			add("LINK_TEXT_MISMATCH", 2.0, fmt.Sprintf("Link text shows %s but points to %s. This looks like phishing.", su.Hostname(), hu.Hostname()))
			break
		}
	}

	if strings.Contains(m.From.Name, "@") && !strings.EqualFold(strings.Trim(m.From.Name, "<> "), m.From.Address) {
		add("FROM_NAME_HAS_ADDR", 1.0, "The sender's display name contains a different email address.")
	}

	if len(m.ReplyTo) > 0 && !sameSite(domainOf(m.ReplyTo[0].Address), domainOf(m.From.Address)) {
		add("REPLYTO_DIFF_DOMAIN", 0.5, "Reply-To uses a different domain than From.")
	}

	if header(m, "List-Unsubscribe") == "" {
		add("NO_LIST_UNSUBSCRIBE", 0.3, "No List-Unsubscribe header. Gmail and Yahoo require one for bulk senders.")
	}

	report := SpamReport{Threshold: spamThreshold, Rules: rules}
	if report.Rules == nil {
		report.Rules = []SpamRule{}
	}
	for _, r := range rules {
		report.Score += r.Score
	}
	report.IsSpam = report.Score >= spamThreshold
	return report
}

func quoteJoin(s []string) string {
	q := make([]string, len(s))
	for i, v := range s {
		q[i] = `"` + v + `"`
	}
	return strings.Join(q, ", ")
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func domainOf(addr string) string {
	if i := strings.LastIndex(addr, "@"); i >= 0 {
		return strings.ToLower(addr[i+1:])
	}
	return ""
}

// sameSite treats a domain and its subdomains as the same site.
func sameSite(a, b string) bool {
	a, b = strings.TrimPrefix(strings.ToLower(a), "www."), strings.TrimPrefix(strings.ToLower(b), "www.")
	return a == b || strings.HasSuffix(a, "."+b) || strings.HasSuffix(b, "."+a)
}
