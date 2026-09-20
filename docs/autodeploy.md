# Autodeploy da landing (self-hosted GitHub Actions runner)

Push no `main` que toque em `apps/landing/**` → o runner no VPS faz
`git reset --hard` para o commit, `npm ci`, `npm run build` e reinicia o serviço.
Workflow: [`.github/workflows/deploy-landing.yml`](../.github/workflows/deploy-landing.yml).

## ⚠️ Segurança — repositório PÚBLICO

Runner self-hosted + repo público é uma combinação sensível: um workflow que corra
a partir de um fork poderia executar código arbitrário na máquina do runner. Mitigações
(todas obrigatórias):

1. **O workflow dispara só em `push` no `main`** (nunca `pull_request`) → forks não o
   acionam. Reforçado por `if: github.repository == 'AfonsoQueirozitsme/itradio'`.
2. **Settings → Actions → General → Fork pull request workflows**: exigir aprovação
   (por defeito já exige para first-time contributors; endurecer para todos os forks).
3. **Runner num grupo restrito** a este repositório (Settings → Actions → Runner groups),
   nunca partilhado com a organização.
4. **Runner sem privilégios**: corre como um utilizador dedicado (ex. `itdeploy`), com
   `sudo` limitado por NOPASSWD **apenas** ao restart do serviço da landing.

## Registo do runner (no VPS)

```bash
# como utilizador dedicado, ex. itdeploy
cd ~ && mkdir actions-runner && cd actions-runner
curl -o actions-runner-linux-x64.tar.gz -L \
  https://github.com/actions/runner/releases/latest/download/actions-runner-linux-x64.tar.gz
tar xzf actions-runner-linux-x64.tar.gz

# token de registo (gera-se via UI ou:)
#   gh api -X POST repos/AfonsoQueirozitsme/itradio/actions/runners/registration-token
./config.sh --url https://github.com/AfonsoQueirozitsme/itradio \
  --labels itfm-vps --name itfm-vps-landing --unattended --replace \
  --token <REGISTRATION_TOKEN>

sudo ./svc.sh install itdeploy
sudo ./svc.sh start
```

## Ambiente que o runner precisa

Definir para o serviço do runner (ex. em `~/actions-runner/.env`, lido pelo runner):

| Variável | Exemplo | Para quê |
|---|---|---|
| `ITFM_LANDING_DIR` | `/opt/itradio` | raiz do clone de onde a landing corre |
| `ITFM_LANDING_RESTART` | `sudo systemctl restart itfm-landing` | comando de restart (opcional — senão auto-deteta systemd/pm2) |

O deploy faz `git reset --hard` na `$ITFM_LANDING_DIR`, portanto essa árvore deve ser
um clone dedicado ao deploy (sem alterações locais por commitar).

## sudoers mínimo (se restart via systemd)

```
itdeploy ALL=(root) NOPASSWD: /bin/systemctl restart itfm-landing
```
