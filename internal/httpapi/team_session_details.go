package httpapi

import "strings"

// sessionDevice 将浏览器标识压缩成会话列表可读的浏览器与系统名称。
func sessionDevice(userAgent string) string {
	ua := strings.ToLower(userAgent)
	browser := "Unknown browser"
	switch {
	case strings.Contains(ua, "edg/"):
		browser = "Edge"
	case strings.Contains(ua, "opr/") || strings.Contains(ua, "opera"):
		browser = "Opera"
	case strings.Contains(ua, "firefox/"):
		browser = "Firefox"
	case strings.Contains(ua, "chrome/") || strings.Contains(ua, "crios/"):
		browser = "Chrome"
	case strings.Contains(ua, "safari/"):
		browser = "Safari"
	}

	os := "Unknown system"
	switch {
	case strings.Contains(ua, "windows"):
		os = "Windows"
	case strings.Contains(ua, "iphone") || strings.Contains(ua, "ipad") || strings.Contains(ua, "ios"):
		os = "iOS"
	case strings.Contains(ua, "android"):
		os = "Android"
	case strings.Contains(ua, "macintosh") || strings.Contains(ua, "mac os"):
		os = "macOS"
	case strings.Contains(ua, "linux"):
		os = "Linux"
	}
	return browser + " · " + os
}
