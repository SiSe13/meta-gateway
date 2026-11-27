package httpapi_test

import (
	"encoding/json"
	"encoding/xml"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/lan/meta-gateway/internal/config"
	"github.com/lan/meta-gateway/internal/crypto"
	"github.com/lan/meta-gateway/internal/httpapi"
	"github.com/lan/meta-gateway/internal/store"
)

// TestPublicSEO 验证公开页可收录、控制台排除收录，以及站点地图和旧入口的路由行为。
func TestPublicSEO(t *testing.T) {
	db, err := store.OpenTest(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	enc, err := crypto.New("public-seo-test-master-key-at-least-32-characters")
	if err != nil {
		t.Fatal(err)
	}
	router := httpapi.NewTestRouter(t, &config.Config{BackupDir: t.TempDir()}, db, enc)

	for _, endpoint := range []struct {
		path        string
		contentType string
		want        []string
	}{
		{"/", "text/html; charset=utf-8", []string{
			`<html lang="zh-CN">`,
			`<title>Balbo AI — 多模型 AI 服务平台</title>`,
			`<meta name="description"`,
			`<meta name="robots" content="index, follow, max-image-preview:large" />`,
			`<link rel="canonical" href="https://balbo.cn/" />`,
			`<meta property="og:url" content="https://balbo.cn/" />`,
			`<meta name="twitter:card" content="summary" />`,
			`<h1>多模型 AI 服务，开通即用</h1>`,
			`href="/console"`,
		}},
		{"/robots.txt", "text/plain; charset=utf-8", []string{
			"User-agent: *\n", "Allow: /\n", "Disallow: /admin\n", "Disallow: /auth\n",
			"Disallow: /me\n", "Disallow: /v1\n", "Sitemap: https://balbo.cn/sitemap.xml\n",
		}},
		{"/sitemap.xml", "application/xml; charset=utf-8", []string{"https://balbo.cn/"}},
	} {
		t.Run(endpoint.path, func(t *testing.T) {
			for _, method := range []string{http.MethodGet, http.MethodHead} {
				response := httptest.NewRecorder()
				router.ServeHTTP(response, httptest.NewRequest(method, endpoint.path, nil))
				if response.Code != http.StatusOK {
					t.Fatalf("%s %s: status=%d", method, endpoint.path, response.Code)
				}
				if got := response.Header().Get("Content-Type"); got != endpoint.contentType {
					t.Fatalf("%s: content type=%q", endpoint.path, got)
				}
				if method == http.MethodHead {
					if response.Body.Len() != 0 {
						t.Fatalf("HEAD %s returned a body", endpoint.path)
					}
					continue
				}
				body := response.Body.String()
				for _, want := range endpoint.want {
					if !strings.Contains(body, want) {
						t.Errorf("%s: missing %q", endpoint.path, want)
					}
				}
				switch endpoint.path {
				case "/":
					_, script, found := strings.Cut(body, `<script type="application/ld+json">`)
					data, _, closed := strings.Cut(script, "</script>")
					var website struct {
						Type string `json:"@type"`
						Name string `json:"name"`
						URL  string `json:"url"`
					}
					if !found || !closed || json.Unmarshal([]byte(data), &website) != nil {
						t.Fatal("missing or invalid website structured data")
					}
					if website.Type != "WebSite" || website.Name != "Balbo AI" || website.URL != "https://balbo.cn/" {
						t.Fatalf("website=%+v", website)
					}
					template, err := os.ReadFile(filepath.Join("..", "..", "tools", "landing", "index.html"))
					if err != nil {
						t.Fatal(err)
					}
					if strings.ReplaceAll(string(template), "\r\n", "\n") != strings.ReplaceAll(body, "\r\n", "\n") {
						t.Error("tools/landing/index.html differs from the public page")
					}
				case "/robots.txt":
					if strings.Contains(body, "Disallow: /console") {
						t.Error("console must remain crawlable so its noindex can be read")
					}
				case "/sitemap.xml":
					var sitemap struct {
						XMLName xml.Name `xml:"http://www.sitemaps.org/schemas/sitemap/0.9 urlset"`
						URLs    []string `xml:"url>loc"`
					}
					if err := xml.Unmarshal(response.Body.Bytes(), &sitemap); err != nil {
						t.Fatal(err)
					}
					if len(sitemap.URLs) != 1 || sitemap.URLs[0] != "https://balbo.cn/" {
						t.Fatalf("sitemap includes unexpected pages: %+v", sitemap.URLs)
					}
				}
			}
		})
	}

	for _, path := range []string{"/console", "/console/keys", "/console/index.html"} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `<meta name="robots" content="noindex, nofollow"`) {
			t.Errorf("%s must serve a console shell with noindex: status=%d", path, response.Code)
		}
	}

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/landing", nil))
	if response.Code != http.StatusPermanentRedirect || response.Header().Get("Location") != "/" {
		t.Fatalf("old landing page: status=%d location=%q", response.Code, response.Header().Get("Location"))
	}
}
