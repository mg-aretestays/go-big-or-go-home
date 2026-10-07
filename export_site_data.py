"""Write docs/data.json for the public dashboard (GitHub Pages).

Usage:  python export_site_data.py [--weeks N]
Runs weekly in GitHub Actions; see .github/workflows/update-data.yml.
"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from build_gbgh_2026 import (FP_POSITIONS, SEASON, load_fantasypros, league_owners,
                             load_season, player_totals)

OUT = Path(__file__).with_name("docs") / "data.json"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weeks", type=int)
    args = ap.parse_args()
    league, weeks, reg_weeks, order, teams = load_season(args.weeks)

    team_rows = []
    for t in order:
        team_rows.append({
            "rid": t["rid"], "handle": t["handle"], "name": t["team_name"], "place": t["place"],
            "w": t["w"], "l": t["l"], "t": t["t"], "pf": t["pf"], "pa": t["pa"],
            "pfAvg": t["pf_avg"], "paAvg": t["pa_avg"], "diffAvg": t["diff_avg"],
            "pfRank": t["pf_rank"], "paRank": t["pa_rank"],
            "apW": t["ap_w"], "apL": t["ap_l"], "expW": t["exp_w"],
            "luck": t["luck"], "topHalf": t["top_half"],
            "games": {str(wk): {"pts": g["pts"], "opp": g["opp"], "oppPts": g["opp_pts"],
                                "result": g["result"], "rank": g["rank"], "oppRank": g["opp_rank"],
                                "luck": t["luck_events"].get(wk)}
                      for wk, g in t["games"].items()},
        })

    fp = load_fantasypros(weeks)
    owners = league_owners(teams)
    players = {}
    for pos in FP_POSITIONS:
        cols = fp[pos]["cols"]
        players[pos] = {
            "cols": [{"group": g, "name": n} for g, n in cols],
            "weekly": [[r["week"], r["team"], r["player"]] + [r["stats"].get(c) for c in cols]
                       for r in fp[pos]["rows"]],
            "season": sorted(({"player": t["player"], "team": t["team"], "g": t["g"],
                               "fpts": t["fpts"], "ppg": t["ppg"], "owner": t["owner"]}
                              for t in player_totals(fp, owners, pos).values()),
                             key=lambda t: -t["fpts"]),
        }

    data = {
        "league": {"name": league["name"], "season": SEASON, "weeks": weeks,
                   "regWeeks": reg_weeks, "updated": datetime.now(timezone.utc).isoformat(timespec="minutes")},
        "teams": team_rows,
        "players": players,
    }
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {OUT} ({OUT.stat().st_size // 1024} KB, weeks {weeks[0]}-{weeks[-1]})")


if __name__ == "__main__":
    main()
