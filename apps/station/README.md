# itFM — Sistema de emissão (AzuraCast)

Deploy do [AzuraCast](https://github.com/AzuraCast/AzuraCast) via Docker para a **itFM**.
Não vendorizamos o código-fonte: corremos a imagem oficial `ghcr.io/azuracast/azuracast`.

## Ficheiros

| Ficheiro | Descrição | Versionado? |
|---|---|---|
| `docker-compose.yml` | Compose oficial do AzuraCast (não editar; usa `docker-compose.override.yml` para customizar) | sim |
| `cloudflared.yml` | Stack do túnel Cloudflare (domínio público) | sim |
| `dc.sh` | Wrapper que deteta `docker compose` (v2) ou `docker-compose` | sim |
| `provision.mjs` | (Re)cria a grelha da estação via API (idempotente) | sim |
| `audio/horas/`, `audio/segmentos/` | Clips versionados (anúncios de hora + segmentos) | sim |
| `audio/musica/` | Músicas da rotação geral (sobe as tuas aqui) | **não** (gitignored) |
| `azuracast.env.example` | Config da aplicação (DB, PHP, Redis…) — template | sim |
| `azuracast.env` | Cópia local com a `MYSQL_PASSWORD` real | **não** (gitignored) |
| `.env.example` | Variáveis de deploy do host (versão, portas, token do túnel) — template | sim |
| `.env` | Cópia local do `.env.example` com os teus valores | **não** (gitignored) |

## Grelha de programação

Provisionada por `provision.mjs`, misturada com a rotação geral de música:

- **Topo de hora (:00)** — `audio/horas/N.mp3` toca ao minuto 0 da hora `N`.
  Configuradas as horas **07–14** e **16–23** (faltam ficheiros para 00–06 e 15).
- **Segmentos (:30)** — `once_per_hour`, `interrupt + single_track`:
  - **Trânsito** → 07, 09, 14, 17
  - **Meteo** → 08, 11, 13, 15, 18, 20, 22
  - **Tech ao Minuto** → 10, 12, 16, 19, 21, 23
- **Jingles** — `once_per_x_minutes`, `interrupt + single_track`:
  - **Jingle 1** → a cada 3 min (`audio/jingles/jingle_1.mp3`)

Para mudar a grelha, edita as constantes `HOUR_FILES` e `SEGMENTS` no topo de
[`provision.mjs`](provision.mjs) e corre `npm run station:provision` outra vez.

## Provisionar (recriar tudo num AzuraCast novo)

Com o AzuraCast a correr e uma API key de admin da estação:

```bash
AZURACAST_BASE_URL=http://localhost:8080 \
AZURACAST_API_KEY=identifier:verifier \
STATION_SHORTCODE=it.fm \
npm run station:provision
```

É **idempotente**: cria só o que falta, sobe clips em falta e reinicia a estação.

## Arranque

A partir da **raiz do monorepo**:

```bash
npm run station:up      # docker compose up -d
npm run station:logs    # segue os logs do painel
npm run station:down    # pára os containers
npm run station:pull    # atualiza a imagem
```

Ou diretamente nesta pasta (o wrapper deteta a versão do compose):

```bash
cp .env.example .env              # primeira vez
cp azuracast.env.example azuracast.env
bash dc.sh up -d
```

## Primeiro acesso

1. Abre `http://localhost` (ou a `AZURACAST_HTTP_PORT` que definiste no `.env`).
2. Segue o assistente de setup para criar o utilizador admin e a primeira estação (itFM).
3. Media/estações ficam em volumes Docker geridos (`station_data`, `db_data`, etc.) — persistem entre reinícios.

## Portas

- **80/443** — painel web + streams (configurável no `.env`).
- **2022** — SFTP para upload de media.
- **8000–8499** — portas atribuídas automaticamente aos streams das estações.

> Em dev, se a porta 80 já estiver ocupada, muda `AZURACAST_HTTP_PORT` no `.env` (ex.: `8080`).

## Atualizações

O container `updater` (Watchtower) trata das atualizações. Para atualizar manualmente:

```bash
npm run station:pull && npm run station:up
```

Documentação oficial: https://www.azuracast.com/docs/
