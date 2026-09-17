#!/usr/bin/env python3
"""
select_tracks.py — seleção de faixas *trending por género* via ytmusicapi (SEM auth).

Fluxo (robusto p/ a API pública, sem auth):
  YTMusic()  →  search(<género>, filter="playlists")  → apanha as playlists
  curadas/trending do género (ex.: "Electronic Dance Music 2026", "Deep House
  2026")  →  get_playlist(id) de cada uma  →  faixas.  Filtra por duração
  [--min-dur, --max-dur], remove duplicados e os videoIds em --exclude (histórico
  de rotação).  Tenta --genre e depois cada --alts por ordem.
  Fallbacks: search(..., filter="songs") e, por fim, get_charts(country).

  (NOTA: get_mood_categories/get_mood_playlists existe mas está partido na API
  pública do YT Music — get_mood_playlists rebenta a fazer parse de playlists sem
  navigationEndpoint. Por isso usamos search, que é estável sem auth.)

Saída: JSON `[{"videoId","title","artist","dur"}]` em STDOUT (só isto — os
diagnósticos vão para STDERR, para o music-build.mjs poder fazer JSON.parse).

Uso:
  python3 select_tracks.py --genre "Electronic" --n 8
  python3 select_tracks.py --genre "Feel Good" --alts "Pop,Energy Boosters" --n 20 \
                    --min-dur 120 --max-dur 360 --exclude history.json
"""
import argparse
import json
import sys


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def parse_dur(track):
    """Duração em segundos a partir de duration_seconds ou 'm:ss'."""
    ds = track.get("duration_seconds")
    if isinstance(ds, int) and ds > 0:
        return ds
    d = track.get("duration")
    if isinstance(d, str) and ":" in d:
        try:
            parts = [int(x) for x in d.split(":")]
            s = 0
            for p in parts:
                s = s * 60 + p
            return s
        except ValueError:
            return 0
    return 0


def track_artist(track):
    arts = track.get("artists") or []
    names = [a.get("name", "").strip() for a in arts if a.get("name")]
    return ", ".join([n for n in names if n]) or "Vários"


def add_track(out, t, want, min_dur, max_dur, exclude, seen):
    """Valida e acrescenta uma faixa a `out`. Devolve True se ficou completo."""
    vid = t.get("videoId")
    if not vid or vid in seen or vid in exclude:
        return len(out) >= want
    dur = parse_dur(t)
    if dur and (dur < min_dur or dur > max_dur):
        return len(out) >= want
    seen.add(vid)
    out.append({"videoId": vid, "title": (t.get("title") or "").strip(),
                "artist": track_artist(t), "dur": dur})
    return len(out) >= want


def playlist_id(entry):
    """search(filter=playlists) devolve browseId 'VL<pid>'; get_playlist quer '<pid>'."""
    pid = entry.get("browseId") or entry.get("playlistId") or ""
    return pid[2:] if pid.startswith("VL") else pid


def collect_from_search_playlists(yt, label, want, min_dur, max_dur, exclude, seen, out,
                                  max_playlists=8, per_playlist=100):
    try:
        results = yt.search(label, filter="playlists", limit=max_playlists) or []
    except Exception as e:  # noqa: BLE001
        log(f'  ! search(playlists, "{label}") falhou: {e}')
        return
    log(f'  {len(results)} playlists p/ "{label}"')
    for r in results:
        if len(out) >= want:
            break
        pid = playlist_id(r)
        if not pid:
            continue
        try:
            detail = yt.get_playlist(pid, limit=per_playlist)
        except Exception as e:  # noqa: BLE001
            log(f'  ! get_playlist({pid}) falhou: {e}')
            continue
        before = len(out)
        for t in detail.get("tracks", []) or []:
            if add_track(out, t, want, min_dur, max_dur, exclude, seen):
                break
        log(f'    · "{(r.get("title") or "")[:48]}" → +{len(out) - before}')


def collect_from_search_songs(yt, label, want, min_dur, max_dur, exclude, seen, out, limit=40):
    try:
        results = yt.search(label, filter="songs", limit=limit) or []
    except Exception as e:  # noqa: BLE001
        log(f'  ! search(songs, "{label}") falhou: {e}')
        return
    before = len(out)
    for t in results:
        if add_track(out, t, want, min_dur, max_dur, exclude, seen):
            break
    log(f'  search songs "{label}" → +{len(out) - before}')


def collect_from_charts(yt, country, want, min_dur, max_dur, exclude, seen, out):
    try:
        charts = yt.get_charts(country)
    except Exception as e:  # noqa: BLE001
        log(f"  ! get_charts({country}) falhou: {e}")
        return
    buckets = []
    for key in ("songs", "videos", "trending"):
        node = charts.get(key) if isinstance(charts, dict) else None
        items = node.get("items") if isinstance(node, dict) else node
        if isinstance(items, list):
            buckets.extend(items)
    before = len(out)
    for t in buckets:
        if add_track(out, t, want, min_dur, max_dur, exclude, seen):
            break
    log(f"  charts {country} → +{len(out) - before}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--genre", required=True, help="rótulo primário a procurar (search playlists)")
    ap.add_argument("--alts", default="", help="rótulos alternativos, separados por vírgula")
    ap.add_argument("--n", type=int, default=20, help="nº de faixas a devolver")
    ap.add_argument("--min-dur", type=int, default=120)
    ap.add_argument("--max-dur", type=int, default=360)
    ap.add_argument("--exclude", default="", help="ficheiro JSON com lista de videoIds a saltar (histórico)")
    ap.add_argument("--country", default="PT", help="país p/ o fallback de charts")
    args = ap.parse_args()

    try:
        from ytmusicapi import YTMusic
    except ImportError:
        log("ERRO: ytmusicapi não instalado. Corre: music/.venv/bin/pip install ytmusicapi")
        sys.exit(3)

    exclude = set()
    if args.exclude:
        try:
            with open(args.exclude, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            exclude = set(data if isinstance(data, list) else data.get("videoIds", []))
            log(f"histórico: {len(exclude)} videoIds a evitar")
        except FileNotFoundError:
            pass
        except Exception as e:  # noqa: BLE001
            log(f"! histórico ilegível ({e}) — ignorado")

    try:
        yt = YTMusic()  # sem auth
    except Exception as e:  # noqa: BLE001
        log(f"ERRO: YTMusic() falhou ({e}). Rede? Pode precisar de cookie de visitante (ytmusicapi browser).")
        sys.exit(4)

    labels = [args.genre] + [a.strip() for a in args.alts.split(",") if a.strip()]
    seen = set()
    tracks = []

    # 1) via playlists de search (fonte principal — curadas/trending por género)
    for lab in labels:
        if len(tracks) >= args.n:
            break
        collect_from_search_playlists(yt, lab, args.n, args.min_dur, args.max_dur, exclude, seen, tracks)

    # 2) fallback: songs de search por género
    if len(tracks) < args.n:
        log(f"playlists deram {len(tracks)}/{args.n} — completo com search songs")
        for lab in labels:
            if len(tracks) >= args.n:
                break
            collect_from_search_songs(yt, lab, args.n, args.min_dur, args.max_dur, exclude, seen, tracks)

    # 3) último recurso: charts do país
    if len(tracks) < args.n:
        log(f"ainda {len(tracks)}/{args.n} — último recurso: charts ({args.country})")
        collect_from_charts(yt, args.country, args.n, args.min_dur, args.max_dur, exclude, seen, tracks)

    tracks = tracks[: args.n]
    log(f"→ {len(tracks)} faixas selecionadas")
    json.dump(tracks, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
