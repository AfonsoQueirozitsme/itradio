# IT.FM — automação nativa no VPS (systemd)

O refresh diário da música corre **no próprio VPS**, contra o AzuraCast em
`http://localhost` — sem Mac e sem túneis SSH. O servidor está 24/7 no
datacenter e é autónomo.

- `itfm-music-daily.service` — oneshot: `node --env-file=.env music/daily-refresh.mjs`
  (por programa, em sequência: build trending → deploy in-place + rotação com teto).
- `itfm-music-daily.timer` — dispara às **05:00 hora de Lisboa** (DST tratado pelo
  systemd; margem antes da 1.ª janela às 07:00). `Persistent=true` recupera falhas.

## Instalar / atualizar (no VPS)

```bash
sudo cp /home/itradio/itradio/apps/station/systemd/itfm-music-daily.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now itfm-music-daily.timer
```

## Operar

```bash
systemctl status itfm-music-daily.timer         # próximo disparo
systemctl list-timers itfm-music-daily.timer    # agenda
sudo systemctl start itfm-music-daily.service    # correr já (manual)
journalctl -u itfm-music-daily.service -e         # logs (também em music/.daily.log)
tail -f /home/itradio/itradio/apps/station/music/.daily.log
```

Pré-requisitos no host (já provisionados): `ffmpeg`, `python3-venv`, e o venv em
`music/.venv` com `ytmusicapi` + `yt-dlp`. O `.env` vive em `apps/station/.env`
(gitignored) com a chave da API e `AZURACAST_BASE_URL=http://localhost`.
