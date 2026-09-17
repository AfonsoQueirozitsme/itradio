# Mega plano — IT.FM como plataforma modular (news + música)

## Contexto

Hoje o `apps/station/` é um conjunto de scripts Node ESM (`.mjs`) executados
diretamente (sem TypeScript, sem build step), num monorepo npm workspaces. A
música entra **à mão**: mp3 colocados em `~/Downloads/AudioNovo/Musicas/{SoftRock,House:EDM}`,
e o "género" existe apenas como o campo `genero` (rock/house) de cada programa
em `build-programacao.mjs:59-65`, partilhado entre programas.

O serviço de **notícias LIVE** já está construído e testado localmente
(`news/format-news.mjs` + `news/news-live.mjs`): boletins a duas vozes clonadas,
−16 LUFS, gerados de 3 em 3h e tocados de hora a hora ao :30.

Objetivo: transformar o repo num conjunto de **módulos/serviços** sobre um
**core partilhado**, e adicionar um **serviço de música** que seleciona
_trending por género_ (via `ytmusicapi`), descarrega (via `yt-dlp`), normaliza
ao som da estação e publica no AzuraCast — **um género por programa**.

## Arquitetura alvo

```
apps/station/
  lib/                    # CORE partilhado (extraído da duplicação atual)
    audio.mjs             # NORM, POLISH, TRIM, measureLoud, normToWav, buildBlock, Work(local|docker)
    azuracast.mjs         # api, resolveSid, sched, uploadInPlace, filesBatch, playlist CRUD, restart
    env.mjs               # carrega .env; nomes/validação de env vars
    programs.mjs          # FONTE ÚNICA dos programas (slug, nome, genero, janela) — hoje inline no build
  news/                   # serviço 1 (FEITO) — mover format-news.mjs + news-live.mjs
  music/                  # serviço 2 (NOVO)
    select.py             # ytmusicapi: género → playlist trending → faixas (videoId,title,artist,dur) → JSON
    music-build.mjs       # Mac: select.py → yt-dlp → normalize(lib/audio) → build/musica/<slug>/ + manifest
    music-deploy.mjs      # host: garante playlist por programa + files/batch (+ restart só se nova)
  build/                  # gitignored: musica/<slug>/*.mp3, manifest.json (+ secção music)
  .env                    # partilhado (gitignored)
```

Nota: `lib/` com imports relativos (estilo atual) em vez de um package em
`packages/*` — zero fricção, sem workspace-linking, corre com `node` direto.
`packages/@it-radio/station-core` fica como opção futura se quisermos publicar.

## Serviço de música — pipeline

1. **`lib/programs.mjs`** — cada programa: `{ slug, nome, genero, ytGenre, inicio, fim, poolSize, minDur, maxDur }`.
   Passa a ser a fonte única (o `build-programacao.mjs` importa daqui em vez do array inline).
2. **`select.py` (Mac, python3)** — `YTMusic()` **sem auth**:
   `get_mood_categories()` → secção **"Genres"** → escolhe o género do programa →
   `get_mood_playlists(params)` → `get_playlist(playlistId)` → faixas.
   Filtra por duração (120–360 s), remove duplicados vs histórico de rotação,
   devolve JSON `[{videoId,title,artist,dur}]` (poolSize itens). Alternativa/mistura: `get_charts(country)`.
3. **`music-build.mjs` (Mac)** — lê o JSON →
   `yt-dlp -x --audio-format mp3 --audio-quality 0 -o "<slug>/%(id)s.%(ext)s" "https://www.youtube.com/watch?v=<id>"` →
   normaliza via `lib/audio` a **−16 LUFS** (música **NÃO** leva POLISH nem TRIM — igual ao build atual) →
   escreve tags (artist/title/genre/programa) → `build/musica/<slug>/<id>.mp3` →
   atualiza `manifest.json` + histórico de rotação (evita repetir na próxima).
4. **rsync `build/` → host** (workflow manual atual, igual ao build-programacao).
5. **`music-deploy.mjs` (host)** — garante uma playlist por programa
   (`type:"default"`, `order:"shuffle"`, `schedule_items: sched(inicio, fim)`),
   `PUT /files/batch` para atribuir os mp3, **restart só se criou playlist nova**
   (refrescar media numa playlist existente é in-place, sem restart — como o `push-blocks`/news `generate`).
6. **Retenção/rotação** — o manifesto guarda o que já entrou; expira ficheiros
   além de _N_ dias ou acima de um teto de disco; a próxima seleção evita repetidos.
7. **Automação** — cron/launchd no Mac (build) + gatilho de deploy no host.
   Fase futura opcional: correr tudo no host (yt-dlp + `docker exec` ffmpeg, como as news).

## Tabela género ↔ programa (proposta — editável)

| Programa | slug | janela | hoje | proposta (ytmusicapi Genres/Moods) |
|---|---|---|---|---|
| Boot Matinal | diogo_silva | 07–10 | rock | Feel Good / Pop (arranque animado) |
| Ctrl+Alt+Ritmo | sofia_martins | 10–13 | rock | Electronic / Dance |
| Pause & Play | tomas_rocha | 13–16 | house | Indie & Alternative / Chill |
| Hora de Ponta | beatriz_lima | 16–20 | house | Hip-Hop / Hits (hora de ponta) |
| Modo Noturno | goncalo_pires | 20–23 | house | Deep House / R&B / Lo-fi (noite) |

## Reaproveitamento (não reinventar)

- `lib/audio.mjs` ← extrair de `build-programacao.mjs` (`NORM :48`, `POLISH :52`, `TRIM :57`, `measureLoud :134`, `normToWav :150`, `buildBlock :219`) + a classe `Work` local|docker de `news-live.mjs:209`.
- `lib/azuracast.mjs` ← `api/resolveSid/sched/uploadInPlace` + `POST /playlists`, `PUT /playlist/{id}`, `PUT /files/batch`, `POST /restart` (idênticos em `deploy-programacao.mjs`, `tuga-deploy.mjs`, `news-live.mjs`).
- Padrão de módulo = **Tuga** (`build-programacao.mjs:84-96` + `tuga-deploy.mjs`).
- Convenção de paths de media = `musica/<slug>/`, `manifest.json` (já existe).

## Ordem de execução (fases)

- **Fase 0 — News go-live** (já indicaste "deploy agora"; confirmo o timing):
  `probe` → `generate --force` (1.ª geração real, gasta quota) → `setup --yes` (playlist :30 + **1 restart**) → verificar no ar → cron. Serviço já pronto.
- **Fase 1 — Core**: extrair `lib/{audio,azuracast,env,programs}.mjs`; refactor de `news-live.mjs` e `build/deploy-programacao.mjs` para importar (sem mudança de comportamento). Sem restart.
- **Fase 2 — Música (fetch)**: `music/` com `select.py` + `music-build.mjs` + `music-deploy.mjs`; provar **não-destrutivo** num só género.
- **Fase 3 — Géneros por programa**: expandir `programs.mjs`, criar playlists por programa em `deploy-programacao` (restart), música curada pelo serviço.
- **Fase 4 — Automação/retenção/docs**: cron Mac+host, rotação, atualizar READMEs.

## Fase 3 — cedência (música ⇄ IDs de hora ⇄ notícias)

**Verificado (read-only) no liquidsoap gerado + `ConfigWriter.php` do AzuraCast (2026-09-17).**
O AzuraCast constrói o `radio` por **camadas** (cada `radio = …` embrulha a anterior;
a de cima tem prioridade). Da base para o topo:

1. `random([...])` — playlists **Standard sem agenda** = rotação geral (`default`, `Rotação Geral`).
2. **Standard Schedule Switches** (`track_sensitive=true`) — Standard **agendadas e não-interrupt**.
3. *special* — `once_per_x_minutes`/`songs` sem agenda (ex.: `Jingle 1` = `delay(180.)`).
4. **Interrupting Schedule Switches** (`track_sensitive=false`) — playlists com `backend_options` a incluir `"interrupt"` (os IDs `Hora NN`, `once_per_hour`, `at_most(1,{0m…})`).
5. injector `segments_mix.liq` (`radio = mixed`) — faz **ducking** de TUDO para o clip :30.

A distinção interrupt/não-interrupt é o campo `backend_options`:
`["interrupt","single_track"]` → camada 4 (topo); `[]`/`[""]` → não-interrupt.

**Desenho:** cada programa recebe uma playlist **`type=default` (Standard), agendada à
sua janela, `backend_options=[]` (não-interrupt)** → cai na **camada 2**. Consequências,
sem tocar no injector nem na ordenação:

- **Substitui a rotação geral** só dentro da janela (fora, o switch cai em `({true}, radio)`).
- **Cede aos IDs de topo de hora**: a camada 4 (interrupt, `track_sensitive=false`) corta ao
  `:00`, toca 1 ID (`at_most 1`) e devolve logo à música do programa.
- **Cede às notícias/segmentos :30**: o injector (camada 5) faz ducking por cima de tudo.
- **Cobertura**: programas 07–23 contíguos; 23–07 (noite, sem notícias) cai na rotação geral.

**Conflito real** (a resolver antes do `--yes`) = só outra playlist de **música** (`type=default`,
ativa, não-interrupt) agendada na mesma janela — duas camas a competir. `music-deploy.mjs`
distingue isto de coexistência-por-design (IDs, jingles, playlists `off`) e **aborta** se houver
conflito real. Os IDs `Hora NN` e as `Meteo/Tech` (interrupt/`off`) **não** são conflito.

## Riscos / decisões

- **Motor de download:** `yt-dlp` (recomendado — robusto, mantido) vs `youtube-download-cli` (assenta em `pytube`, que parte com frequência).
- **Licenciamento de difusão** (SPA/PPL em Portugal): difundir áudio do YouTube exige licença de música — a ferramenta é legítima, o licenciamento é responsabilidade operacional tua. Sinalizo, não bloqueio.
- **Python só no Mac** (build-step): host não precisa de python/ffmpeg para música. `yt-dlp` + `ffmpeg` têm de estar no Mac.
- **`ytmusicapi` sem auth** pode precisar de cookie de visitante ocasional; fallback = `ytmusicapi browser` (headers auth).

## Verificação (fim-a-fim)

1. `python3 music/select_tracks.py --genre "Dance & Electronic" --n 8` → imprime JSON de faixas. ✓
2. `node music/music-build.mjs --slug sofia_martins --dry-run --limit 1` → baixa 1 faixa, normaliza, mede LUFS (≈ −16). ✓ (mediu −15.81)
3. `node --env-file=.env music/music-deploy.mjs --slug sofia_martins` (sem `--yes`) → plano + cedência + conflitos, nada aplicado. ✓
4. Deploy real num programa → confirmar no `liquidsoap.liq` gerado que a "Música …" está em *Standard Schedule Switches* (não *Interrupting*), ouvir no ar (ID ao `:00`, notícias ao `:30`), confirmar rotação no manifesto.
