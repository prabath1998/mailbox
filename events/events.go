// Package events fans out inbox changes to connected browsers.
package events

import "sync"

type Event struct {
	Type    string  `json:"type"` // "new", "read", "deleted"
	IDs     []int64 `json:"ids,omitempty"`
	Read    bool    `json:"read,omitempty"`
	Payload any     `json:"message,omitempty"`
}

type Hub struct {
	mu   sync.Mutex
	subs map[chan Event]struct{}
}

func NewHub() *Hub {
	return &Hub{subs: map[chan Event]struct{}{}}
}

func (h *Hub) Subscribe() (<-chan Event, func()) {
	ch := make(chan Event, 16)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	h.mu.Unlock()
	return ch, func() {
		h.mu.Lock()
		delete(h.subs, ch)
		h.mu.Unlock()
	}
}

// Publish never blocks; a subscriber that falls behind misses events and is
// expected to resync by refetching.
func (h *Hub) Publish(e Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		select {
		case ch <- e:
		default:
		}
	}
}
