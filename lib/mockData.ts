// 2026-06-13 実レースデータ
// 東京11R ジューンS(OP) 出走馬：netkeiba (race_id=202605030311) / スポーツナビ 2ソース一致確認済み
// 単勝オッズ：netkeiba / スポーツナビ（2026-06-13 取得）
// formScore/pedigreeScore/trainingScore：市場オッズから推定
// jockeyScore：騎手実績ベース推定値
//
// 2026-06-14 実レースデータ
// 阪神11R 宝塚記念(G1) 出走馬：netkeiba (race_id=202609030411) / umanity 2ソース一致確認済み
// 単勝オッズ：umanity（2026-06-14 取得）
// formScore/pedigreeScore/trainingScore：市場オッズから推定
// jockeyScore：騎手実績ベース推定値

export const races = [
  {
    id: 1,
    date: "2026-06-13",
    venue: "東京",
    raceNumber: 11,
    raceName: "ジューンS（OP）",
    postTime: "15:30",
  },
  {
    id: 2,
    date: "2026-06-13",
    venue: "函館",
    raceNumber: 11,
    raceName: "函館スプリントS（G3）",
    postTime: "15:45",
  },
  {
    id: 3,
    date: "2026-06-14",
    venue: "阪神",
    raceNumber: 11,
    raceName: "宝塚記念（G1）",
    postTime: "15:40",
  },
];

export const horses = [
  // 東京11R ジューンS(OP) 13頭 — 枠番・馬番・騎手：netkeiba 202605030311
  { id: 101, raceId: 1, frameNumber: 1, horseNumber: 1,  horse: "レガーロデルシエロ", jockey: "大野拓弥" },
  { id: 102, raceId: 1, frameNumber: 2, horseNumber: 2,  horse: "タシット",           jockey: "三浦皇成" },
  { id: 103, raceId: 1, frameNumber: 3, horseNumber: 3,  horse: "カネラフィーナ",     jockey: "C.ルメール" },
  { id: 104, raceId: 1, frameNumber: 4, horseNumber: 4,  horse: "リラエンブレム",     jockey: "戸崎圭太" },
  { id: 105, raceId: 1, frameNumber: 4, horseNumber: 5,  horse: "ナムラエイハブ",     jockey: "原優介" },
  { id: 106, raceId: 1, frameNumber: 5, horseNumber: 6,  horse: "メリオーレム",       jockey: "石川裕紀人" },
  { id: 107, raceId: 1, frameNumber: 5, horseNumber: 7,  horse: "コントラポスト",     jockey: "津村明秀" },
  { id: 108, raceId: 1, frameNumber: 6, horseNumber: 8,  horse: "バレエマスター",     jockey: "菊沢一樹" },
  { id: 109, raceId: 1, frameNumber: 6, horseNumber: 9,  horse: "ダノンエアズロック", jockey: "D.レーン" },
  { id: 110, raceId: 1, frameNumber: 7, horseNumber: 10, horse: "ディマイザキッド",   jockey: "M.ディー" },
  { id: 111, raceId: 1, frameNumber: 7, horseNumber: 11, horse: "トーセンリョウ",     jockey: "F.ゴンサルベス" },
  { id: 112, raceId: 1, frameNumber: 8, horseNumber: 12, horse: "ヤマニンサンパ",     jockey: "亀田温心" },
  { id: 113, raceId: 1, frameNumber: 8, horseNumber: 13, horse: "マルチャン",         jockey: "丸田恭介" },
  // 阪神11R 宝塚記念(G1) 18頭 — 枠番・馬番・騎手：netkeiba 202609030411 / umanity 2ソース確認済み
  { id: 301, raceId: 3, frameNumber: 1, horseNumber: 1,  horse: "ダノンデサイル",     jockey: "戸崎圭太" },
  { id: 302, raceId: 3, frameNumber: 1, horseNumber: 2,  horse: "ミュージアムマイル", jockey: "D.レーン" },
  { id: 303, raceId: 3, frameNumber: 2, horseNumber: 3,  horse: "シュガークン",       jockey: "吉村誠之助" },
  { id: 304, raceId: 3, frameNumber: 2, horseNumber: 4,  horse: "ミクニインスパイア", jockey: "丹内祐次" },
  { id: 305, raceId: 3, frameNumber: 3, horseNumber: 5,  horse: "クロワデュノール",   jockey: "北村友一" },
  { id: 306, raceId: 3, frameNumber: 3, horseNumber: 6,  horse: "ビザンチンドリーム", jockey: "西村淳也" },
  { id: 307, raceId: 3, frameNumber: 4, horseNumber: 7,  horse: "ファミリータイム",   jockey: "幸英明" },
  { id: 308, raceId: 3, frameNumber: 4, horseNumber: 8,  horse: "タガノデュード",     jockey: "高杉吏麒" },
  { id: 309, raceId: 3, frameNumber: 5, horseNumber: 9,  horse: "コスモキュランダ",   jockey: "横山武史" },
  { id: 310, raceId: 3, frameNumber: 5, horseNumber: 10, horse: "ジューンテイク",     jockey: "松山弘平" },
  { id: 311, raceId: 3, frameNumber: 6, horseNumber: 11, horse: "シンエンペラー",     jockey: "坂井瑠星" },
  { id: 312, raceId: 3, frameNumber: 6, horseNumber: 12, horse: "マイネルエンペラー", jockey: "川田将雅" },
  { id: 313, raceId: 3, frameNumber: 7, horseNumber: 13, horse: "シェイクユアハート", jockey: "古川吉洋" },
  { id: 314, raceId: 3, frameNumber: 7, horseNumber: 14, horse: "スティンガーグラス", jockey: "岩田望来" },
  { id: 315, raceId: 3, frameNumber: 7, horseNumber: 15, horse: "マイユニバース",     jockey: "横山典弘" },
  { id: 316, raceId: 3, frameNumber: 8, horseNumber: 16, horse: "メイショウタバル",   jockey: "武豊" },
  { id: 317, raceId: 3, frameNumber: 8, horseNumber: 17, horse: "レガレイラ",         jockey: "C.ルメール" },
  { id: 318, raceId: 3, frameNumber: 8, horseNumber: 18, horse: "ミステリーウェイ",   jockey: "松本大輝" },
  // 函館11R 函館スプリントS G3 13頭
  { id: 201, raceId: 2, frameNumber: 1, horseNumber: 1,  horse: "モズナナスター",     jockey: "" },
  { id: 202, raceId: 2, frameNumber: 1, horseNumber: 2,  horse: "ダノンマッキンリー", jockey: "" },
  { id: 203, raceId: 2, frameNumber: 2, horseNumber: 3,  horse: "レイピア",           jockey: "" },
  { id: 204, raceId: 2, frameNumber: 2, horseNumber: 4,  horse: "カルプスペルシュ",   jockey: "" },
  { id: 205, raceId: 2, frameNumber: 3, horseNumber: 5,  horse: "ジョーメッドヴィン", jockey: "" },
  { id: 206, raceId: 2, frameNumber: 3, horseNumber: 6,  horse: "ウイングレイテスト", jockey: "" },
  { id: 207, raceId: 2, frameNumber: 4, horseNumber: 7,  horse: "ピューロマジック",   jockey: "" },
  { id: 208, raceId: 2, frameNumber: 5, horseNumber: 8,  horse: "ポッドベイダー",     jockey: "" },
  { id: 209, raceId: 2, frameNumber: 5, horseNumber: 9,  horse: "クラスペディア",     jockey: "" },
  { id: 210, raceId: 2, frameNumber: 6, horseNumber: 10, horse: "エーティーマクフィ", jockey: "" },
  { id: 211, raceId: 2, frameNumber: 6, horseNumber: 11, horse: "インビンシブルパパ", jockey: "" },
  { id: 212, raceId: 2, frameNumber: 7, horseNumber: 12, horse: "ルシード",           jockey: "" },
  { id: 213, raceId: 2, frameNumber: 8, horseNumber: 13, horse: "シュタールヴィント", jockey: "" },
];

// jockeyScore凡例: ルメール=95, レーン=90, 川田=88, 武豊=88, 横山武=84, 戸崎=84, 坂井=82,
//                  岩田望=80, 北村友=80, 松山=80, 横山典=78, 西村淳=76, 大野=76,
//                  幸=74, ゴンサルベス=75, 古川吉=72, 石川=73, 三浦=72, 津村=72, 亀田=72,
//                  菊沢=70, 原=70, 丹内=70, 高杉=65, 吉村誠=65, 松本大=68, 丸田=68
export const horseFeatures = [
  // 阪神11R 宝塚記念(G1) — formScore/pedigreeScore/trainingScore はオッズ逆相関で推定
  { horseId: 301, formScore: 76, pedigreeScore: 75, trainingScore: 75, jockeyScore: 84 }, // ダノンデサイル 戸崎 7.0倍
  { horseId: 302, formScore: 76, pedigreeScore: 74, trainingScore: 75, jockeyScore: 90 }, // ミュージアムマイル レーン 7.1倍
  { horseId: 303, formScore: 39, pedigreeScore: 38, trainingScore: 39, jockeyScore: 65 }, // シュガークン 吉村誠之助 250.2倍
  { horseId: 304, formScore: 55, pedigreeScore: 54, trainingScore: 55, jockeyScore: 70 }, // ミクニインスパイア 丹内 56.1倍
  { horseId: 305, formScore: 88, pedigreeScore: 86, trainingScore: 87, jockeyScore: 80 }, // クロワデュノール 北村友一 2.5倍
  { horseId: 306, formScore: 62, pedigreeScore: 60, trainingScore: 61, jockeyScore: 76 }, // ビザンチンドリーム 西村淳也 29.6倍
  { horseId: 307, formScore: 37, pedigreeScore: 36, trainingScore: 37, jockeyScore: 74 }, // ファミリータイム 幸 287.4倍
  { horseId: 308, formScore: 55, pedigreeScore: 53, trainingScore: 54, jockeyScore: 65 }, // タガノデュード 高杉 58.8倍
  { horseId: 309, formScore: 59, pedigreeScore: 57, trainingScore: 58, jockeyScore: 84 }, // コスモキュランダ 横山武史 41.6倍
  { horseId: 310, formScore: 40, pedigreeScore: 39, trainingScore: 40, jockeyScore: 80 }, // ジューンテイク 松山 222.6倍
  { horseId: 311, formScore: 51, pedigreeScore: 49, trainingScore: 50, jockeyScore: 82 }, // シンエンペラー 坂井 85.0倍
  { horseId: 312, formScore: 46, pedigreeScore: 45, trainingScore: 46, jockeyScore: 88 }, // マイネルエンペラー 川田 121.0倍
  { horseId: 313, formScore: 51, pedigreeScore: 50, trainingScore: 51, jockeyScore: 72 }, // シェイクユアハート 古川吉 84.0倍
  { horseId: 314, formScore: 44, pedigreeScore: 42, trainingScore: 43, jockeyScore: 80 }, // スティンガーグラス 岩田望来 151.6倍
  { horseId: 315, formScore: 67, pedigreeScore: 65, trainingScore: 66, jockeyScore: 78 }, // マイユニバース 横山典弘 19.1倍
  { horseId: 316, formScore: 87, pedigreeScore: 84, trainingScore: 85, jockeyScore: 88 }, // メイショウタバル 武豊 2.5倍
  { horseId: 317, formScore: 75, pedigreeScore: 73, trainingScore: 74, jockeyScore: 95 }, // レガレイラ ルメール 7.8倍
  { horseId: 318, formScore: 39, pedigreeScore: 38, trainingScore: 39, jockeyScore: 68 }, // ミステリーウェイ 松本大輝 229.4倍
  // 東京11R ジューンS(OP) — formScore/pedigreeScore/trainingScore はオッズ逆相関で推定
  { horseId: 101, formScore: 78, pedigreeScore: 76, trainingScore: 77, jockeyScore: 76 }, // レガーロデルシエロ 大野拓弥 5.7倍
  { horseId: 102, formScore: 48, pedigreeScore: 47, trainingScore: 48, jockeyScore: 72 }, // タシット 三浦皇成 120.3倍
  { horseId: 103, formScore: 81, pedigreeScore: 79, trainingScore: 80, jockeyScore: 95 }, // カネラフィーナ ルメール 5.1倍
  { horseId: 104, formScore: 73, pedigreeScore: 71, trainingScore: 72, jockeyScore: 84 }, // リラエンブレム 戸崎圭太 9.0倍
  { horseId: 105, formScore: 70, pedigreeScore: 68, trainingScore: 69, jockeyScore: 70 }, // ナムラエイハブ 原優介 10.9倍
  { horseId: 106, formScore: 61, pedigreeScore: 60, trainingScore: 60, jockeyScore: 73 }, // メリオーレム 石川裕紀人 26.7倍
  { horseId: 107, formScore: 64, pedigreeScore: 62, trainingScore: 63, jockeyScore: 72 }, // コントラポスト 津村明秀 20.1倍
  { horseId: 108, formScore: 57, pedigreeScore: 56, trainingScore: 57, jockeyScore: 70 }, // バレエマスター 菊沢一樹 46.7倍
  { horseId: 109, formScore: 85, pedigreeScore: 82, trainingScore: 83, jockeyScore: 90 }, // ダノンエアズロック レーン 3.7倍
  { horseId: 110, formScore: 82, pedigreeScore: 80, trainingScore: 81, jockeyScore: 85 }, // ディマイザキッド M.ディー 4.9倍
  { horseId: 111, formScore: 67, pedigreeScore: 65, trainingScore: 66, jockeyScore: 75 }, // トーセンリョウ ゴンサルベス 13.2倍
  { horseId: 112, formScore: 52, pedigreeScore: 51, trainingScore: 52, jockeyScore: 72 }, // ヤマニンサンパ 亀田温心 87.9倍
  { horseId: 113, formScore: 42, pedigreeScore: 41, trainingScore: 41, jockeyScore: 68 }, // マルチャン 丸田恭介 241.6倍
  // 函館11R G3
  { horseId: 201, formScore: 68, pedigreeScore: 70, trainingScore: 69, jockeyScore: 73 },
  { horseId: 202, formScore: 65, pedigreeScore: 68, trainingScore: 66, jockeyScore: 78 },
  { horseId: 203, formScore: 88, pedigreeScore: 84, trainingScore: 86, jockeyScore: 84 },
  { horseId: 204, formScore: 82, pedigreeScore: 80, trainingScore: 81, jockeyScore: 65 },
  { horseId: 205, formScore: 58, pedigreeScore: 62, trainingScore: 60, jockeyScore: 70 },
  { horseId: 206, formScore: 60, pedigreeScore: 65, trainingScore: 62, jockeyScore: 68 },
  { horseId: 207, formScore: 72, pedigreeScore: 74, trainingScore: 73, jockeyScore: 76 },
  { horseId: 208, formScore: 62, pedigreeScore: 64, trainingScore: 63, jockeyScore: 60 },
  { horseId: 209, formScore: 63, pedigreeScore: 65, trainingScore: 64, jockeyScore: 62 },
  { horseId: 210, formScore: 79, pedigreeScore: 77, trainingScore: 78, jockeyScore: 63 },
  { horseId: 211, formScore: 68, pedigreeScore: 70, trainingScore: 69, jockeyScore: 60 },
  { horseId: 212, formScore: 78, pedigreeScore: 76, trainingScore: 77, jockeyScore: 72 },
  { horseId: 213, formScore: 54, pedigreeScore: 58, trainingScore: 56, jockeyScore: 78 },
];

export const sentimentScores = [
  // 阪神11R 宝塚記念(G1)
  { horseId: 301, proScore: 78, youtubeScore: 76 }, // ダノンデサイル
  { horseId: 302, proScore: 78, youtubeScore: 75 }, // ミュージアムマイル
  { horseId: 303, proScore: 34, youtubeScore: 31 }, // シュガークン
  { horseId: 304, proScore: 50, youtubeScore: 47 }, // ミクニインスパイア
  { horseId: 305, proScore: 90, youtubeScore: 88 }, // クロワデュノール
  { horseId: 306, proScore: 60, youtubeScore: 57 }, // ビザンチンドリーム
  { horseId: 307, proScore: 32, youtubeScore: 29 }, // ファミリータイム
  { horseId: 308, proScore: 50, youtubeScore: 47 }, // タガノデュード
  { horseId: 309, proScore: 55, youtubeScore: 52 }, // コスモキュランダ
  { horseId: 310, proScore: 35, youtubeScore: 32 }, // ジューンテイク
  { horseId: 311, proScore: 46, youtubeScore: 43 }, // シンエンペラー
  { horseId: 312, proScore: 41, youtubeScore: 38 }, // マイネルエンペラー
  { horseId: 313, proScore: 46, youtubeScore: 43 }, // シェイクユアハート
  { horseId: 314, proScore: 39, youtubeScore: 36 }, // スティンガーグラス
  { horseId: 315, proScore: 68, youtubeScore: 65 }, // マイユニバース
  { horseId: 316, proScore: 88, youtubeScore: 86 }, // メイショウタバル
  { horseId: 317, proScore: 77, youtubeScore: 75 }, // レガレイラ
  { horseId: 318, proScore: 34, youtubeScore: 31 }, // ミステリーウェイ
  // 東京11R ジューンS
  { horseId: 101, proScore: 80, youtubeScore: 78 }, // レガーロデルシエロ
  { horseId: 102, proScore: 40, youtubeScore: 38 }, // タシット
  { horseId: 103, proScore: 83, youtubeScore: 81 }, // カネラフィーナ
  { horseId: 104, proScore: 72, youtubeScore: 70 }, // リラエンブレム
  { horseId: 105, proScore: 68, youtubeScore: 65 }, // ナムラエイハブ
  { horseId: 106, proScore: 56, youtubeScore: 54 }, // メリオーレム
  { horseId: 107, proScore: 60, youtubeScore: 58 }, // コントラポスト
  { horseId: 108, proScore: 50, youtubeScore: 48 }, // バレエマスター
  { horseId: 109, proScore: 88, youtubeScore: 85 }, // ダノンエアズロック
  { horseId: 110, proScore: 84, youtubeScore: 82 }, // ディマイザキッド
  { horseId: 111, proScore: 64, youtubeScore: 62 }, // トーセンリョウ
  { horseId: 112, proScore: 45, youtubeScore: 43 }, // ヤマニンサンパ
  { horseId: 113, proScore: 33, youtubeScore: 30 }, // マルチャン
  // 函館11R G3
  { horseId: 201, proScore: 62, youtubeScore: 60 },
  { horseId: 202, proScore: 58, youtubeScore: 55 },
  { horseId: 203, proScore: 90, youtubeScore: 88 },
  { horseId: 204, proScore: 80, youtubeScore: 78 },
  { horseId: 205, proScore: 48, youtubeScore: 45 },
  { horseId: 206, proScore: 50, youtubeScore: 48 },
  { horseId: 207, proScore: 68, youtubeScore: 65 },
  { horseId: 208, proScore: 52, youtubeScore: 50 },
  { horseId: 209, proScore: 53, youtubeScore: 50 },
  { horseId: 210, proScore: 76, youtubeScore: 74 },
  { horseId: 211, proScore: 62, youtubeScore: 60 },
  { horseId: 212, proScore: 74, youtubeScore: 72 },
  { horseId: 213, proScore: 44, youtubeScore: 42 },
];

// 単勝オッズ：netkeiba (race_id=202605030311) / スポーツナビ 2ソース一致の実データ（2026-06-13 取得）
// 単勝オッズ：netkeiba (race_id=202609030411) / umanity 2ソース確認済み（2026-06-14 取得）
export const marketOdds = [
  // 阪神11R 宝塚記念(G1) 実オッズ（umanity確認済み）
  { horseId: 301, odds: 7.0 },   // ダノンデサイル
  { horseId: 302, odds: 7.1 },   // ミュージアムマイル
  { horseId: 303, odds: 250.2 }, // シュガークン
  { horseId: 304, odds: 56.1 },  // ミクニインスパイア
  { horseId: 305, odds: 2.5 },   // クロワデュノール（1番人気）
  { horseId: 306, odds: 29.6 },  // ビザンチンドリーム
  { horseId: 307, odds: 287.4 }, // ファミリータイム
  { horseId: 308, odds: 58.8 },  // タガノデュード
  { horseId: 309, odds: 41.6 },  // コスモキュランダ
  { horseId: 310, odds: 222.6 }, // ジューンテイク
  { horseId: 311, odds: 85.0 },  // シンエンペラー
  { horseId: 312, odds: 121.0 }, // マイネルエンペラー
  { horseId: 313, odds: 84.0 },  // シェイクユアハート
  { horseId: 314, odds: 151.6 }, // スティンガーグラス
  { horseId: 315, odds: 19.1 },  // マイユニバース
  { horseId: 316, odds: 2.5 },   // メイショウタバル（2番人気）
  { horseId: 317, odds: 7.8 },   // レガレイラ
  { horseId: 318, odds: 229.4 }, // ミステリーウェイ
  // 東京11R ジューンS(OP) 実オッズ（netkeiba確認済み）
  { horseId: 101, odds: 5.7 },   // レガーロデルシエロ
  { horseId: 102, odds: 120.3 }, // タシット
  { horseId: 103, odds: 5.1 },   // カネラフィーナ
  { horseId: 104, odds: 9.0 },   // リラエンブレム
  { horseId: 105, odds: 10.9 },  // ナムラエイハブ
  { horseId: 106, odds: 26.7 },  // メリオーレム
  { horseId: 107, odds: 20.1 },  // コントラポスト
  { horseId: 108, odds: 46.7 },  // バレエマスター
  { horseId: 109, odds: 3.7 },   // ダノンエアズロック
  { horseId: 110, odds: 4.9 },   // ディマイザキッド
  { horseId: 111, odds: 13.2 },  // トーセンリョウ
  { horseId: 112, odds: 87.9 },  // ヤマニンサンパ
  { horseId: 113, odds: 241.6 }, // マルチャン
  // 函館11R G3 推定オッズ
  { horseId: 201, odds: 22.0 },
  { horseId: 202, odds: 27.2 },
  { horseId: 203, odds: 2.7 },
  { horseId: 204, odds: 4.5 },
  { horseId: 205, odds: 42.0 },
  { horseId: 206, odds: 35.6 },
  { horseId: 207, odds: 16.0 },
  { horseId: 208, odds: 31.9 },
  { horseId: 209, odds: 30.8 },
  { horseId: 210, odds: 5.8 },
  { horseId: 211, odds: 22.0 },
  { horseId: 212, odds: 6.0 },
  { horseId: 213, odds: 57.8 },
];

export const finalScores = [];
