#!/bin/sh
# Installs MailBox to /usr/local/bin/mailbox.
#
#   sudo sh < <(curl -sL https://raw.githubusercontent.com/prabath1998/mailbox/master/install.sh)
#   curl -fsSL https://raw.githubusercontent.com/prabath1998/mailbox/master/install.sh | sh
#
# Environment variables:
#   INSTALL_PATH  directory to install into (default /usr/local/bin, or ~/.local/bin without write access)
#   VERSION       release to install, e.g. v0.1.0 (default: latest)
set -eu

REPO="prabath1998/mailbox"

fail() {
  echo "mailbox install: $*" >&2
  exit 1
}

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) fail "unsupported OS $(uname -s). Download a build from https://github.com/$REPO/releases" ;;
esac

case "$(uname -m)" in
  x86_64 | amd64) arch=amd64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) fail "unsupported CPU $(uname -m). Download a build from https://github.com/$REPO/releases" ;;
esac

if [ -z "${INSTALL_PATH:-}" ]; then
  if [ -w /usr/local/bin ]; then INSTALL_PATH=/usr/local/bin; else INSTALL_PATH="$HOME/.local/bin"; fi
fi
mkdir -p "$INSTALL_PATH" || fail "can't create $INSTALL_PATH"
[ -w "$INSTALL_PATH" ] || fail "can't write to $INSTALL_PATH. Run with sudo, or set INSTALL_PATH to a directory you own."

if [ -n "${VERSION:-}" ]; then
  base="https://github.com/$REPO/releases/download/$VERSION"
else
  base="https://github.com/$REPO/releases/latest/download"
fi
archive="mailbox_${os}_${arch}.tar.gz"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading $base/$archive"
curl -fsSL "$base/$archive" -o "$tmp/$archive" || fail "download failed. Check that the release exists: https://github.com/$REPO/releases"
curl -fsSL "$base/checksums.txt" -o "$tmp/checksums.txt" || fail "couldn't download checksums.txt"

expected="$(grep " $archive\$" "$tmp/checksums.txt" | cut -d ' ' -f 1)"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp/$archive" | cut -d ' ' -f 1)"
else
  actual="$(shasum -a 256 "$tmp/$archive" | cut -d ' ' -f 1)"
fi
[ -n "$expected" ] && [ "$expected" = "$actual" ] || fail "checksum mismatch for $archive. The download may be corrupted; try again."

tar -xzf "$tmp/$archive" -C "$tmp" mailbox
install -m 0755 "$tmp/mailbox" "$INSTALL_PATH/mailbox"

echo "Installed $("$INSTALL_PATH/mailbox" -version) to $INSTALL_PATH/mailbox"
case ":$PATH:" in
  *":$INSTALL_PATH:"*) echo "Run 'mailbox' to start, then open http://localhost:8025" ;;
  *) echo "Add $INSTALL_PATH to your PATH, then run 'mailbox' to start." ;;
esac
