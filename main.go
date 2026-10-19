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
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/prabath1998/mailbox/api"
	"github.com/prabath1998/mailbox/events"
	"github.com/prabath1998/mailbox/inbox"
	"github.com/prabath1998/mailbox/sendmail"
	"github.com/prabath1998/mailbox/smtp"
	"github.com/prabath1998/mailbox/storage"
	"github.com/prabath1998/mailbox/web"
)

// version is set at release time with -ldflags "-X main.version=v1.2.3".
var version = ""

func main() {
	// `mailbox sendmail ...`, or the binary symlinked as `sendmail`.
	if filepath.Base(os.Args[0]) == "sendmail" {
		runSendmail(os.Args[1:])
	}
	if len(os.Args) > 1 && os.Args[1] == "sendmail" {
		runSendmail(os.Args[2:])
	}

	smtpAddr := flag.String("smtp", envOr("MAILBOX_SMTP", ":1025"), "SMTP listen address (env MAILBOX_SMTP)")
	httpAddr := flag.String("http", envOr("MAILBOX_HTTP", ":8025"), "web UI and API listen address (env MAILBOX_HTTP)")
	dbPath := flag.String("db", envOr("MAILBOX_DB", defaultDBPath()), "SQLite database file (env MAILBOX_DB)")
	maxMessages := flag.Int("max-messages", envInt("MAILBOX_MAX_MESSAGES", 500), "keep only the newest N messages, 0 for no limit (env MAILBOX_MAX_MESSAGES)")
	maxAgeFlag := flag.String("max-age", os.Getenv("MAILBOX_MAX_AGE"), "delete messages older than this, e.g. 7d or 12h (env MAILBOX_MAX_AGE)")
	webhook := flag.String("webhook", os.Getenv("MAILBOX_WEBHOOK"), "URL to POST each new message to as JSON (env MAILBOX_WEBHOOK)")
	uiAuth := flag.String("ui-auth", os.Getenv("MAILBOX_UI_AUTH"), "require a login for the web UI and API, as user:pass[,user2:pass2] (env MAILBOX_UI_AUTH)")
	smtpAuth := flag.String("smtp-auth", os.Getenv("MAILBOX_SMTP_AUTH"), "only accept SMTP logins with these credentials, as user:pass[,...] (env MAILBOX_SMTP_AUTH)")
	open := flag.Bool("open", false, "open the web UI in your browser on start")
	showVersion := flag.Bool("version", false, "print the version and exit")
	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "MailBox catches the email your app sends and shows it in a web UI.\n\nUsage:\n  mailbox [flags]\n  mailbox sendmail [sendmail flags] [recipients]   hand a message on stdin to a running MailBox\n\nFlags:\n")
		flag.PrintDefaults()
	}
	flag.Parse()

	if *showVersion {
		fmt.Println("mailbox", appVersion())
		return
	}
	log.SetFlags(log.Ltime)

	maxAge, err := parseAge(*maxAgeFlag)
	if err != nil {
		fatal("Invalid -max-age %q: use a number of days like 7d, or a duration like 12h", *maxAgeFlag)
	}
	uiCreds, err := api.ParseCredentials(*uiAuth)
	if err != nil {
		fatal("Invalid -ui-auth: %v", err)
	}
	smtpCreds, err := api.ParseCredentials(*smtpAuth)
	if err != nil {
		fatal("Invalid -smtp-auth: %v", err)
	}

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

	uiURL := "http://" + displayAddr(httpLn.Addr())
	hub := events.NewHub()
	in := &inbox.Inbox{Storage: store, Events: hub, MaxMessages: *maxMessages, MaxAge: maxAge, Webhook: *webhook, BaseURL: uiURL}
	in.Prune()
	go in.Run(ctx)
	smtpServer := smtp.NewSMTPServer(in, smtpCreds)
	httpServer := &http.Server{
		Handler:           api.BasicAuth(api.NewHandler(store, hub, smtpLn.Addr().String(), web.FS()).Router, uiCreds),
		ReadHeaderTimeout: 10 * time.Second,
		// Cancelled on shutdown so open live-update streams end instead of holding the server open.
		BaseContext: func(net.Listener) context.Context { return ctx },
	}

	errc := make(chan error, 2)
	go func() { errc <- smtpServer.Serve(smtpLn) }()
	go func() { errc <- httpServer.Serve(httpLn) }()

	fmt.Printf("\n  MailBox %s\n\n", appVersion())
	fmt.Printf("  Web UI   %s%s\n", uiURL, map[bool]string{true: "  (login required)"}[len(uiCreds) > 0])
	fmt.Printf("  SMTP     %s%s\n", displayAddr(smtpLn.Addr()), map[bool]string{true: "  (login required)"}[len(smtpCreds) > 0])
	fmt.Printf("  Data     %s\n", *dbPath)
	fmt.Printf("  Keeps    %s\n", retention(*maxMessages, *maxAgeFlag))
	if *webhook != "" {
		fmt.Printf("  Webhook  %s\n", *webhook)
	}
	fmt.Println()
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

func runSendmail(args []string) {
	if err := sendmail.Run(args, os.Stdin); err != nil {
		fmt.Fprintf(os.Stderr, "mailbox sendmail: %v\n", err)
		os.Exit(1)
	}
	os.Exit(0)
}

// parseAge accepts Go durations plus a "d" suffix for days.
func parseAge(s string) (time.Duration, error) {
	if s == "" || s == "0" {
		return 0, nil
	}
	if days, ok := strings.CutSuffix(s, "d"); ok {
		n, err := strconv.ParseFloat(days, 64)
		if err != nil || n < 0 {
			return 0, fmt.Errorf("invalid days")
		}
		return time.Duration(n * 24 * float64(time.Hour)), nil
	}
	d, err := time.ParseDuration(s)
	if err == nil && d < 0 {
		err = fmt.Errorf("negative age")
	}
	return d, err
}

func retention(maxMessages int, maxAge string) string {
	var parts []string
	if maxMessages > 0 {
		parts = append(parts, fmt.Sprintf("newest %d messages", maxMessages))
	}
	if maxAge != "" && maxAge != "0" {
		parts = append(parts, "up to "+maxAge+" old")
	}
	if len(parts) == 0 {
		return "everything"
	}
	return strings.Join(parts, ", ")
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

func envInt(key string, fallback int) int {
	if n, err := strconv.Atoi(os.Getenv(key)); err == nil {
		return n
	}
	return fallback
}

func fatal(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "mailbox: "+format+"\n", args...)
	os.Exit(1)
}
