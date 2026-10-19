#!/bin/sh
# Installs the latest MailBox release.
#   curl -fsSL https://raw.githubusercontent.com/prabath1998/mailbox/master/install.sh | sh
# Set INSTALL_DIR to choose where the binary goes (default: /usr/local/bin, or ~/.local/bin without write access).
set -eu

REPO="prabath1998/mailbox"

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) echo "Unsupported OS: $(uname -s). Download a build from https://github.com/$REPO/releases" >&2; exit 1 ;;
esac

case "$(uname -m)" in
  x86_64 | amd64) arch=amd64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) echo "Unsupported CPU: $(uname -m). Download a build from https://github.com/$REPO/releases" >&2; exit 1 ;;
esac

if [ -z "${INSTALL_DIR:-}" ]; then
  if [ -w /usr/local/bin ]; then INSTALL_DIR=/usr/local/bin; else INSTALL_DIR="$HOME/.local/bin"; fi
fi
mkdir -p "$INSTALL_DIR"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

url="https://github.com/$REPO/releases/latest/download/mailbox_${os}_${arch}.tar.gz"
echo "Downloading $url"
curl -fsSL "$url" -o "$tmp/mailbox.tar.gz"
tar -xzf "$tmp/mailbox.tar.gz" -C "$tmp" mailbox
install -m 0755 "$tmp/mailbox" "$INSTALL_DIR/mailbox"

echo "Installed $("$INSTALL_DIR/mailbox" -version) to $INSTALL_DIR/mailbox"
case ":$PATH:" in
  *":$INSTALL_DIR:"*) echo "Run 'mailbox' to start." ;;
  *) echo "Add $INSTALL_DIR to your PATH, then run 'mailbox' to start." ;;
esac
