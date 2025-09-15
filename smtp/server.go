package smtp

import (
	"bufio"
	"fmt"
	"mailbox/storage"
	"log"
	"net"
	"strings"
	"time"
	"io" 

	"github.com/emersion/go-message" 
	_ "github.com/emersion/go-message/charset" 
)

type SMTPServer struct {
	Addr    string
	Storage storage.Storage
}

func (s *SMTPServer) Start() error {
	ln, err := net.Listen("tcp", s.Addr)
	if err != nil {
		return err
	}
	defer ln.Close()

	log.Printf("SMTP server listening on %s", s.Addr)

	for {
		conn, err := ln.Accept()
		if err != nil {
			log.Printf("Error accepting connection: %v", err)
			continue
		}
		
		go s.handleConnection(conn)
	}
}

func (s *SMTPServer) handleConnection(conn net.Conn) {	defer conn.Close()

	
	conn.Write([]byte("220 localhost ESMTP Gomailpit\r\n"))

	scanner := bufio.NewScanner(conn)
	var from, to, data string
	isData := false

	for scanner.Scan() {
		line := scanner.Text()
		cmd := strings.ToUpper(strings.TrimSpace(line))

		switch {
		case strings.HasPrefix(cmd, "HELO") || strings.HasPrefix(cmd, "EHLO"):
			conn.Write([]byte("250 Hello\r\n"))
		case strings.HasPrefix(cmd, "MAIL FROM:"):
			from = strings.TrimPrefix(line, "MAIL FROM:")
			from = strings.Trim(from, " :<>")
			conn.Write([]byte("250 OK\r\n"))
		case strings.HasPrefix(cmd, "RCPT TO:"):
			to = strings.TrimPrefix(line, "RCPT TO:")
			to = strings.Trim(to, " :<>")
			conn.Write([]byte("250 OK\r\n"))
		case cmd == "DATA":
			conn.Write([]byte("354 End data with <CR><LF>.<CR><LF>\r\n"))
			isData = true
			
			for scanner.Scan() {
				dataLine := scanner.Text()
				if dataLine == "." {
					break
				}
				data += dataLine + "\r\n"
			}
			
			err := s.processEmail(from, to, data)
			if err != nil {
				log.Printf("Error processing email: %v", err)
				conn.Write([]byte("550 Error processing message\r\n"))
			} else {
				conn.Write([]byte("250 OK: Message received\r\n"))
			}
			
			from, to, data = "", "", ""
			isData = false
		case cmd == "QUIT":
			conn.Write([]byte("221 Bye\r\n"))
			return
		case cmd == "RSET":
			from, to, data = "", "", ""
			isData = false
			conn.Write([]byte("250 OK\r\n"))
		case cmd == "NOOP":
			conn.Write([]byte("250 OK\r\n"))
		default:
			if !isData {
				conn.Write([]byte("500 Command not recognized\r\n"))
			}
		}
	}
}

func (s *SMTPServer) processEmail(from, to, data string) error {
	
	entity, err := message.Read(strings.NewReader(data))
	if err != nil {
		return fmt.Errorf("could not parse MIME: %v", err)
	}

	email := &storage.Email{
		From:      from,
		To:        to,
		Date:      time.Now(),
		Subject:   entity.Header.Get("Subject"),
		MessageID: entity.Header.Get("Message-ID"),
	}
	
	if dateHeader := entity.Header.Get("Date"); dateHeader != "" {
		if parsedDate, err := time.Parse(time.RFC1123Z, dateHeader); err == nil {
			email.Date = parsedDate
		} else if parsedDate, err := time.Parse(time.RFC1123, dateHeader); err == nil {
			email.Date = parsedDate
		}		
	}
	
	if mr := entity.MultipartReader(); mr != nil {		
		for {
			part, err := mr.NextPart()
			if err != nil {
				break 
			}

			contentType := part.Header.Get("Content-Type")
			bodyBytes, err := io.ReadAll(part.Body)
			if err != nil {
				continue 
			}
			body := string(bodyBytes)

			switch {
			case strings.HasPrefix(contentType, "text/plain"):
				email.TextBody = body
			case strings.HasPrefix(contentType, "text/html"):
				email.HTMLBody = body
			}			
		}
	} else {
		
		contentType := entity.Header.Get("Content-Type")
		bodyBytes, err := io.ReadAll(entity.Body)
		if err != nil {
			return fmt.Errorf("could not read email body: %v", err)
		}
		body := string(bodyBytes)

		if strings.HasPrefix(contentType, "text/html") {
			email.HTMLBody = body
		} else {
			email.TextBody = body
		}
	}
	
	return s.Storage.SaveEmail(email)
}