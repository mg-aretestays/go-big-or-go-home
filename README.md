# Go Big or Go Home – 2026 dashboard

Standings, scoring heat map, weekly results and player stats for the Go Big or Go Home Sleeper league.

- **Live page:** served by GitHub Pages from `docs/`.
- **Data:** league results from the [Sleeper API](https://docs.sleeper.com/); player stats from [FantasyPros](https://www.fantasypros.com/nfl/stats/qb.php) (half PPR; TEs full PPR, matching the league's 0.5 TE reception bonus).
- **Updates:** `.github/workflows/update-data.yml` runs `export_site_data.py` every Tuesday morning (after Monday Night Football) and again Friday morning (to pick up NFL stat corrections), and commits `docs/data.json`. Later backup runs on both days cover a run GitHub drops; they commit nothing when the data is already current. Use **Actions → Update league data → Run workflow** to refresh by hand. A failed run opens (or comments on) a "League data update failed" issue assigned to the repo owner; tick *Fail on purpose* in the Run workflow form to test that alert.

Local use:

```
pip install -r requirements.txt
python export_site_data.py      # refresh docs/data.json
python build_gbgh_2026.py       # private Excel workbook (not committed)
```
