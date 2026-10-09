# Stage 1 development rawデータ基盤

対象はdevelopment（2026-02-07〜2026-06-21、1,338レース、7,851ユニーク馬）。
これはデータ取得・品質確認であり、Stage 1モデルの実装や性能検証ではない。
固定評価区画と `.sealed-data` は入力にも取得対象にも使わない。

## 保存先と再開

Git管理外の `lib/backfill-stage1/` に保存する。

- `checkpoint/horses.jsonl`: 馬ID単位の取得済み記録。
- `checkpoint/races.jsonl`: developmentのnetkeiba race ID単位の取得済み記録。
- `checkpoint/failures.jsonl`: 3回の通信試行後も失敗した対象。存在しなければ0件。
- `horse-history-raw.json`: development終了日以前の履歴を持つ馬の辞書。
- `race-details-raw.json`: 発走前情報と結果・払戻を分離したレース辞書。
- `quality-report.json`: フィールドの取得件数・欠損率。性能指標は含まない。

```powershell
npx.cmd tsx scripts/backfill-enrich-raw.ts --mode=collect --out=lib/backfill-stage1 --delay-ms=1300
npx.cmd tsx scripts/backfill-enrich-raw.ts --mode=finalize --out=lib/backfill-stage1
npx.cmd tsx scripts/audit-enrich-raw.ts
npx.cmd tsx scripts/test-enrich-raw.ts # 合成データのみの回帰テスト
```

通信は直列、最短1,300ms間隔、30秒タイムアウト、最大3回試行。
取得済みIDは履歴の日付で絞らず認識する。失敗した対象だけ次回の取得対象に残る。
チェックポイントが壊れている・ID重複・集合外IDの場合は停止し、無視して追記しない。
排他ロック `collection.lock` があれば起動を拒否する。再起動後の残存ロックは
プロセス停止とチェックポイント整合性を確認するまで取り除かない。
出力先はstage1本番ローカル用またはstage1-sampleに限定する。

## rawと発走前情報の区別

履歴は元の着差、タイム、通過順位、上がり、馬体重・増減、斤量、オッズの文字列を保持。
数値の着差や脚質スコアへ変換しない。欠損はnull、`**`や特殊着順はrawを残す。
地方・海外・障害等も無理に統一せずvenueRaw等を残す。
短縮した数値raceIdは年を含まないため、照合の主キーは12桁netKeibaRaceIdとする。

現在レースは `preRace` に性齢・斤量・騎手・調教師・馬場・クラスrawを保存。
構造化クラスが不明ならnullを維持。gradeのnullは非重賞でも正常。
`result` の着順・着差・タイム・上がり・通過順位・最終オッズと
`labels.payouts` は発走前特徴量ではない。馬体重は発走前公表でも
現在の保存場所はresultなので、利用する際は公表時刻を別途確認する。
払戻は単勝・複勝・馬連・馬単・ワイド・三連複・三連単を100円単位で保存。
複数組合せはentries配列、返還・発売なし・欠損はstatusとrawを保持する。
同じ券種が別HTML行に繰り返される場合も各行のrawとstatusをrowsに保持する。
混在したstatusはunparsedとして明示する。未確認形式は元ページとの照合が必要。

## 時点制約

馬戦績ページは現在までの履歴を返す。既存取得チェックポイント・バックアップは
取得時点の全履歴を含むことがあるため、分析入力に直接使用しない。
finalizeは日付だけで2026-06-21より後の履歴を除外して通常出力を作る。
固定評価区画のファイルを開いて補完・照合することは禁止。
さらに各対象レースの特徴量生成では必ず `history.date < targetRace.date` を適用し、
同日・対象レース自身・未来の履歴を除外すること。終了日フィルターだけでは不十分。
今回のスクリプトは特徴量を生成しない。利用側の時点フィルターを省略してはいけない。

## 2026-10-09の再開修復

PC再起動時の913件の正常レース行を保持し、不完全914行目を全体バックアップと
末尾退避ファイルに保存した。馬は7,856行中、誤再開で増えた5行を退避し、
元の7,851行を保持した。4頭は全履歴が一致、1頭もdevelopment内の履歴は一致。
全体バックアップは `checkpoint/horses.jsonl.before-dedup-20261009`、
重複退避は `checkpoint/horses.jsonl.duplicates-20261009`。
修復後は馬todo=0、レースtodo=425で再開した。
バックアップ・退避データもGitに追加しない。
過去の成功した通信retry回数は記録されていないため、failureログ0件と
「通信retryが一度もなかった」は同義ではない。

## 完了時の品質監査（2026-10-09）

- 1,338レース、7,851馬、元の延べ出走18,870頭。
- 結果ページ行は18,941頭。差分71行は除外42・取消29のみ。
- development終了日までの過去走は85,395行（期間開始以前の履歴を含む）。
- checkpointのrace ID・horse ID重複0、元集合との欠落・余分なID0。
- race日付は元developmentと一致。元の913行は退避前データと行単位で完全一致。
- 性齢・斤量・調教師・調教師IDは18,941/18,941行。
- 馬場・クラスは1,338/1,338。重賞gradeは60件、非重賞のnullは正常。
- 全7券種はそれぞれ1,338レースで取得。組合せ頭数・番号・払戻整数の異常0。
- failureログ0件、未解決失敗0件。成功retry回数は元処理に記録がなく不明。
- developmentの2レースを元ページと照合。性齢、調教師とID、馬場、三連複・
  三連単の組合せが一致した。全特殊形式の実地確認済みという意味ではない。

過去走の取得件数／欠損率（85,395行を分母。rawが`**`等の場合は取得扱い）：

| フィールド | 取得件数 | 欠損率 |
|---|---:|---:|
| netKeibaRaceId | 85,271 | 0.15% |
| raceId / weatherRaw | 各85,271 | 0.15% |
| date / venueRaw | 各85,395 | 0% |
| venue（JRA正規化） | 79,041 | 7.44% |
| raceName / surface / distance / horseNumber | 各85,395 | 0% |
| trackConditionRaw | 85,377 | 0.02% |
| fieldSize | 85,353 | 0.05% |
| frameNumber | 85,273 | 0.14% |
| positionRaw | 85,356 | 0.05% |
| position（数値） | 84,787 | 0.71% |
| marginRaw | 84,668 | 0.85% |
| raceTimeRaw | 84,676 | 0.84% |
| cornerPositionsRaw | 84,802 | 0.69% |
| final3fRaw | 84,661 | 0.86% |
| jockey | 85,395 | 0% |
| jockeyId | 84,596 | 0.94% |
| carriedWeightRaw / horseWeightRaw | 各85,395 | 0% |
| oddsRaw | 84,954 | 0.52% |
| popularity | 85,011 | 0.45% |

正規化venueの欠損は地方・海外等をJRA競馬場へ無理に分類しない設計による。
タイム・上がり等の欠損はそのまま保持し、競走中止等と合わせて利用側で扱う。
取得率はモデル性能を示すものではない。ROI/AUC/的中率等は算出していない。

型検査・対象3スクリプトのESLint・git diff --check・合成データ回帰テストを通過。
通信なしの再開確認はhorse todo=0 / race todo=0。取得プロセスは正常終了した。
