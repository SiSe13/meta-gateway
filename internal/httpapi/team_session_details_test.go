package httpapi

import "testing"

func TestSessionDevice(t *testing.T) {
	tests := []struct {
		name      string
		userAgent string
		want      string
	}{
		{name: "chrome windows", userAgent: "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36", want: "Chrome · Windows"},
		{name: "edge windows", userAgent: "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0", want: "Edge · Windows"},
		{name: "safari macos", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15", want: "Safari · macOS"},
		{name: "unknown", userAgent: "", want: "Unknown browser · Unknown system"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := sessionDevice(tt.userAgent); got != tt.want {
				t.Fatalf("sessionDevice() = %q, want %q", got, tt.want)
			}
		})
	}
}
