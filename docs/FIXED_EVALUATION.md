# 時系列固定評価区画

## 確定済みの境界

- development: 2026-02-07〜2026-06-21（1,338レース）
- fixed evaluation: 2026-06-27〜2026-08-02（432レース）
- 境界日: 2026-06-27

この境界は評価結果を見て変更しない。fixed evaluation は過去の市場乖離診断で
使用済みであり、厳密な完全未見データではない。今後のゲートモデル開発に対する
固定評価区画として扱う。厳密な完全未見評価は2026-08-02より後に蓄積された
将来データで別途行う。

## 保管場所

- `lib/backfill/`: development専用。通常の分析が読む唯一のバックフィル。
- `.sealed-data/fixed-evaluation-20260627/`: fixed evaluation。Git管理外。
- `.sealed-data/source-full-20260207-20260802/`: 分割前の完全版原本。Git管理外。

`scores-cache-v2.json` はリーク再現用のため、developmentディレクトリには置かない。

## 解禁条件

fixed evaluation は、実装、特徴量、閾値、成功基準、評価対象commitをすべて
確定した後に一度だけ開く。結果を見た後の調整に同じ区画を再利用しない。

通常の `buildRaces()` は隔離領域を拒否する。fixed evaluationの解禁文字列は
最終評価手順を承認するまで使用しない。

## 時点制約

v3特徴量の規則を維持する。

- 馬の履歴は各レース日より厳密に前の行だけを使う。
- 騎手成績はレース年より前の年度行だけを使う。
- 当年行を使うv2をdevelopment入力にしない。

件数・対象ファイル・SHA-256は `docs/fixed-evaluation-manifest.json` を正とする。
