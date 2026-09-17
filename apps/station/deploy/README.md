# Deploy — automação do host (macOS / launchd)

Ficheiros de infraestrutura do host que **não** vivem no fluxo normal da app mas
que definem como a IT.FM se mantém no ar. Versionados aqui para a automação ser
reproduzível; o `com.itfm.news-generate.plist` é a cópia fiel do que está
instalado em produção (ajusta os caminhos absolutos se fizeres deploy noutro host).

## `com.itfm.news-generate.plist` — geração automática do boletim

LaunchAgent que corre `node --env-file=.env news-live.mjs generate` **de hora a
hora ao minuto :05**. O agente é propositadamente "burro" — a inteligência está no
`news-live.mjs`:

- **Auto-gate por hora**: só gera nas horas de geração de Lisboa (`GEN_HOURS =
  7, 10, 13, 16, 19, 22`); nas outras horas corre e sai sem gastar nada.
- **Hash-skip**: se o guião gerado for igual ao do último boletim, não repete o
  TTS (reaproveita o `noticias_live.mp3` atual).
- **Guarda de quota**: não gera se o saldo ElevenLabs for menor que o necessário
  + margem — mantém o ficheiro atual em vez de falhar no ar.

O *airing* do boletim é independente disto: é o injector Liquidsoap
(`liquidsoap/segments_mix.liq`) que o toca ao `:30` com ducking.

### Instalar / recarregar

```bash
# copiar para a pasta de LaunchAgents do utilizador
cp apps/station/deploy/com.itfm.news-generate.plist ~/Library/LaunchAgents/

# (re)carregar no domínio do utilizador
launchctl bootout  gui/$(id -u)/com.itfm.news-generate 2>/dev/null || true
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.itfm.news-generate.plist

# correr já uma vez (smoke test — sai 0 e faz no-op fora das GEN_HOURS)
launchctl kickstart -k gui/$(id -u)/com.itfm.news-generate
```

Log: `~/Library/Logs/com.itfm.news-generate.log`.

### ⚠️ Gotcha TCC — logs NÃO podem ficar no ~/Desktop

Este repo vive em `~/Desktop`, que é **protegido por TCC**. O
`StandardOutPath`/`StandardErrorPath` de um LaunchAgent é aberto pelo **próprio
launchd** (não pelo processo filho), e o launchd não tem acesso TCC ao Desktop —
apontar o log para lá faz o job inteiro falhar com `EX_CONFIG` (exit 78) e log
vazio, **antes** de o `node` sequer arrancar.

O processo filho (`node`) lê/escreve o Desktop sem problema (`WorkingDirectory`
no Desktop + ler `.env` funcionam). Só o *open* do ficheiro de log pelo launchd é
bloqueado. Por isso o log vive em `~/Library/Logs/` (fora do TCC). O mesmo se
aplica ao `cron` no macOS.
