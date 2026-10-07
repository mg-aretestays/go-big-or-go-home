# Go Big or Go Home – 2026 dashboard

Standings, scoring heat map, weekly results and player stats for the Go Big or Go Home Sleeper league.

- **Live page:** served by GitHub Pages from `docs/`.
- **Data:** league results from the [Sleeper API](https://docs.sleeper.com/); player stats from [FantasyPros](https://www.fantasypros.com/nfl/stats/qb.php) (half PPR).
- **Updates:** `.github/workflows/update-data.yml` runs `export_site_data.py` every Tuesday morning and commits `docs/data.json`. Use **Actions → Update league data → Run workflow** to refresh by hand.

Local use:

```
pip install -r requirements.txt
python export_site_data.py      # refresh docs/data.json
python build_gbgh_2026.py       # private Excel workbook (not committed)
```
