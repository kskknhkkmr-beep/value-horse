# VALUE HORSE アーキテクチャ

コード・データ・自動更新がどう繋がっているか。
現在の数値そのものは [`CURRENT_STATUS.md`](CURRENT_STATUS.md)。

---

## 1. 全体の流れ

```
netkeiba（公開ページ・認証不要）
   │  scripts/fetch-*.ts  ← GitHub Actions が土日に自動実行
   ▼
lib/races-cache.json      出馬表・オッズ
lib/scores-cache.json     近走成績(form) / 血統(pedigree) / 騎手(jockey) スコア
lib/results-cache.json    着順
lib/payouts-cache.json    払戻
   │
   ▼
lib/engine.ts  calculateScore()
   ├ calculateStrength()      form 0.30 / pedigree 0.20 / jockey 0.15 + 交互作用
   ├ softmax(TEMP=4.0)      → 純モデル確率
   ├ 1/odds を正規化         → 公正市場確率（オーバーラウンド除去）
   └ 対数オッズ空間でブレンド  MARKET_WEIGHT=0.35（モデル65% : 市場35%）
   │
   ▼  probability, marketProb, edge(=probability−marketProb), ev(=probability×odds−1)
   ▼
app/page.tsx   EV_MIN=0.10 / EDGE_MIN=0.02 / ODDS_MAX=50 でフィルタして表示
               （重賞は EDGE_MIN・ODDS_MAX を免除、EV_MIN のみ適用）
```

**「VH1位」= ブレンド後 `probability` が最大の馬。「市場1位」= 最終オッズが最小の馬。**
この2つが食い違うことを disagreement と呼ぶ（現在29.0%）。

---

## 2. ディレクトリ

| パス | 役割 |
|---|---|
| `app/` | Next.js 16 App Router。`page.tsx` がメインUI、`api/` に3ルート |
| `lib/*.ts` | モデル本体。`engine.ts`（スコア計算）、`scorer.ts`、`scraper.ts`、`combination-ev.ts` |
| `lib/*.json` | **本番データキャッシュ。GitHub Actions が自動更新・自動commitする** |
| `lib/backfill/` | **6ヶ月バックフィルデータ（Git管理外・下記§5参照）** |
| `lib/backfill-test/` | 小規模テスト用（`.gitignore` 済み・再生成可能） |
| `scripts/*.ts` | 取得・分析スクリプト |
| `scripts/_*.ts` | **一時分析スクリプト。`tsconfig.json` の型チェック対象外** |
| `scripts/_cache/` | 分析用の中間データ（`.gitignore` 済み） |
| `docs/` | 判断の記録。**このプロジェクトの中核資産** |
| `src/lib/` | ⚠ **デッドコード。どこからもimportされていない**（§6） |

---

## 3. 重要なスクリプト

| スクリプト | 用途 |
|---|---|
| `scripts/_diagnose-market-agreement.ts` | **市場乖離診断。基準点比較の必須ツール** |
| `scripts/sim-thresholds.ts` | 閾値スイープ（`buildRaces()` を他スクリプトへ提供） |
| `scripts/sim-thresholds-segments.ts` | セグメント別ROI |
| `scripts/sim-thresholds-place-wide.ts` | 複勝・ワイドのROI |
| `scripts/backfill-fetch.ts` | 過去レースの一括取得（Phase A〜D） |
| `scripts/backfill-derive.ts` | v3（リーク除去）スコア導出 |
| `scripts/backfill-derive-v2.ts` | v2（リークあり再現）スコア導出 |
| `scripts/_analyze-turf-mile-tan.ts` | 頑健性チェックの実装例（高配当依存・Jaccard） |

分析スクリプトはデータセットをファイル先頭の定数
（`CACHE_DIR` / `SCORES_FILE` / `TARGET_VERSION`）で切り替える。
一部は環境変数対応（`CACHE_DIR=... SCORES_FILE=... npx tsx ...`）。

---

## 4. GitHub Actions（自動更新）

`.github/workflows/race-data.yml` — 土日のみ稼働

| cron (UTC) | JST | モード |
|---|---|---|
| `0 22 * * 5,6` | 土日 7:00 | `all`（出馬表＋スコア） |
| `*/15 0-7 * * 0,6` | 9:00〜16:45 15分毎 | `odds` |
| `30 8` / `30 11` / `0 13` / `30 14` `* * 0,6` | 17:30 / 20:30 / 22:00 / 23:30 | `results`（4スロット冗長化） |

`.github/workflows/weekly-update.yml` — 金曜19:00 JST に翌週末の出馬表を先行取得

**設計上の注意（過去に事故った箇所・触るときは理由を読むこと）**

- モード判定は**実時刻ではなく起動した cron 文字列**（`github.event.schedule`）で行う。
  実時刻で判定すると、GitHubの遅延で results スロットが odds に化けて結果が取れない。
- `concurrency` グループを **odds系 と critical系（all/results）で分離**している。
  同一グループだと odds のキュー渋滞で results が数時間遅延する（2026-07-18/19に実際に発生）。

無料枠2,000分に対し推定 1,400分/月。**秘密情報・Secretsは使用していない**
（`GITHUB_TOKEN` の自動権限 `contents: write` のみ）。

---

## 5. データはどこにあるか（重要）

| データ | 場所 | 失ったら |
|---|---|---|
| `lib/races-cache.json` 等の本番キャッシュ | **GitHub（追跡済み）** | 復旧可能 |
| `docs/` の判断記録 | **GitHub（追跡済み）** | 復旧可能 |
| **`lib/backfill/`（29MB、6ヶ月・8,683頭）** | ⚠ **このPCのローカルのみ** | **再取得に約44時間**（実測 2,641分のスクレイピング。2026-08-05〜08-08に取得） |
| `scripts/_cache/`, `lib/backfill-test/` | ローカルのみ（`.gitignore`済み） | 再生成可能・軽微 |

**`lib/backfill/` はGit管理外だが `.gitignore` にも入っていない。**
これは意図的な保留状態であり、このPCが故障すると失われる。
中身: `horses.json` / `races.json` / `races-cache.json` / `results-cache.json` /
`payouts-cache.json` / `scores-cache.json`(v3) / `scores-cache-v2.json` /
`race-index.json` / 取得ログ。

**すべての診断・A/B検証・基準点はこのデータに依存している。**
失うと `_diagnose-market-agreement.ts` が動かず、基準点比較ができなくなる。

---

## 6. 落とし穴

1. **`src/lib/` を編集しない。** `src/lib/engine.ts` は `lib/engine.ts` と内容が
   異なるが、`tsconfig.json` の `paths` は `@/*` → `./*` なので
   `@/lib/engine` は **`lib/engine.ts`** を指す。`src/` は誰も読んでいない。

2. **`lib/*.json` を手で編集しない。** Actionsが上書きし、コンフリクトする。
   ローカルで作業する前に `git pull` すること（bot commitで頻繁に進む）。

3. **`scripts/_*.ts` は型チェック対象外**（`tsconfig.json` の `exclude`）。
   `npx tsc --noEmit` が通っても分析スクリプトの型は検証されていない。

4. **馬IDが位置依存**（`rid * 100 + index + 1`）。
   `netKeibaHorseId` という安定IDが同レコードにあるのに使われていない。
   → [`score-horse-misassignment.md`](score-horse-misassignment.md)（未修正の不具合）

5. **Next.js 16 系**。トップの `AGENTS.md` にある通り、APIが学習データと異なる
   可能性がある。`node_modules/next/dist/docs/` を読むこと。
