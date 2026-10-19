package main

import (
	"flag"
	"log"

	"mailbox/api"
	"mailbox/events"
	"mailbox/smtp"
	"mailbox/storage"
)

func main() {
	smtpAddr := flag.String("smtp", ":1025", "SMTP listen address")
	httpAddr := flag.String("http", ":8025", "web UI and API listen address")
	dbPath := flag.String("db", "./emails.db", "SQLite database file")
	flag.Parse()

	store, err := storage.NewSQLiteStorage(*dbPath)
	if err != nil {
		log.Fatalf("Failed to initialize storage: %v", err)
	}
	defer store.Close()

	hub := events.NewHub()

	smtpServer := &smtp.SMTPServer{
		Addr:    *smtpAddr,
		Storage: store,
		Events:  hub,
	}
	go func() {
		if err := smtpServer.Start(); err != nil {
			log.Fatalf("Failed to start SMTP server: %v", err)
		}
	}()

	apiHandler := api.NewHandler(store, hub, *smtpAddr)
	log.Fatal(apiHandler.Start(*httpAddr))
}
