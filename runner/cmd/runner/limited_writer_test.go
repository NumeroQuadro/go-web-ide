package main

import "testing"

func TestLimitedBuffer_SharedCapAndTruncation(t *testing.T) {
	stdout, stderr, limit := newLimitedBuffers(10)

	if _, err := stdout.Write([]byte("hello")); err != nil {
		t.Fatalf("stdout write: %v", err)
	}
	if _, err := stderr.Write([]byte("world")); err != nil {
		t.Fatalf("stderr write: %v", err)
	}
	if got := stdout.String(); got != "hello" {
		t.Fatalf("stdout=%q, want %q", got, "hello")
	}
	if got := stderr.String(); got != "world" {
		t.Fatalf("stderr=%q, want %q", got, "world")
	}
	if limit.truncated {
		t.Fatalf("expected not truncated yet")
	}

	// Exceed combined cap.
	if _, err := stdout.Write([]byte("!")); err != nil {
		t.Fatalf("stdout write: %v", err)
	}

	if got := stdout.String(); got != "hello" {
		t.Fatalf("stdout=%q, want %q", got, "hello")
	}
	if got := stderr.String(); got != "world" {
		t.Fatalf("stderr=%q, want %q", got, "world")
	}
	if !limit.truncated {
		t.Fatalf("expected truncated")
	}
}
