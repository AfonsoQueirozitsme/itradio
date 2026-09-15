#!/usr/bin/env bash
#
# Wrapper de Docker Compose portável.
# Deteta se está disponível o plugin v2 (`docker compose`, standard no Ubuntu)
# ou o binário standalone antigo (`docker-compose`), e usa o que existir.
#
# Uso: bash apps/station/dc.sh <args de compose...>
#   ex.: bash apps/station/dc.sh up -d
#
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Ficheiro de compose (override via DC_FILE, ex.: cloudflared.yml).
COMPOSE_FILE="$DIR/${DC_FILE:-docker-compose.yml}"
ENV_FILE="$DIR/.env"

if docker compose version >/dev/null 2>&1; then
  DC=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DC=(docker-compose)
else
  echo "ERRO: nem 'docker compose' (plugin v2) nem 'docker-compose' encontrados." >&2
  echo "Instala o Docker Engine + Compose plugin: https://docs.docker.com/engine/install/ubuntu/" >&2
  exit 1
fi

ARGS=(-f "$COMPOSE_FILE")
[ -f "$ENV_FILE" ] && ARGS+=(--env-file "$ENV_FILE")

exec "${DC[@]}" "${ARGS[@]}" "$@"
