# IT Rádio — monorepo

Monorepo da **Radio IT / itFM**:

| App | Pasta | O quê |
|-----|-------|-------|
| **Landing** | [`apps/landing`](apps/landing) | Site Next.js com o hero e o leitor ao vivo |
| **Station** | [`apps/station`](apps/station) | Sistema de emissão AzuraCast (Docker) + provisionamento da grelha |

Gerido com **npm workspaces**.

---

## Requisitos (Ubuntu)

```bash
# Node 20+ e npm
sudo apt-get update && sudo apt-get install -y nodejs npm

# Docker Engine + Compose plugin (método oficial)
# https://docs.docker.com/engine/install/ubuntu/
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # depois faz logout/login
```

---

## Arranque plug-and-play (do zero, num Ubuntu limpo)

```bash
git clone https://github.com/AfonsoQueirozitsme/itradio.git
cd itradio
npm install
```

### 1. Emissão (AzuraCast)

```bash
cd apps/station
cp .env.example .env                 # ajusta portas se precisares
cp azuracast.env.example azuracast.env   # define uma MYSQL_PASSWORD forte
cd ../..

npm run station:up                   # sobe o AzuraCast (demora ~1-2 min na 1ª vez)
```

Abre `http://SERVIDOR:8080` e conclui o **wizard inicial** (cria a conta de admin).
No wizard cria a estação com o *short name* **`it.fm`** (ou usa outro e passa-o via
`STATION_SHORTCODE` no passo seguinte).

Depois cria uma **API key** (Perfil → API Keys) e provisiona a grelha toda:

```bash
AZURACAST_BASE_URL=http://localhost:8080 \
AZURACAST_API_KEY=identifier:verifier \
npm run station:provision
```

Isto cria — de forma idempotente — as playlists dos **anúncios de topo de hora**, os
**segmentos ao minuto :30** (Trânsito / Meteo / Tech ao Minuto) e sobe os clips de
[`apps/station/audio`](apps/station/audio). A grelha exata está documentada em
[`apps/station/README.md`](apps/station/README.md).

**Música da rotação geral:** copia os ficheiros para `apps/station/audio/musica/`
(não versionados) **antes** de provisionar — o script sobe-os e mete-os na
playlist "Rotação Geral". Ou sobe-os pelo painel.

### 2. Landing (site)

```bash
cd apps/landing
cp .env.example .env.local           # aponta NEXT_PUBLIC_STREAM_URL ao teu stream
cd ../..

npm run dev                          # dev em http://localhost:3000
# produção:
npm run build && npm run start
```

---

## Domínio via túnel Cloudflare

Sem abrir portas no router. Ver instruções detalhadas no topo de
[`apps/station/cloudflared.yml`](apps/station/cloudflared.yml). Resumo:

1. Cloudflare Zero Trust → Networks → Tunnels → cria túnel, copia o **token**.
2. Public hostname → `radio.oteudominio.pt` → serviço `HTTP` → `localhost:8080`.
3. `CLOUDFLARE_TUNNEL_TOKEN=...` em `apps/station/.env`.
4. `npm run station:tunnel`.
5. No AzuraCast (Administração → Definições) define a **Base URL** pública e ativa HTTPS.
6. Atualiza `NEXT_PUBLIC_STREAM_URL` da landing para
   `https://radio.oteudominio.pt/listen/it.fm/radio.mp3`.

---

## Scripts (raiz)

| Script | Efeito |
|--------|--------|
| `npm run dev` | Landing em modo dev |
| `npm run build` / `npm run start` | Build / servir a landing |
| `npm run station:up` / `station:down` | Sobe / desce o AzuraCast |
| `npm run station:logs` | Logs do AzuraCast |
| `npm run station:pull` | Atualiza a imagem do AzuraCast |
| `npm run station:provision` | (Re)cria a grelha da estação via API |
| `npm run station:backup` | Backup oficial do AzuraCast |
| `npm run station:tunnel` / `station:tunnel:down` | Túnel Cloudflare |

Os scripts de estação detetam automaticamente `docker compose` (v2) ou `docker-compose`.
