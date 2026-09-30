name: Refresh basketball odds

on:
  schedule:
    # 10:00 UTC = 11:00 Lagos time, daily. Edit the cron below to change it.
    - cron: '0 10 * * *'
  workflow_dispatch: {} # lets you click "Run workflow" on GitHub for an on-demand refresh

permissions:
  contents: write

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Fetch latest odds
        env:
          ODDS_API_KEY: ${{ secrets.ODDS_API_KEY }}
        run: node scripts/fetch-odds.mjs

      - name: Commit updated data
        run: |
          git config user.name "odds-bot"
          git config user.email "odds-bot@users.noreply.github.com"
          git add data/games.json
          git diff --staged --quiet && echo "No changes to commit." || git commit -m "Refresh odds data"
          git push
