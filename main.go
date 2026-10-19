package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"syscall"
	"time"

	"github.com/prabath1998/mailbox/api"
	"github.com/prabath1998/mailbox/events"
	"github.com/prabath1998/mailbox/smtp"
	"github.com/prabath1998/mailbox/storage"
	"github.com/prabath1998/mailbox/web"
)

// version is set at release time with -ldflags "-X main.version=v1.2.3".
var version = ""

func main() {
	smtpAddr := flag.String("smtp", envOr("MAILBOX_SMTP", ":1025"), "SMTP listen address (env MAILBOX_SMTP)")
	httpAddr := flag.String("http", envOr("MAILBOX_HTTP", ":8025"), "web UI and API listen address (env MAILBOX_HTTP)")
	dbPath := flag.String("db", envOr("MAILBOX_DB", defaultDBPath()), "SQLite database file (env MAILBOX_DB)")
	open := flag.Bool("open", false, "open the web UI in your browser on start")
	showVersion := flag.Bool("version", false, "print the version and exit")
	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "MailBox catches the email your app sends and shows it in a web UI.\n\nUsage:\n  mailbox [flags]\n\nFlags:\n")
		flag.PrintDefaults()
	}
	flag.Parse()

	if *showVersion {
		fmt.Println("mailbox", appVersion())
		return
	}
	log.SetFlags(log.Ltime)

	if err := os.MkdirAll(filepath.Dir(*dbPath), 0o755); err != nil {
		fatal("Couldn't create the data directory: %v", err)
	}
	store, err := storage.NewSQLiteStorage(*dbPath)
	if err != nil {
		fatal("Couldn't open the database at %s: %v", *dbPath, err)
	}
	defer store.Close()

	// Bind both ports before printing anything, so a port clash fails fast and clearly.
	smtpLn := listen("SMTP server", "-smtp", *smtpAddr)
	httpLn := listen("web UI", "-http", *httpAddr)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	hub := events.NewHub()
	smtpServer := smtp.NewSMTPServer(store, hub)
	httpServer := &http.Server{
		Handler:           api.NewHandler(store, hub, smtpLn.Addr().String(), web.FS()).Router,
		ReadHeaderTimeout: 10 * time.Second,
		// Cancelled on shutdown so open live-update streams end instead of holding the server open.
		BaseContext: func(net.Listener) context.Context { return ctx },
	}

	errc := make(chan error, 2)
	go func() { errc <- smtpServer.Serve(smtpLn) }()
	go func() { errc <- httpServer.Serve(httpLn) }()

	uiURL := "http://" + displayAddr(httpLn.Addr())
	fmt.Printf("\n  MailBox %s\n\n", appVersion())
	fmt.Printf("  Web UI   %s\n", uiURL)
	fmt.Printf("  SMTP     %s\n", displayAddr(smtpLn.Addr()))
	fmt.Printf("  Data     %s\n\n", *dbPath)
	fmt.Printf("  Press Ctrl+C to stop.\n\n")
	if *open {
		openBrowser(uiURL)
	}

	select {
	case <-ctx.Done():
		fmt.Println("\nShutting down…")
	case err := <-errc:
		log.Printf("Server stopped: %v", err)
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	smtpServer.Close()
	httpServer.Shutdown(shutdownCtx)
}

func listen(name, flagName, addr string) net.Listener {
	ln, err := net.Listen("tcp", addr)
	if err == nil {
		return ln
	}
	if errors.Is(err, syscall.EADDRINUSE) {
		fatal("Can't start the %s on %s: the port is already in use.\nStop the other program using it, or pick another address with %s, e.g. %s :%s",
			name, addr, flagName, flagName, map[string]string{"-smtp": "2525", "-http": "8026"}[flagName])
	}
	fatal("Can't start the %s on %s: %v", name, addr, err)
	return nil
}

// displayAddr turns a listen address like [::]:1025 into localhost:1025.
func displayAddr(a net.Addr) string {
	host, port, err := net.SplitHostPort(a.String())
	if err != nil {
		return a.String()
	}
	if ip := net.ParseIP(host); host == "" || (ip != nil && ip.IsUnspecified()) {
		host = "localhost"
	}
	return net.JoinHostPort(host, port)
}

// defaultDBPath keeps caught mail in the user's cache directory so it persists
// across runs no matter which directory mailbox is started from.
func defaultDBPath() string {
	dir, err := os.UserCacheDir()
	if err != nil {
		return "mailbox.db"
	}
	return filepath.Join(dir, "mailbox", "mailbox.db")
}

func appVersion() string {
	if version != "" {
		return version
	}
	if info, ok := debug.ReadBuildInfo(); ok && info.Main.Version != "" && info.Main.Version != "(devel)" {
		return info.Main.Version // set by `go install ...@v1.2.3`
	}
	return "dev"
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err != nil {
		log.Printf("Couldn't open a browser: %v", err)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func fatal(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "mailbox: "+format+"\n", args...)
	os.Exit(1)
}
