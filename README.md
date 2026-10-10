# VALUE HORSE

競馬の**市場（オッズ）が付けた確率と、真の確率との乖離を検出し、期待値（EV）を
最大化する**ことを目的とした検証プロジェクト。Next.js製のUIを持つが、本体は
「モデルが市場に勝てているかを統計的に検証し続ける実験装置」である。

> **⚠ 的中率を上げるアプリではない。** VALUE HORSEの目的は「よく当たる予想」を
> 作ることではなく、「市場が間違えている場面を、統計的に信頼できる形で特定する」
> こと。的中率やAUCの改善それ自体は目的ではない。詳細は
> [`docs/DECISIONS.md`](docs/DECISIONS.md) を参照。

---

## 開発AI（Codex等）へ — 最初に読む順番

**この順番で読むこと。順番を飛ばさないこと。**

| # | ファイル | 何が書いてあるか |
|---|---|---|
| 1 | [`AGENTS.md`](AGENTS.md) | **やってはいけないこと。最優先。** |
| 2 | [`docs/CURRENT_STATUS.md`](docs/CURRENT_STATUS.md) | 現在地。モデルは市場に負けている、という診断結果 |
| 3 | [`docs/NEXT_SESSION.md`](docs/NEXT_SESSION.md) | **次にやる作業はこれ一つだけ。**未解決事項の分類 |
| 4 | [`docs/DECISIONS.md`](docs/DECISIONS.md) | 過去の判断と、撤回した4仮説。統計ルール |
| 5 | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | コード・データ・自動更新の構造 |

上記5点を読んでから、必要に応じて以下の一次資料に降りる。

- [Stage 1競走種別の修正](docs/STAGE1_RACE_KIND_FIX.md) — 平地1,292R。旧監査は旧分類の記録。
- [修正後平地ベースライン](docs/STAGE1_FLAT_BASELINE.md) — 742Rの時系列予測、固定設定。市場に劣る結果を保持。
- [Stage 1 v2事前規約](docs/STAGE1_V2_PLAN.md) / [固定比較結果](docs/STAGE1_V2_RESULTS.md) — 通過位置・斤量差だけを追加。旧◎との差は未確定、市場に劣る。

- [`docs/market-disagreement-diagnosis.md`](docs/market-disagreement-diagnosis.md) — **2026-09-02 基準点。**市場乖離診断の全数値
- [`docs/gate-model-design.md`](docs/gate-model-design.md) — 二段階アーキテクチャ設計（未実装）
- [`docs/backfill-step4-ab-results.md`](docs/backfill-step4-ab-results.md) — 6ヶ月バックフィルA/B、仮説撤回の経緯
- [`docs/score-horse-misassignment.md`](docs/score-horse-misassignment.md) — **既知の不具合（未修正）**
- [`docs/backfill-leak-design.md`](docs/backfill-leak-design.md) — リーク対策の設計
- [`docs/threshold-sweep-decision.md`](docs/threshold-sweep-decision.md) — 閾値スイープの方針（本番未反映）

---

## 現在地（要約）

2026-09-02時点の診断（6ヶ月・1,770レース）で、以下が確定している。

- モデル1位と市場1位が食い違う（disagreement）のは全体の **29.0%**
- その29%で、**市場のほうが明確に正しい**（勝率 市場31.3% vs モデル17.1%、差−14.2pt、95%CI[−20.0, −8.2]）
- 1レース1万円の単勝擬似運用で **ROI −27.4%**（半年で−485万円）
- 有望に見えた仮説は**4つすべて撤回済み**。本番反映できる結論は現在ゼロ

→ **「良い条件を探してROIプラスを見つける」アプローチは停止済み。**
詳細と、なぜ停止したかは [`docs/DECISIONS.md`](docs/DECISIONS.md)。

## 固定評価区画

2026-06-27〜2026-08-02の432レースは、今後のゲートモデル開発に対する
**fixed evaluation** として隔離済み。通常のdevelopmentは2026-06-21までの
1,338レースだけを使う。この区画は過去診断で使用済みのため、厳密な
完全未見データではない。
→ [`docs/FIXED_EVALUATION.md`](docs/FIXED_EVALUATION.md)

development専用のrawデータ取得・再開・品質監査については
[`docs/STAGE1_RAW_DATA.md`](docs/STAGE1_RAW_DATA.md) を参照。
Stage 1独立◎の最小実装は [`docs/STAGE1_MINIMAL_MODEL.md`](docs/STAGE1_MINIMAL_MODEL.md)、
保存766Rの初回診断は [`docs/STAGE1_FIRST_AUDIT.md`](docs/STAGE1_FIRST_AUDIT.md) を参照。
モデルは市場を上回る結果を示していない。ローカル取得データ・保存予測はGit管理外。
弱点・未使用入力の調査と競走種別の不整合は
[`docs/STAGE1_WEAKNESS_RESEARCH.md`](docs/STAGE1_WEAKNESS_RESEARCH.md) を参照。
保存766Rには障害名/surface不整合の24Rが含まれるため、確認済み平地のみの成績とは解釈しない。

development時系列シミュレーター基盤と制約・合成テストは
[`docs/TIMELINE_SIMULATOR.md`](docs/TIMELINE_SIMULATOR.md) を参照。
現行VHのdevelopment監査は [`docs/STAGE0_AUDIT.md`](docs/STAGE0_AUDIT.md) を参照。
最終オッズによる参考分析であり、発走前オッズを使った厳密な再現ではない。

---

## セットアップ

```bash
npm ci
npm run dev        # http://localhost:3000
npx tsc --noEmit   # 型チェック（テストスイートは無い）
```

APIキー・認証情報は**一切使っていない**（netkeibaの公開ページをスクレイピング）。
`.env` は存在せず、必要もない。

## 主なコマンド

```bash
npm run fetch-races     # 出馬表取得
npm run fetch-scores    # 近走成績・騎手スコア
npm run fetch-results   # レース結果
npm run fetch-odds      # オッズのみ更新
npm run snapshot        # 予想スナップショット記録

# 基準点の再診断（モデルを変更したら必ず実行して比較する）
npx tsx scripts/_diagnose-market-agreement.ts
```

データ更新は GitHub Actions が土日に自動実行しており、手動実行は通常不要。
→ [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
