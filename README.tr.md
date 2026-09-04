# purplemux

**Claude Code ve Codex, birden çok işi aynı anda. Daha hızlı.**

Tüm oturumlarınız tek bir ekranda. Telefonda bile kopuksuz.

Türkçe | <a href="README.md">English</a> | <a href="README.ko.md">한국어</a> | <a href="README.ja.md">日本語</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.ru.md">Русский</a> | <a href="README.pt-BR.md">Português (Brasil)</a>

![purplemux](docs/images/screenshot.png)

![purplemux mobile](docs/images/screenshot-mobile.png)

## Kurulum

```bash
npx purplemux@latest
```

Tarayıcınızda [http://localhost:8022](http://localhost:8022) adresini açın. Hepsi bu.

> Node.js 20+ ve tmux gerekir. macOS veya Linux.

Yerel bir uygulama mı tercih edersiniz? macOS Electron sürümünü [en son sürümden](https://github.com/subicura/purplemux/releases/latest) indirebilirsiniz (Apple Silicon ve Intel için `.dmg`).

## Neden purplemux

- **Çoklu oturum panosu** — Tüm Claude Code ve Codex oturumlarının «çalışıyor / giriş bekliyor» durumunu tek bakışta görün
- **Rate limit takibi** — 5 saat / 7 gün kalan kullanım ve sıfırlama geri sayımı
- **Push bildirimleri** — Görev bitince veya giriş gerektiğinde masaüstü ve mobil uyarılar
- **Mobil ve çoklu cihaz** — Aynı oturuma telefonunuzdan, tabletinizden veya başka bir masaüstünden erişin
- **Canlı oturum görünümü** — CLI çıktısını kaydırmaya son: ilerleme bir zaman tüneli olarak düzenlenir

Ayrıca

- **Kopmayan oturumlar** — tmux tabanlı. Tarayıcıyı kapatın, her şey yerinde kalır. Tekrar bağlandığınızda sekmeleriniz, panelleriniz ve dizinleriniz tam da bıraktığınız yerde
- **Kendi sunucunuzda, açık kaynak** — Kod ve oturum verileri makinenizden hiç çıkmaz. Harici sunucu yok
- **Şifreli uzaktan erişim** — Tailscale üzerinden her yerden HTTPS

## Resmi Remote Control'den farkı

> Resmi Remote Control tek bir oturumun uzaktan kontrolüne odaklanır. Çoklu oturum yönetimi, push bildirimleri ve kalıcı oturumlara ihtiyaç duyduğunuzda purplemux'u kullanın.

## Özellikler

### Terminal

- **Panel bölme** — Yatay / dikey serbest bölme, sürükleyerek yeniden boyutlandırma
- **Sekme yönetimi** — Çoklu sekme, sürükleyerek sıralama, süreç adına dayalı otomatik başlıklar
- **Klavye kısayolları** — Bölme, sekme değiştirme, odak hareketi
- **Terminal temaları** — Koyu / açık mod, çeşitli renk temaları
- **Çalışma alanları & gruplar** — Panel düzenini, sekmeleri ve çalışma dizinlerini çalışma alanı bazında kaydedin ve geri yükleyin. Çalışma alanlarını sürükle-bırak ile gruplara ayırarak yönetin
- **Git iş akışı** — Side-by-side / Line-by-line geçişi ve sözdizimi vurgulamasıyla birlikte satır içi hunk genişletme ve sayfalandırılmış geçmiş sekmesi. Panelden doğrudan fetch / pull / push (ahead/behind göstergeleriyle) — sync başarısız olursa (dirty worktree, çakışma) tek tıkla Ask Claude veya Codex
- **Web tarayıcı paneli** — Geliştirme çıktısını kontrol etmek için terminalin yanında gömülü tarayıcı (Electron). `purplemux` CLI'dan kontrol edin ve dahili cihaz öykünücüsüyle viewport'u değiştirin
- **Ajan sekmeleri** — Yeni sekme menüsünden Claude, Codex veya birleşik oturum listesini başlatın

### Claude Code ve Codex entegrasyonu

- **Gerçek zamanlı durum** — Çalışıyor / giriş bekliyor göstergeleri ve oturumlar arası geçiş
- **Canlı oturum görünümü** — Mesajlar, araç çağrıları, görevler, izin istekleri ve thinking blokları
- **Codex sekmeleri** — Claude ile aynı tmux tabanlı kalıcılıkla Codex CLI oturumları başlatın
- **Oturum listesi** — Yakın tarihli Claude ve Codex oturumlarını tek birleşik görünümden inceleyin ve devam ettirin
- **Tek tıkla Resume** — Duraklatılmış Claude veya Codex oturumunu doğrudan tarayıcıdan devam ettirin
- **Otomatik Resume** — Sunucu başlatıldığında önceki Claude oturumlarını otomatik olarak kurtarır
- **Hızlı prompt'lar** — Sık kullanılan prompt'ları kaydedin ve tek tıkla gönderin
- **Ekler** — Sohbet alanına görseller bırakın veya dosya ekleyerek yolunu otomatik ekletin. Mobilde de çalışır
- **Mesaj geçmişi** — Önceki mesajları tekrar kullanın
- **Kullanım istatistikleri** — Claude + Codex token'ları, maliyet, proje bazlı kırılım, günlük AI raporları
- **Rate limit** — Desteklenen sağlayıcılar için 5 saat / 7 gün kalan kullanım ve sıfırlama geri sayımı

### Mobil ve erişilebilirlik

- **Duyarlı arayüz** — Telefon ve tablette terminal ile zaman tüneli
- **PWA** — Ana ekrana ekleyin, yerel uygulama hissi yaşayın
- **Web Push** — Sekme kapalıyken bile bildirim alın
- **Çoklu cihaz senkronizasyonu** — Çalışma alanı değişiklikleri gerçek zamanlı yansır
- **Tailscale** — WireGuard ile şifrelenmiş tünel üzerinden dışarıdan HTTPS erişimi
- **Parola doğrulaması** — scrypt ile hash'leme, dışarı açıldığında bile güvenli
- **Çok dilli** — 11 dil; aralarında 한국어, English, 日本語, 中文

## Desteklenen platformlar

| Platform | Durum | Notlar |
|---|---|---|
| macOS (Apple Silicon / Intel) | ✅ | Electron uygulaması dahil |
| Linux | ✅ | Electron yok |
| Windows | ❌ | Desteklenmiyor |

## Kurulum ayrıntıları

### Gereksinimler

- macOS 13+ veya Linux
- [Node.js](https://nodejs.org/) 20+
- [tmux](https://github.com/tmux/tmux)

Claude sekmeleri için gereklidir. Claude Code'u kurun ve Claude sekmesi başlatmadan önce giriş yapın:

```bash
curl -fsSL https://claude.ai/install.sh | bash
# veya Homebrew latest kanalıyla
brew install --cask claude-code@latest
```

Codex sekmeleri için isteğe bağlıdır. Codex CLI'ı kurun ve Codex sekmesi başlatmadan önce giriş yapın:

```bash
npm i -g @openai/codex
# veya
brew install --cask codex
```

### npx (en hızlısı)

```bash
npx purplemux@latest
```

### Global kurulum

```bash
npm install -g purplemux
purplemux
```

### CLI örnekleri

```bash
purplemux tab create -w WS -t codex-cli -n "fix auth"
purplemux tab create -w WS -t agent-sessions
```

### Kaynaktan çalıştırma

```bash
git clone https://github.com/subicura/purplemux.git
cd purplemux
pnpm install
pnpm build
pnpm start
```

Geliştirme modu:

```bash
pnpm dev
```

#### Log seviyesi

Genel seviyeyi `LOG_LEVEL` ile ayarlayın (varsayılan `info`).

```bash
LOG_LEVEL=debug pnpm dev
```

Yalnızca belirli modülleri açmak için `modül=seviye` çiftlerini virgülle ayırarak `LOG_LEVELS` içine yazın. Kullanılabilir seviyeler: `trace` / `debug` / `info` / `warn` / `error` / `fatal`.

```bash
# Sadece Claude Code hook davranışını debug ile izle
LOG_LEVELS=hooks=debug pnpm dev

# Birden fazla modülü birlikte
LOG_LEVELS=hooks=debug,status=warn pnpm dev
```

`LOG_LEVELS` içinde belirtilmeyen modüller `LOG_LEVEL` değerini kullanır.

## Dış erişim (Tailscale Serve)

```bash
tailscale serve --bg 8022
```

`https://<machine>.<tailnet>.ts.net` üzerinden erişin. Kapatmak için:

```bash
tailscale serve --bg off 8022
```

## Güvenlik

### Parola

İlk erişimde bir parola belirleyin. scrypt ile hash'lenip `~/.purplemux/config.json` içinde saklanır.

Sıfırlamak için `~/.purplemux/config.json` dosyasını silin ve yeniden başlatın — onboarding ekranı tekrar görünecektir.

### HTTPS

Varsayılan protokol HTTP'dir. Dışarı açarken mutlaka HTTPS kullanın:

- **Tailscale Serve** — WireGuard şifrelemesi ve otomatik sertifikalar
- **Nginx / Caddy** — WebSocket upgrade başlıklarını (`Upgrade`, `Connection`) iletmek zorunludur

### Veri dizini (`~/.purplemux/`)

| Dosya | Açıklama |
|---|---|
| `config.json` | Kimlik bilgileri (hash) ve uygulama ayarları |
| `workspaces.json` | Çalışma alanı düzenleri, sekmeler ve dizinler |
| `vapid-keys.json` | Web Push VAPID anahtarları (otomatik üretilir) |
| `push-subscriptions.json` | Push abonelik bilgileri |
| `hooks/` | Kullanıcı tanımlı hook'lar |

## Mimari

```
┌─────────────────────────────────────────────────────────────┐
│  Browser                                                    │
│  ┌───────────┐ ┌───────────┐ ┌──────────┐ ┌─────────────┐   │
│  │  xterm.js │ │ Timeline  │ │ Status   │ │ Multi-device│   │
│  │  Terminal │ │           │ │          │ │ Sync        │   │
│  └─────┬─────┘ └─────┬─────┘ └────┬─────┘ └──────┬──────┘   │
└────────┼─────────────┼────────────┼──────────────┼──────────┘
         │ws           │ws          │ws            │ws
         │/terminal    │/timeline   │/status       │/sync
         ▼             ▼            ▼              ▼
┌─────────────────────────────────────────────────────────────┐
│  Node.js Server (:8022)                                     │
│  ┌──────────┐  ┌───────────────┐  ┌─────────────────────┐   │
│  │ node-pty │  │ JSONL Watcher │  │ Status Manager      │   │
│  │ PTY↔WS   │  │ File watch →  │  │ Process tree +      │   │
│  │ Binary   │  │ Parse → Send  │  │ JSONL tail analysis │   │
│  └────┬─────┘  └───────┬───────┘  └──────────┬──────────┘   │
└───────┼────────────────┼─────────────────────┼──────────────┘
        ▼                ▼                     ▼
┌─────────────────────────────────────────────────────────────┐
│  System                                                     │
│  tmux (purple socket)         Agent CLIs                    │
│  ┌────────┐ ┌────────┐       ┌────────────────────────────┐ │
│  │Session1│ │Session2│  ...  │ Claude Code                │ │
│  │ (shell)│ │ (shell)│       │   ~/.claude/projects/*.jsonl │ │
│  └────────┘ └────────┘       │ Codex                      │ │
│                              │   ~/.codex/sessions/*.jsonl │ │
│                              └────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**Terminal G/Ç** — xterm.js, node-pty'ye WebSocket üzerinden bağlanır; node-pty ise tmux oturumlarına iliştirilir. İkili bir protokol stdin/stdout/resize işlemlerini backpressure kontrolüyle yürütür.

**Durum algılama** — Ajan olay hook'ları HTTP POST ile anında güncelleme gönderir. Claude Code `SessionStart`, `Stop` ve `Notification` kullanır; Codex `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop` ve `PermissionRequest` kullanır. Her 5–15 sn'de bir süreç ağacı kontrol edilir ve JSONL dosyalarının son 8 KB'si analiz edilir.

**Zaman tüneli** — `~/.claude/projects/` ve `~/.codex/sessions/` altındaki JSONL oturum loglarını izler, değişiklikte yeni satırları ayrıştırır ve yapılandırılmış girişleri tarayıcıya akıtır.

**tmux izolasyonu** — Mevcut tmux'unuzdan tamamen ayrı, özel bir `purple` soketi kullanır. Prefix tuşu yok, durum çubuğu yok.

**Otomatik kurtarma** — Sunucu başlatıldığında önceki Claude oturumları `claude --resume {sessionId}` ile geri yüklenir. Codex oturumları oturum listesinden veya `codex resume {sessionId}` ile devam ettirilebilir.

## License

[MIT](LICENSE)
