// 2026-06-13 実レースデータ
// 東京11R ジューンS(OP) 出走馬：スポーツナビ・競馬ブック 2ソース一致確認済み
// 単勝オッズ：スポーツナビ（2026-06-13 取得）
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
];

export const horses = [
  // 東京11R ジューンS(OP) 13頭
  { id: 101, raceId: 1, horse: "レガーロデルシエロ" },
  { id: 102, raceId: 1, horse: "タシット" },
  { id: 103, raceId: 1, horse: "カネラフィーナ" },
  { id: 104, raceId: 1, horse: "リラエンブレム" },
  { id: 105, raceId: 1, horse: "ナムラエイハブ" },
  { id: 106, raceId: 1, horse: "メリオーレム" },
  { id: 107, raceId: 1, horse: "コントラポスト" },
  { id: 108, raceId: 1, horse: "バレエマスター" },
  { id: 109, raceId: 1, horse: "ダノンエアズロック" },
  { id: 110, raceId: 1, horse: "ディマイザキッド" },
  { id: 111, raceId: 1, horse: "トーセンリョウ" },
  { id: 112, raceId: 1, horse: "ヤマニンサンパ" },
  { id: 113, raceId: 1, horse: "マルチャン" },
  // 函館11R 函館スプリントS G3 13頭
  { id: 201, raceId: 2, horse: "モズナナスター" },
  { id: 202, raceId: 2, horse: "ダノンマッキンリー" },
  { id: 203, raceId: 2, horse: "レイピア" },
  { id: 204, raceId: 2, horse: "カルプスペルシュ" },
  { id: 205, raceId: 2, horse: "ジョーメッドヴィン" },
  { id: 206, raceId: 2, horse: "ウイングレイテスト" },
  { id: 207, raceId: 2, horse: "ピューロマジック" },
  { id: 208, raceId: 2, horse: "ポッドベイダー" },
  { id: 209, raceId: 2, horse: "クラスペディア" },
  { id: 210, raceId: 2, horse: "エーティーマクフィ" },
  { id: 211, raceId: 2, horse: "インビンシブルパパ" },
  { id: 212, raceId: 2, horse: "ルシード" },
  { id: 213, raceId: 2, horse: "シュタールヴィント" },
];

// jockeyScore凡例: ルメール=95, レーン=90, ディー=85, 戸崎=84, 大野=76,
//                  ゴンサルベス=75, 石川=73, 三浦=72, 津村=72, 亀田=72, 菊沢=70, 原=70, 丸田=68
export const horseFeatures = [
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

// 単勝オッズ：東京11R はスポーツナビ・競馬ブック 2ソース一致の実データ
export const marketOdds = [
  // 東京11R ジューンS(OP) 実オッズ
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
