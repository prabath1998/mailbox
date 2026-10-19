package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/prabath1998/mailbox/checks"
	"github.com/prabath1998/mailbox/events"
	"github.com/prabath1998/mailbox/storage"

	"github.com/gorilla/mux"
)

type Handler struct {
	Storage *storage.SQLiteStorage
	Events  *events.Hub
	Router  *mux.Router
	// SMTPAddr is shown in the UI so people know where to point their app.
	SMTPAddr string
	// Static is the built frontend, served for every non-API path.
	Static fs.FS
}

func NewHandler(store *storage.SQLiteStorage, hub *events.Hub, smtpAddr string, static fs.FS) *Handler {
	h := &Handler{Storage: store, Events: hub, Router: mux.NewRouter(), SMTPAddr: smtpAddr, Static: static}
	h.setupRoutes()
	return h
}

func (h *Handler) setupRoutes() {
	r := h.Router.PathPrefix("/api").Subrouter()
	r.HandleFunc("/info", h.info).Methods("GET")
	r.HandleFunc("/messages", h.listMessages).Methods("GET")
	r.HandleFunc("/messages", h.deleteMessages).Methods("DELETE")
	r.HandleFunc("/messages/read", h.setRead).Methods("PUT")
	r.HandleFunc("/messages/wait", h.waitMessage).Methods("GET")
	r.HandleFunc("/messages/{id:[0-9]+}", h.getMessage).Methods("GET")
	r.HandleFunc("/messages/{id:[0-9]+}", h.deleteMessage).Methods("DELETE")
	r.HandleFunc("/messages/{id:[0-9]+}/raw", h.getRaw).Methods("GET")
	r.HandleFunc("/messages/{id:[0-9]+}/attachments/{aid:[0-9]+}", h.getAttachment).Methods("GET")
	r.HandleFunc("/messages/{id:[0-9]+}/spam", h.spamCheck).Methods("GET")
	r.HandleFunc("/messages/{id:[0-9]+}/links", h.linkCheck).Methods("GET")
	r.HandleFunc("/messages/{id:[0-9]+}/extract", h.extract).Methods("GET")
	r.HandleFunc("/tags", h.tags).Methods("GET")
	r.HandleFunc("/events", h.streamEvents).Methods("GET")
	h.Router.PathPrefix("/").Handler(staticHandler(h.Static))
}

// staticHandler serves the frontend. Vite puts a content hash in every file name
// under /assets/, so those can be cached forever; index.html must always revalidate.
func staticHandler(static fs.FS) http.Handler {
	files := http.FileServer(http.FS(static))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		files.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, err error) {
	if errors.Is(err, storage.ErrNotFound) {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	log.Printf("API error: %v", err)
	http.Error(w, err.Error(), http.StatusInternalServerError)
}

func messageID(r *http.Request) int64 {
	id, _ := strconv.ParseInt(mux.Vars(r)["id"], 10, 64)
	return id
}

func (h *Handler) info(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]string{"smtpAddr": h.SMTPAddr})
}

func (h *Handler) listMessages(w http.ResponseWriter, r *http.Request) {
	q := storage.Query{Search: r.URL.Query().Get("q"), Limit: 50}
	if l, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && l > 0 && l <= 500 {
		q.Limit = l
	}
	if o, err := strconv.Atoi(r.URL.Query().Get("offset")); err == nil && o >= 0 {
		q.Offset = o
	}
	page, err := h.Storage.List(q)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, page)
}

type idsBody struct {
	IDs  []int64 `json:"ids"`
	Read bool    `json:"read"`
}

// deleteMessages deletes the ids in the body, or every message when there is no body.
func (h *Handler) deleteMessages(w http.ResponseWriter, r *http.Request) {
	var body idsBody
	if r.ContentLength > 0 {
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
	}
	if err := h.Storage.Delete(body.IDs); err != nil {
		writeError(w, err)
		return
	}
	h.Events.Publish(events.Event{Type: "deleted", IDs: body.IDs})
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) deleteMessage(w http.ResponseWriter, r *http.Request) {
	id := messageID(r)
	if err := h.Storage.Delete([]int64{id}); err != nil {
		writeError(w, err)
		return
	}
	h.Events.Publish(events.Event{Type: "deleted", IDs: []int64{id}})
	w.WriteHeader(http.StatusNoContent)
}

// setRead marks the ids in the body read or unread; an empty list means all messages.
func (h *Handler) setRead(w http.ResponseWriter, r *http.Request) {
	var body idsBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}
	if err := h.Storage.SetRead(body.IDs, body.Read); err != nil {
		writeError(w, err)
		return
	}
	h.Events.Publish(events.Event{Type: "read", IDs: body.IDs, Read: body.Read})
	w.WriteHeader(http.StatusNoContent)
}

var cidRe = regexp.MustCompile(`(?i)(["'(])cid:([^"')\s]+)`)

// getMessage returns the full message and marks it read.
func (h *Handler) getMessage(w http.ResponseWriter, r *http.Request) {
	m, err := h.loadMessage(messageID(r))
	if err != nil {
		writeError(w, err)
		return
	}
	if !m.Read {
		if err := h.Storage.SetRead([]int64{m.ID}, true); err == nil {
			m.Read = true
			h.Events.Publish(events.Event{Type: "read", IDs: []int64{m.ID}, Read: true})
		}
	}
	writeJSON(w, m)
}

// loadMessage fetches a message for display. Inline cid: references in the HTML are
// rewritten to attachment URLs so embedded images show.
func (h *Handler) loadMessage(id int64) (*storage.Message, error) {
	m, err := h.Storage.Get(id)
	if err != nil {
		return nil, err
	}
	byCID := map[string]int64{}
	for _, a := range m.AttachmentParts {
		if a.ContentID != "" {
			byCID[strings.ToLower(a.ContentID)] = a.ID
		}
	}
	if len(byCID) > 0 {
		m.HTML = cidRe.ReplaceAllStringFunc(m.HTML, func(s string) string {
			parts := cidRe.FindStringSubmatch(s)
			if aid, ok := byCID[strings.ToLower(parts[2])]; ok {
				return fmt.Sprintf("%s/api/messages/%d/attachments/%d", parts[1], m.ID, aid)
			}
			return s
		})
	}
	return m, nil
}

const maxWait = 2 * time.Minute

// waitMessage blocks until a message matching q (the same syntax as search) has
// arrived, then returns it in full without marking it read. With since, only
// messages received after that time count, so earlier mail can't satisfy the wait.
// It responds 404 if nothing matches within timeout (default 30s, at most 2m).
func (h *Handler) waitMessage(w http.ResponseWriter, r *http.Request) {
	params := r.URL.Query()
	timeout := 30 * time.Second
	if t := params.Get("timeout"); t != "" {
		d, err := parseTimeout(t)
		if err != nil {
			http.Error(w, "timeout must be a duration like 10s or a number of seconds", http.StatusBadRequest)
			return
		}
		timeout = min(d, maxWait)
	}
	var since time.Time
	if s := params.Get("since"); s != "" {
		t, err := parseSince(s)
		if err != nil {
			http.Error(w, "since must be an RFC 3339 time or Unix milliseconds", http.StatusBadRequest)
			return
		}
		since = t
	}
	q := storage.Query{Search: params.Get("q"), Since: since, Limit: 1}

	// Subscribe before the first lookup so a message arriving in between isn't missed.
	ch, cancel := h.Events.Subscribe()
	defer cancel()
	deadline := time.NewTimer(timeout)
	defer deadline.Stop()
	// Re-check now and then too: the event feed drops events for slow subscribers.
	recheck := time.NewTicker(time.Second)
	defer recheck.Stop()

	for {
		page, err := h.Storage.List(q)
		if err != nil {
			writeError(w, err)
			return
		}
		if len(page.Messages) > 0 {
			m, err := h.loadMessage(page.Messages[0].ID)
			if err != nil {
				writeError(w, err)
				return
			}
			writeJSON(w, m)
			return
		}
	wait:
		for {
			select {
			case <-r.Context().Done():
				return
			case <-deadline.C:
				http.Error(w, fmt.Sprintf("no matching message arrived within %s", timeout), http.StatusNotFound)
				return
			case <-recheck.C:
				break wait
			case e := <-ch:
				if e.Type == "new" {
					break wait
				}
			}
		}
	}
}

func parseTimeout(s string) (time.Duration, error) {
	if n, err := strconv.ParseFloat(s, 64); err == nil && n >= 0 {
		return time.Duration(n * float64(time.Second)), nil
	}
	d, err := time.ParseDuration(s)
	if err == nil && d < 0 {
		err = errors.New("negative timeout")
	}
	return d, err
}

func parseSince(s string) (time.Time, error) {
	if ms, err := strconv.ParseInt(s, 10, 64); err == nil {
		return time.UnixMilli(ms), nil
	}
	return time.Parse(time.RFC3339Nano, s)
}

func (h *Handler) extract(w http.ResponseWriter, r *http.Request) {
	m, err := h.Storage.Get(messageID(r))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, checks.Extract(m))
}

func (h *Handler) tags(w http.ResponseWriter, r *http.Request) {
	tags, err := h.Storage.Tags()
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, tags)
}

// Files from emails are untrusted: forbid sniffing and sandbox them so an HTML or
// SVG attachment opened directly can't run script on this origin.
func untrusted(w http.ResponseWriter) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "sandbox")
}

func (h *Handler) getRaw(w http.ResponseWriter, r *http.Request) {
	m, err := h.Storage.Get(messageID(r))
	if err != nil {
		writeError(w, err)
		return
	}
	untrusted(w)
	if r.URL.Query().Has("download") {
		w.Header().Set("Content-Type", "message/rfc822")
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": fmt.Sprintf("message-%d.eml", m.ID)}))
	} else {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	}
	w.Write(m.Raw)
}

func (h *Handler) getAttachment(w http.ResponseWriter, r *http.Request) {
	aid, _ := strconv.ParseInt(mux.Vars(r)["aid"], 10, 64)
	a, err := h.Storage.GetAttachment(messageID(r), aid)
	if err != nil {
		writeError(w, err)
		return
	}
	untrusted(w)
	ct := a.ContentType
	if ct == "" {
		ct = "application/octet-stream"
	}
	w.Header().Set("Content-Type", ct)
	disposition := "inline"
	if r.URL.Query().Has("download") || !strings.HasPrefix(ct, "image/") {
		disposition = "attachment"
	}
	name := a.FileName
	if name == "" {
		name = fmt.Sprintf("attachment-%d", a.ID)
	}
	w.Header().Set("Content-Disposition", mime.FormatMediaType(disposition, map[string]string{"filename": name}))
	w.Write(a.Data)
}

func (h *Handler) spamCheck(w http.ResponseWriter, r *http.Request) {
	m, err := h.Storage.Get(messageID(r))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, checks.Spam(m))
}

func (h *Handler) linkCheck(w http.ResponseWriter, r *http.Request) {
	m, err := h.Storage.Get(messageID(r))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, checks.Links(r.Context(), m))
}

// streamEvents is a Server-Sent Events stream of inbox changes.
func (h *Handler) streamEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	ch, cancel := h.Events.Subscribe()
	defer cancel()

	fmt.Fprint(w, ": connected\n\n")
	flusher.Flush()
	ping := time.NewTicker(25 * time.Second)
	defer ping.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-ping.C:
			fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		case e := <-ch:
			b, _ := json.Marshal(e)
			fmt.Fprintf(w, "data: %s\n\n", b)
			flusher.Flush()
		}
	}
}
