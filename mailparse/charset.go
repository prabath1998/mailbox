package mailparse

import (
	"io"

	"github.com/emersion/go-message/charset"
)

func charsetReader(label string, input io.Reader) (io.Reader, error) {
	return charset.Reader(label, input)
}
