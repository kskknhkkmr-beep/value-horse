<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# VALUE HORSE — 開発AIへの指示

このリポジトリで作業する前に [`README.md`](README.md) の「最初に読む順番」に従って
資料を読むこと。以下は**その要約ではなく、拘束力のあるルール**である。

## このプロジェクトの目的を誤解しないこと

VALUE HORSEは**競馬予想アプリではない。** 目的は的中率やAUCの最大化ではなく、
**市場（オッズ）が付けた確率と真の確率の乖離を検出し、期待値（EV）を最大化する**こと。

現時点で、このモデルは**市場に負けていることが統計的に確定している**
（[`docs/CURRENT_STATUS.md`](docs/CURRENT_STATUS.md)）。これは失敗ではなく、
**確定した測定結果**である。この事実を出発点にすること。

## やってはいけないこと

1. **ホールドアウト固定が完了する前に、モデル改善を開始しない。**
   次の作業は [`docs/NEXT_SESSION.md`](docs/NEXT_SESSION.md) の1件だけ。
   ゲートモデル実装・特徴量追加・閾値探索・ROI探索へ勝手に進まない。

2. **ROIが良いセグメントを後付けで探索しない。**
   「芝だけなら」「マイルだけなら」「この閾値なら」プラス、という探し方で
   見つかった所見は**過去に4つすべて撤回された**
   （[`docs/DECISIONS.md`](docs/DECISIONS.md)）。同じ過ちを繰り返さない。
   仮説は**データを見る前に構造的な理由を立ててから**検証する。

3. **診断結果が悪いからといって、隠したり・削除したり・言い換えたりしない。**
   ROI −27.4%、勝率差 −14.2pt といった数値は基準点として意図的に残してある。
   都合の良い指標に差し替えない。悪い結果はそのまま報告する。

4. **統計ルールを勝手に緩和しない。**（ルール本体は下記「統計ルール」）
   「今回は的中18件だが惜しいので候補とする」といった例外を作らない。

5. **本番データやGit履歴を理由なく破壊しない。**
   `lib/*.json` はGitHub Actionsが自動更新している本番データ。
   force push、履歴改変、キャッシュの一括再生成は行わない。

6. **秘密情報をcommitしない。**
   このリポジトリは **PUBLIC** である。`.env` やAPIキーは現在一切存在せず、
   必要もない（netkeibaの公開ページのスクレイピングのみ）。この状態を保つこと。
   ルート直下の個人用Markdown台帳は `.gitignore` 済み。`git add -A` を使わず、
   **変更したファイルを明示的に指定して**stageすること。

7. **本番の閾値・ブレンド比率を、検証なしに変更しない。**
   現在の本番値は `app/page.tsx` の `EV_MIN=0.10 / EDGE_MIN=0.02 / ODDS_MAX=50`、
   `lib/engine.ts` の `MARKET_WEIGHT=0.35`。`ODDS_MAX` を 20 に下げる案は
   検討済みだが**本番未反映のまま**（[`docs/threshold-sweep-decision.md`](docs/threshold-sweep-decision.md)）。

## 統計ルール（決定済み・緩和禁止）

新しい所見を「候補」と呼ぶ前に、**全項目**を満たすこと。

- **的中20件未満は候補から除外する**（参考値としてのみ記録可）
- **レース単位ブートストラップ信頼区間を必須とする**（馬単位ではなくレース単位で再標本化）
- **上位1〜2件の高配当的中を除いてもROIの符号が変わらないか確認する**
  （符号が反転するなら、それは少数の的中がROIを支配しているだけ）
- **v2/v3等で結果が一致しても、同じ的中集合を数え直しているだけではないか確認する**
  （的中のJaccard係数を見る。過去に86.1%重複＝独立検証になっていなかった実例あり）
- **ROIだけでなく、円換算損益と最大ドローダウンを併記する**
- **仮説はデータを見てから探すのではなく、構造的理由を先に立ててから検証する**

## モデルを変更したときの必須手順

`scripts/_diagnose-market-agreement.ts` を再実行し、
[`docs/market-disagreement-diagnosis.md`](docs/market-disagreement-diagnosis.md) の
**2026-09-02基準点6項目**（disagreement率／勝率差とCI／ROI 2系統／最大DD 2系統）と
並べて比較すること。改善したと主張する前に、この比較表を出す。

```bash
npx tsx scripts/_diagnose-market-agreement.ts
```

## 判断に迷ったら

**止まって、オーナー（一星）に聞くこと。** 「たぶん改善だろう」で本番を変更しない。
このプロジェクトは、性急な改善よりも**判断の履歴が壊れないこと**を優先する。
