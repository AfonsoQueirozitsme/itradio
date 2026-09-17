# Serviço de música — IT.FM

Seleciona música *trending por género* (via `ytmusicapi`, sem auth), descarrega
(`yt-dlp`), normaliza ao som da estação (−16 LUFS, sem polimento de voz) e
publica no AzuraCast — **um género por programa**. Assenta no core `../lib/`.

- **`select_tracks.py`** (Mac, python) — género → mood category → playlists trending →
  faixas `{videoId,title,artist,dur}`, filtradas por duração e sem o histórico.
  JSON em stdout; diagnósticos em stderr.
- **`music-build.mjs`** (Mac) — corre o `select_tracks.py`, faz `yt-dlp` de cada faixa,
  normaliza via `lib/audio` a −16 LUFS + tags, escreve `build-music/musica/<slug>/`
  e atualiza `manifest.json` + `.rotation.json` (histórico, evita repetir).
- **`music-deploy.mjs`** (host) — cria/atualiza a playlist por programa e atribui
  os mp3. **Não-destrutivo**: nunca apaga nada nem toca no injector de notícias;
  restart do backend só quando cria uma playlist nova.

A verdade dos programas (slug, janela, género `ytGenre`) vive em `../lib/programs.mjs`.

## Setup (uma vez, no Mac)

```bash
python3 -m venv apps/station/music/.venv
apps/station/music/.venv/bin/pip install -U pip -r apps/station/music/requirements.txt
```

`music-build.mjs` usa `.venv/bin/python` e `.venv/bin/yt-dlp` automaticamente
(ou os binários em `MUSIC_PYTHON` / `MUSIC_YTDLP` / no PATH).

## Fluxo ponta-a-ponta

```bash
# 1) seleção pura (debug) — imprime o JSON de faixas
apps/station/music/.venv/bin/python apps/station/music/select_tracks.py --genre "Electronic" --n 8

# 2) build de 1 faixa (prova o pipeline: baixa, normaliza, mede LUFS ≈ -16)
node apps/station/music/music-build.mjs --slug sofia_martins --limit 1 --dry-run

# 3) build do pool completo do programa
node apps/station/music/music-build.mjs --slug sofia_martins

# 4) rsync build-music/ → host (mesmo workflow do build-programacao)

# 5) deploy — dry-run mostra playlists/janelas/colisões; --yes aplica
node --env-file=.env apps/station/music/music-deploy.mjs --slug sofia_martins
node --env-file=.env apps/station/music/music-deploy.mjs --slug sofia_martins --yes
```

## Tabela género ↔ programa

Definida em `../lib/programs.mjs` (`ytGenre` + `ytGenreAlts`). Editável:

| Programa | slug | janela | ytGenre |
|---|---|---|---|
| Boot Matinal | diogo_silva | 07–10 | Feel Good |
| Ctrl+Alt+Ritmo | sofia_martins | 10–13 | Dance & Electronic |
| Pause & Play | tomas_rocha | 13–16 | Indie & Alternative |
| Hora de Ponta | beatriz_lima | 16–20 | Hip-Hop |
| Modo Noturno | goncalo_pires | 20–23 | R&B & Soul |

> **Licenciamento:** difundir áudio do YouTube exige licença de música (SPA/PPL em
> Portugal). A ferramenta é legítima; o licenciamento é responsabilidade operacional.
