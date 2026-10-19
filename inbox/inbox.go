// Package inbox is the single path every caught message takes: parse, store,
// announce to the UI, notify the webhook and apply the retention limits.
package inbox

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/prabath1998/mailbox/events"
	"github.com/prabath1998/mailbox/mailparse"
	"github.com/prabath1998/mailbox/storage"
)

// ErrParse means the message could not be parsed; the sender should not retry it.
var ErrParse = errors.New("could not parse message")

type Inbox struct {
	Storage *storage.SQLiteStorage
	Events  *events.Hub

	// MaxMessages keeps only the newest N messages; 0 keeps everything.
	MaxMessages int
	// MaxAge deletes messages older than this; 0 keeps them forever.
	MaxAge time.Duration

	// Webhook, when set, receives a JSON POST for every new message.
	Webhook string
	// BaseURL is the web UI address, used to link to messages in webhook payloads.
	BaseURL string
	Client  *http.Client
}

// Deliver parses and stores a raw message received for the given envelope.
func (in *Inbox) Deliver(raw []byte, from string, to []string) (*storage.Summary, error) {
	msg, err := mailparse.Parse(raw, from, to)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrParse, err)
	}
	sum, err := in.Storage.Save(msg)
	if err != nil {
		return nil, err
	}
	log.Printf("Received message %d from %s: %q", sum.ID, sum.From.Address, sum.Subject)
	in.Events.Publish(events.Event{Type: "new", IDs: []int64{sum.ID}, Payload: sum})
	if in.Webhook != "" {
		go in.notify(sum)
	}
	in.Prune()
	return sum, nil
}

// Prune applies the retention limits and tells connected browsers what was removed.
func (in *Inbox) Prune() {
	var before time.Time
	if in.MaxAge > 0 {
		before = time.Now().Add(-in.MaxAge)
	}
	ids, err := in.Storage.Prune(in.MaxMessages, before)
	if err != nil {
		log.Printf("Couldn't delete old messages: %v", err)
		return
	}
	if len(ids) > 0 {
		in.Events.Publish(events.Event{Type: "deleted", IDs: ids})
	}
}

// Run prunes by age once a minute until ctx is done. Count limits are applied on
// every delivery, so this only matters when MaxAge is set.
func (in *Inbox) Run(ctx context.Context) {
	if in.MaxAge <= 0 {
		return
	}
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		in.Prune()
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// WebhookPayload is the JSON body POSTed to the webhook URL.
type WebhookPayload struct {
	Event   string           `json:"event"`
	Message *storage.Summary `json:"message"`
	URL     string           `json:"url,omitempty"`
}

// notify POSTs the new message to the webhook, retrying once on failure.
func (in *Inbox) notify(sum *storage.Summary) {
	p := WebhookPayload{Event: "message.received", Message: sum}
	if in.BaseURL != "" {
		p.URL = fmt.Sprintf("%s/#/message/%d", in.BaseURL, sum.ID)
	}
	body, _ := json.Marshal(p)
	client := in.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	var err error
	for attempt := 0; attempt < 2; attempt++ {
		if attempt > 0 {
			time.Sleep(2 * time.Second)
		}
		var resp *http.Response
		resp, err = client.Post(in.Webhook, "application/json", bytes.NewReader(body))
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode < 300 {
				return
			}
			err = fmt.Errorf("webhook responded with %s", resp.Status)
		}
	}
	log.Printf("Webhook for message %d failed: %v", sum.ID, err)
}
