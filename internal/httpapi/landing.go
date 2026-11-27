package httpapi

import (
	"net/http"
)

// 公开首页直接输出产品介绍与 SEO 信息，和 tools/landing/index.html 保持同步。
const landingPageHTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="dark" />
<meta name="description" content="Balbo AI 提供便捷的 AI 模型服务与统一 API 入口。开通账户即可使用，轻松管理模型调用与用量。" />
<meta name="keywords" content="Balbo AI, AI模型服务, AI API, 多模型平台, 模型调用, AI服务" />
<meta name="robots" content="index, follow, max-image-preview:large" />
<link rel="canonical" href="https://balbo.cn/" />
<meta property="og:type" content="website" />
<meta property="og:locale" content="zh_CN" />
<meta property="og:site_name" content="Balbo AI" />
<meta property="og:title" content="Balbo AI — 多模型 AI 服务平台" />
<meta property="og:description" content="开通账户即可使用 AI 模型服务，通过统一 API 入口管理模型调用与用量。" />
<meta property="og:url" content="https://balbo.cn/" />
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="Balbo AI — 多模型 AI 服务平台" />
<meta name="twitter:description" content="开通账户即可使用 AI 模型服务，通过统一 API 入口管理模型调用与用量。" />
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"WebSite","name":"Balbo AI","url":"https://balbo.cn/","inLanguage":"zh-CN","description":"面向个人与团队的 AI 模型服务平台，提供统一 API 入口、模型调用和用量管理。"}
</script>
<title>Balbo AI — 多模型 AI 服务平台</title>
<style>
  :root {
    --bg: #141210;
    --panel: #1b1815;
    --line: rgba(247, 242, 234, 0.1);
    --ink: #f4efe7;
    --muted: #a39a8e;
    --accent: #7ea0d8;
    --ok: #46c98a;
    --warn: #d09b35;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
  body {
    background:
      radial-gradient(900px 420px at 15% -10%, rgba(126, 160, 216, 0.12), transparent 60%),
      radial-gradient(700px 380px at 88% -12%, rgba(126, 160, 216, 0.08), transparent 55%),
      var(--bg);
    color: var(--ink);
    font-family: Inter, "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
    display: grid;
    place-items: center;
    padding: 24px;
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
  }
  #codefall {
    position: fixed;
    inset: 0;
    z-index: 0;
    pointer-events: none;
  }
  .card {
    position: relative;
    z-index: 1;
    width: min(520px, 100%);
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 2px;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
    overflow: hidden;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 20px 24px;
    border-bottom: 1px solid var(--line);
  }
  .mark {
    width: 36px; height: 36px;
    display: grid; place-items: center;
    background: #2a3348;
    border: 1px solid rgba(247, 242, 234, 0.14);
    border-radius: 2px;
    color: #f7f2ea;
    font-weight: 700;
    font-size: 13px;
    letter-spacing: 0.02em;
  }
  .brand-copy { display: flex; flex-direction: column; gap: 2px; }
  .brand-copy strong { font-size: 15px; font-weight: 650; letter-spacing: 0.01em; }
  .brand-copy span { color: var(--muted); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
  .body { padding: 26px 24px 24px; }
  h1 { font-size: 21px; font-weight: 650; letter-spacing: -0.02em; margin-bottom: 8px; }
  p.lead { color: var(--muted); font-size: 13px; line-height: 1.6; margin-bottom: 20px; }
  .status {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    background: rgba(247, 242, 234, 0.04);
    border: 1px solid var(--line);
    border-radius: 2px;
    margin-bottom: 20px;
  }
  .dot {
    width: 9px; height: 9px; flex: 0 0 auto;
    border-radius: 50%;
    background: var(--warn);
    box-shadow: 0 0 0 4px rgba(208, 155, 53, 0.12);
    transition: background 200ms ease, box-shadow 200ms ease;
  }
  .dot.ok { background: var(--ok); box-shadow: 0 0 0 4px rgba(70, 201, 138, 0.12); }
  .dot.err { background: #e06a60; box-shadow: 0 0 0 4px rgba(224, 106, 96, 0.12); }
  .status-copy { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .status-copy strong { font-size: 12px; font-weight: 600; }
  .status-copy span { color: var(--muted); font-size: 11px; font-family: "JetBrains Mono", "IBM Plex Mono", Consolas, monospace; }
  .actions { display: flex; gap: 10px; margin-bottom: 22px; }
  .btn {
    height: 40px;
    padding: 0 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border-radius: 2px;
    border: 1px solid transparent;
    font-size: 13px;
    font-weight: 600;
    text-decoration: none;
    transition: background 140ms ease, border-color 140ms ease;
  }
  .btn-primary { background: #2f4f86; color: #fff; }
  .btn-primary:hover { background: #3a5f9c; }
  .btn-secondary { background: transparent; color: var(--ink); border-color: var(--line); }
  .btn-secondary:hover { background: rgba(247, 242, 234, 0.06); }
  .endpoints { border-top: 1px solid var(--line); padding-top: 16px; }
  .endpoints h2 {
    font-size: 10px; font-weight: 700; letter-spacing: 0.14em;
    color: var(--muted); text-transform: uppercase; margin-bottom: 10px;
  }
  .endpoint {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 7px 0;
    font-size: 12px;
    border-bottom: 1px solid rgba(247, 242, 234, 0.05);
  }
  .endpoint:last-child { border-bottom: 0; }
  .endpoint code {
    font-family: "JetBrains Mono", "IBM Plex Mono", Consolas, monospace;
    color: var(--accent);
    font-size: 11.5px;
  }
  .endpoint span { color: var(--muted); font-size: 11px; }
  .foot {
    padding: 14px 24px;
    border-top: 1px solid var(--line);
    color: var(--muted);
    font-size: 10px;
    letter-spacing: 0.06em;
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }
  .foot em { font-style: normal; opacity: 0.7; }
</style>
</head>
<body>
  <canvas id="codefall" aria-hidden="true"></canvas>
  <main class="card">
    <header class="brand">
      <div class="mark" aria-hidden="true">B</div>
      <div class="brand-copy">
        <strong>Balbo AI</strong>
        <span>AI MODEL PLATFORM</span>
      </div>
    </header>
    <div class="body">
      <h1>多模型 AI 服务，开通即用</h1>
      <p class="lead">Balbo AI 为个人与团队提供便捷的 AI 模型调用服务。通过统一 API 入口使用模型，在一个工作空间中查看可用模型、管理 API 密钥并跟踪用量。</p>
      <div class="status" role="status">
        <span class="dot" id="dot" aria-hidden="true"></span>
        <div class="status-copy">
          <strong id="status-label">正在检测网关状态…</strong>
          <span id="status-detail">GET /readyz</span>
        </div>
      </div>
      <div class="actions">
        <a class="btn btn-primary" href="/console">进入控制台</a>
        <a class="btn btn-secondary" href="/healthz">健康检查</a>
      </div>
      <section class="endpoints">
        <h2>一站式 AI 模型服务</h2>
        <div class="endpoint"><code>多模型调用</code><span>统一 API 入口，按需选择模型</span></div>
        <div class="endpoint"><code>密钥管理</code><span>在控制台创建与管理 API 密钥</span></div>
        <div class="endpoint"><code>用量明细</code><span>随时查看模型调用记录与消耗</span></div>
      </section>
    </div>
    <footer class="foot">
      <span>BALBO AI</span>
      <em>AI MODEL SERVICES · API · USAGE</em>
    </footer>
  </main>
  <script>
    (function () {
      var canvas = document.getElementById("codefall");
      var ctx = canvas.getContext("2d");
      var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      var GLYPHS = "01{}<>=/;().+*#$&|!?~^%[]:-_abcdef→".split("");

      var DPR = Math.min(window.devicePixelRatio || 1, 1.5);
      var FONT = 13, LEAD = 15, W = 0, H = 0;
      var cols = [];
      var last = 0, raf = 0;

      function rand(a, b) { return a + Math.random() * (b - a); }
      function glyph() { return GLYPHS[(Math.random() * GLYPHS.length) | 0]; }
      function ink(a) { return "rgba(247, 242, 234, " + a.toFixed(3) + ")"; }

      function makeCol(x) {
        var len = (28 * rand(0.7, 1.8)) | 0;
        var chars = [];
        for (var k = 0; k < len; k++) chars.push(glyph());
        return {
          x: x, y: rand(-H * 1.4, H), len: len, chars: chars,
          speed: rand(34, 110), flip: rand(0, 6)
        };
      }

      function layout() {
        W = window.innerWidth; H = window.innerHeight;
        canvas.width = Math.round(W * DPR);
        canvas.height = Math.round(H * DPR);
        canvas.style.width = W + "px";
        canvas.style.height = H + "px";
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        var step = FONT + 5;
        cols = [];
        for (var x = step / 2; x < W; x += step) {
          if (Math.random() < 0.1) continue;
          cols.push(makeCol(x));
        }
      }

      function drawCols(dt) {
        ctx.font = FONT + 'px "JetBrains Mono", "IBM Plex Mono", Consolas, monospace';
        ctx.textAlign = "center";
        for (var i = 0; i < cols.length; i++) {
          var c = cols[i];
          c.y += c.speed * dt;
          c.flip -= dt;
          if (c.flip <= 0) {
            c.chars[(Math.random() * c.chars.length) | 0] = glyph();
            c.flip = rand(0.05, 0.5);
          }
          for (var k = 0; k < c.len; k++) {
            var a = 0.85 * Math.pow(1 - k / c.len, 1.35);
            if (a < 0.02) break;
            var yy = c.y - k * LEAD;
            if (yy < -LEAD || yy > H + LEAD) continue;
            ctx.fillStyle = ink(a);
            ctx.fillText(c.chars[k], c.x, yy);
          }
          if (c.y - c.len * LEAD > H) cols[i] = makeCol(c.x);
        }
      }

      function frame(now) {
        raf = requestAnimationFrame(frame);
        var dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        ctx.clearRect(0, 0, W, H);
        drawCols(dt);
      }

      function start() {
        if (reduced) {
          ctx.clearRect(0, 0, W, H);
          drawCols(0);
          return;
        }
        cancelAnimationFrame(raf);
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }

      layout();
      start();

      window.__codefallTick = function (dt) {
        ctx.clearRect(0, 0, W, H);
        drawCols(dt || 0.016);
      };

      var resizeTimer = 0;
      window.addEventListener("resize", function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () { layout(); start(); }, 150);
      });
      document.addEventListener("visibilitychange", function () {
        if (document.hidden) cancelAnimationFrame(raf);
        else start();
      });
    })();

    (function () {
      var dot = document.getElementById("dot");
      var label = document.getElementById("status-label");
      var detail = document.getElementById("status-detail");
      function probe() {
        fetch("/readyz", { cache: "no-store" })
          .then(function (r) {
            dot.className = "dot" + (r.ok ? " ok" : " err");
            label.textContent = r.ok ? "网关运行正常" : "网关未就绪";
            detail.textContent = "GET /readyz → " + r.status;
          })
          .catch(function () {
            dot.className = "dot err";
            label.textContent = "无法连接网关";
            detail.textContent = "GET /readyz → network error";
          });
      }
      probe();
      setInterval(probe, 15000);
    })();
  </script>
</body>
</html>
`

// handleLanding 提供无需执行 JavaScript 即可读取的公开产品页。
func handleLanding(w http.ResponseWriter, request *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=300")
	if request.Method != http.MethodHead {
		_, _ = w.Write([]byte(landingPageHTML))
	}
}

// handleRobots 限制 API 抓取；控制台允许抓取以便读取其 noindex 标记。
func handleRobots(w http.ResponseWriter, request *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	if request.Method != http.MethodHead {
		_, _ = w.Write([]byte("User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /auth\nDisallow: /me\nDisallow: /v1\nSitemap: https://balbo.cn/sitemap.xml\n"))
	}
}

// handleSitemap 仅列出允许收录的公开页面，并使用正式域名。
func handleSitemap(w http.ResponseWriter, request *http.Request) {
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	if request.Method != http.MethodHead {
		_, _ = w.Write([]byte("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\"><url><loc>https://balbo.cn/</loc></url></urlset>\n"))
	}
}
