package main

import (
	"bytes"
	"sync"
)

type sharedOutputLimit struct {
	mu        sync.Mutex
	remaining int
	truncated bool
}

type limitedBuffer struct {
	limit *sharedOutputLimit
	buf   bytes.Buffer
}

func newLimitedBuffers(maxBytes int) (stdout *limitedBuffer, stderr *limitedBuffer, limit *sharedOutputLimit) {
	shared := &sharedOutputLimit{
		remaining: maxBytes,
		truncated: false,
	}
	return &limitedBuffer{limit: shared}, &limitedBuffer{limit: shared}, shared
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	b.limit.mu.Lock()
	defer b.limit.mu.Unlock()

	// Always report the full write as "accepted" so os/exec doesn't error out,
	// but only store up to the remaining cap.
	if b.limit.remaining <= 0 {
		b.limit.truncated = true
		return len(p), nil
	}

	n := len(p)
	if n > b.limit.remaining {
		n = b.limit.remaining
		b.limit.truncated = true
	}

	_, _ = b.buf.Write(p[:n])
	b.limit.remaining -= n
	return len(p), nil
}

func (b *limitedBuffer) String() string {
	return b.buf.String()
}
