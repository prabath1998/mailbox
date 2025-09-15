package api

import (
	"encoding/json"
	"fmt"
	"mailbox/storage"
	"log"
	"net/http"
	"strconv"

	"github.com/gorilla/mux"
)

type Handler struct {
	Storage storage.Storage
	Router  *mux.Router
}

func NewHandler(storage storage.Storage) *Handler {
	h := &Handler{Storage: storage}
	h.Router = mux.NewRouter()
	h.setupRoutes()
	return h
}

func (h *Handler) setupRoutes() {
	h.Router.HandleFunc("/api/messages", h.getEmails).Methods("GET")
	h.Router.HandleFunc("/api/messages/{id}", h.getEmail).Methods("GET")	
	h.Router.PathPrefix("/").Handler(http.FileServer(http.Dir("./web/")))
}

func (h *Handler) getEmails(w http.ResponseWriter, r *http.Request) {
	limitStr := r.URL.Query().Get("limit")
	offsetStr := r.URL.Query().Get("offset")

	limit := 50
	offset := 0

	if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
		limit = l
	}
	if o, err := strconv.Atoi(offsetStr); err == nil && o >= 0 {
		offset = o
	}

	emails, err := h.Storage.GetEmails(limit, offset)
	if err != nil {
		http.Error(w, fmt.Sprintf("Error fetching emails: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(emails)
}

func (h *Handler) getEmail(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id := vars["id"]

	email, err := h.Storage.GetEmailByID(id)
	if err != nil {
		http.Error(w, fmt.Sprintf("Email not found: %v", err), http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(email)
}

func (h *Handler) Start(addr string) error {
	log.Printf("HTTP server listening on %s", addr)
	return http.ListenAndServe(addr, h.Router)
}