package checks

import (
	"context"
	"html"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/prabath1998/mailbox/storage"
)

type LinkResult struct {
	URL        string `json:"url"`
	Kind       string `json:"kind"` // "link" or "image"
	Status     int    `json:"status"`
	StatusText string `json:"statusText"`
	OK         bool   `json:"ok"`
	Error      string `json:"error,omitempty"`
}

type LinkReport struct {
	Links  []LinkResult `json:"links"`
	Broken int          `json:"broken"`
}

const maxLinks = 100

var (
	hrefRe = regexp.MustCompile(`(?i)<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']`)
	srcRe  = regexp.MustCompile(`(?i)<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']`)
)

func extractLinks(m *storage.Message) []LinkResult {
	seen := map[string]bool{}
	var out []LinkResult
	add := func(u, kind string) {
		u = strings.TrimSpace(html.UnescapeString(u))
		lower := strings.ToLower(u)
		if !strings.HasPrefix(lower, "http://") && !strings.HasPrefix(lower, "https://") {
			return
		}
		if seen[u] || len(out) >= maxLinks {
			return
		}
		seen[u] = true
		out = append(out, LinkResult{URL: u, Kind: kind})
	}
	for _, mt := range hrefRe.FindAllStringSubmatch(m.HTML, -1) {
		add(mt[1], "link")
	}
	for _, mt := range srcRe.FindAllStringSubmatch(m.HTML, -1) {
		add(mt[1], "image")
	}
	for _, u := range urlRe.FindAllString(m.Text, -1) {
		add(strings.TrimRight(u, ".,;:!?"), "link")
	}
	return out
}

// Links requests every http(s) link and image in the message and reports which
// ones fail. It tries HEAD first and falls back to GET for servers that reject HEAD.
func Links(ctx context.Context, m *storage.Message) LinkReport {
	links := extractLinks(m)
	client := &http.Client{Timeout: 10 * time.Second}

	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)
	for i := range links {
		wg.Add(1)
		go func(l *LinkResult) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			check(ctx, client, l)
		}(&links[i])
	}
	wg.Wait()

	report := LinkReport{Links: links}
	if report.Links == nil {
		report.Links = []LinkResult{}
	}
	for _, l := range links {
		if !l.OK {
			report.Broken++
		}
	}
	return report
}

func check(ctx context.Context, client *http.Client, l *LinkResult) {
	resp, err := request(ctx, client, http.MethodHead, l.URL)
	if err != nil || resp.StatusCode == http.StatusMethodNotAllowed || resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusNotImplemented {
		resp, err = request(ctx, client, http.MethodGet, l.URL)
	}
	if err != nil {
		l.Error = err.Error()
		return
	}
	l.Status = resp.StatusCode
	l.StatusText = http.StatusText(resp.StatusCode)
	l.OK = resp.StatusCode < 400
}

func request(ctx context.Context, client *http.Client, method, u string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (MailBox link checker)")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	resp.Body.Close()
	return resp, nil
}
