// Watchtower execution path for the one-click update: the compose companion
// service holds the Docker socket and sits completely idle until the console
// triggers it — HTTP API mode only, no periodic polls, so updates happen
// exclusively on an explicit operator action (stability first).
package selfupdate

import (
	"net"
	"os"
	"strings"
	"time"
)

// watchtowerURL/token resolve at call time so deployments can override them
// with WATCHTOWER_URL / WATCHTOWER_TOKEN.
func watchtowerURL() string {
	return strings.TrimRight(strings.TrimSpace(os.Getenv("WATCHTOWER_URL")), "/")
}

func watchtowerToken() string {
	return strings.TrimSpace(os.Getenv("WATCHTOWER_TOKEN"))
}

func defaults() (url, token string) {
	url = watchtowerURL()
	if url == "" {
		url = defaultWatchtowerURL
	}
	token = watchtowerToken()
	if token == "" {
		token = defaultWatchtowerToken
	}
	return url, token
}

// WatchtowerReachable reports whether the companion service answers on the
// compose network (short probe — it either runs or it does not).
func WatchtowerReachable() bool {
	url, _ := defaults()
	host := strings.TrimPrefix(url, "http://")
	host = strings.TrimPrefix(host, "https://")
	conn, err := net.DialTimeout("tcp", host, 400*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}
