package main

import (
	"mailbox/api"
	"mailbox/storage"
	"mailbox/smtp"
	"log"
)

func main() {
	// Initialize storage
	store, err := storage.NewSQLiteStorage("./emails.db")
	if err != nil {
		log.Fatalf("Failed to initialize storage: %v", err)
	}
	defer store.Close()

	// Initialize and start SMTP server
	smtpServer := &smtp.SMTPServer{
		Addr:    ":1025", // Listen on port 1025
		Storage: store,
	}
	go func() {
		if err := smtpServer.Start(); err != nil {
			log.Fatalf("Failed to start SMTP server: %v", err)
		}
	}()

	// Initialize and start HTTP server
	apiHandler := api.NewHandler(store)
	log.Fatal(apiHandler.Start(":8025")) // Listen on port 8025
}