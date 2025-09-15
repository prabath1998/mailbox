package main

import (
	"mailbox/api"
	"mailbox/storage"
	"mailbox/smtp"
	"log"
)

func main() {	
	store, err := storage.NewSQLiteStorage("./emails.db")
	if err != nil {
		log.Fatalf("Failed to initialize storage: %v", err)
	}
	defer store.Close()
	
	smtpServer := &smtp.SMTPServer{
		Addr:    ":1025",
		Storage: store,
	}
	go func() {
		if err := smtpServer.Start(); err != nil {
			log.Fatalf("Failed to start SMTP server: %v", err)
		}
	}()
	
	apiHandler := api.NewHandler(store)
	log.Fatal(apiHandler.Start(":8025")) 
}