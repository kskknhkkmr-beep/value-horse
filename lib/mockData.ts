// 2026-06-13 実レースデータ
// 馬名・騎手：JRA公式出馬表より（実データ）
// odds：投票前のため推定値 ※確定後に要更新
// formScore/pedigreeScore/trainingScore/jockeyScore：騎手実績・馬齢・斤量からの推定値

export const races = [
  {
    id: 1,
    date: "2026-06-13",
    venue: "東京",
    raceNumber: 11,
    raceName: "ロジェマウンテンS（OP）",
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
  // 東京11R ロジェマウンテンS 13頭
  { id: 101, raceId: 1, horse: "レガロスデイジナム" },
  { id: 102, raceId: 1, horse: "ロードヒット" },
  { id: 103, raceId: 1, horse: "ブラックアルファ" },
  { id: 104, raceId: 1, horse: "ヴェルディエドラン" },
  { id: 105, raceId: 1, horse: "ナルエドランダ" },
  { id: 106, raceId: 1, horse: "フロレオドンテ" },
  { id: 107, raceId: 1, horse: "ノーザンボープ" },
  { id: 108, raceId: 1, horse: "バルエマッジーナ" },
  { id: 109, raceId: 1, horse: "トウキョウメダルキャッシュ" },
  { id: 110, raceId: 1, horse: "デマーストコーシャ" },
  { id: 111, raceId: 1, horse: "トゥルメキナ" },
  { id: 112, raceId: 1, horse: "ナマヌマニドナ" },
  { id: 113, raceId: 1, horse: "マヤナテス" },
  // 函館11R 函館スプリントS G3 13頭（keiba-headline.com 実データ）
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

// formScore: 近走成績推定（馬齢・クラスから）
// pedigreeScore: 血統評価推定
// trainingScore: 追い切り評価推定
// jockeyScore: 騎手成績実績ベース
export const horseFeatures = [
  // 東京11R（OP） jockey: 横山典弘=78, 横山武史=84, ルメール=95, 和田=74, 四位=70, 武豊=93, 北村友一=76, 松山=82, スミヨン=90, デムーロ=88, 松岡=68
  { horseId: 101, formScore: 72, pedigreeScore: 70, trainingScore: 71, jockeyScore: 78 }, // 5歳 横山典弘
  { horseId: 102, formScore: 63, pedigreeScore: 66, trainingScore: 64, jockeyScore: 84 }, // 7歳 横山武史
  { horseId: 103, formScore: 80, pedigreeScore: 78, trainingScore: 79, jockeyScore: 95 }, // 4歳 ルメール
  { horseId: 104, formScore: 76, pedigreeScore: 72, trainingScore: 74, jockeyScore: 74 }, // 4歳 和田竜二
  { horseId: 105, formScore: 70, pedigreeScore: 68, trainingScore: 69, jockeyScore: 70 }, // 5歳 四位洋文
  { horseId: 106, formScore: 74, pedigreeScore: 76, trainingScore: 75, jockeyScore: 93 }, // 5歳 武豊
  { horseId: 107, formScore: 67, pedigreeScore: 69, trainingScore: 68, jockeyScore: 76 }, // 6歳 北村友一
  { horseId: 108, formScore: 62, pedigreeScore: 64, trainingScore: 63, jockeyScore: 82 }, // 7歳 松山弘平
  { horseId: 109, formScore: 73, pedigreeScore: 74, trainingScore: 74, jockeyScore: 90 }, // 5歳 スミヨン
  { horseId: 110, formScore: 72, pedigreeScore: 71, trainingScore: 72, jockeyScore: 88 }, // 5歳 デムーロ
  { horseId: 111, formScore: 61, pedigreeScore: 65, trainingScore: 62, jockeyScore: 95 }, // 7歳 ルメール
  { horseId: 112, formScore: 56, pedigreeScore: 58, trainingScore: 57, jockeyScore: 68 }, // 8歳 松岡正海
  { horseId: 113, formScore: 66, pedigreeScore: 67, trainingScore: 66, jockeyScore: 78 }, // 6歳 横山典弘
  // 函館11R G3 jockey: 鮫島=73, 池添=78, 横山武史=84, 丹内=65, 横山琉人=70, 松岡=68, 北村友一=76, 荻野=60, 小崎=62, 富田=63, 佐々木=60, 横山和生=72, 岩田=78
  { horseId: 201, formScore: 68, pedigreeScore: 70, trainingScore: 69, jockeyScore: 73 }, // モズナナスター 鮫島克駿 55kg
  { horseId: 202, formScore: 65, pedigreeScore: 68, trainingScore: 66, jockeyScore: 78 }, // ダノンマッキンリー 池添謙一 58kg
  { horseId: 203, formScore: 88, pedigreeScore: 84, trainingScore: 86, jockeyScore: 84 }, // レイピア 横山武史 57kg（1番人気）
  { horseId: 204, formScore: 82, pedigreeScore: 80, trainingScore: 81, jockeyScore: 65 }, // カルプスペルシュ 丹内祐次 55kg（2番人気）
  { horseId: 205, formScore: 58, pedigreeScore: 62, trainingScore: 60, jockeyScore: 70 }, // ジョーメッドヴィン 横山琉人 57kg
  { horseId: 206, formScore: 60, pedigreeScore: 65, trainingScore: 62, jockeyScore: 68 }, // ウイングレイテスト 松岡正海 58kg
  { horseId: 207, formScore: 72, pedigreeScore: 74, trainingScore: 73, jockeyScore: 76 }, // ピューロマジック 北村友一 56kg
  { horseId: 208, formScore: 62, pedigreeScore: 64, trainingScore: 63, jockeyScore: 60 }, // ポッドベイダー 荻野極 57kg
  { horseId: 209, formScore: 63, pedigreeScore: 65, trainingScore: 64, jockeyScore: 62 }, // クラスペディア 小崎綾也 57kg
  { horseId: 210, formScore: 79, pedigreeScore: 77, trainingScore: 78, jockeyScore: 63 }, // エーティーマクフィ 富田暁 58kg（3番人気）
  { horseId: 211, formScore: 68, pedigreeScore: 70, trainingScore: 69, jockeyScore: 60 }, // インビンシブルパパ 佐々木大輔 58kg
  { horseId: 212, formScore: 78, pedigreeScore: 76, trainingScore: 77, jockeyScore: 72 }, // ルシード 横山和生 57kg（4番人気）
  { horseId: 213, formScore: 54, pedigreeScore: 58, trainingScore: 56, jockeyScore: 78 }, // シュタールヴィント 岩田康誠 57kg
];

export const sentimentScores = [
  { horseId: 101, proScore: 65, youtubeScore: 60 },
  { horseId: 102, proScore: 55, youtubeScore: 50 },
  { horseId: 103, proScore: 88, youtubeScore: 85 },
  { horseId: 104, proScore: 68, youtubeScore: 64 },
  { horseId: 105, proScore: 60, youtubeScore: 58 },
  { horseId: 106, proScore: 82, youtubeScore: 80 },
  { horseId: 107, proScore: 62, youtubeScore: 60 },
  { horseId: 108, proScore: 58, youtubeScore: 55 },
  { horseId: 109, proScore: 80, youtubeScore: 78 },
  { horseId: 110, proScore: 75, youtubeScore: 72 },
  { horseId: 111, proScore: 55, youtubeScore: 52 },
  { horseId: 112, proScore: 45, youtubeScore: 42 },
  { horseId: 113, proScore: 58, youtubeScore: 56 },
  { horseId: 201, proScore: 62, youtubeScore: 60 }, // モズナナスター
  { horseId: 202, proScore: 58, youtubeScore: 55 }, // ダノンマッキンリー
  { horseId: 203, proScore: 90, youtubeScore: 88 }, // レイピア（1番人気）
  { horseId: 204, proScore: 80, youtubeScore: 78 }, // カルプスペルシュ（2番人気）
  { horseId: 205, proScore: 48, youtubeScore: 45 }, // ジョーメッドヴィン
  { horseId: 206, proScore: 50, youtubeScore: 48 }, // ウイングレイテスト
  { horseId: 207, proScore: 68, youtubeScore: 65 }, // ピューロマジック
  { horseId: 208, proScore: 52, youtubeScore: 50 }, // ポッドベイダー
  { horseId: 209, proScore: 53, youtubeScore: 50 }, // クラスペディア
  { horseId: 210, proScore: 76, youtubeScore: 74 }, // エーティーマクフィ（3番人気）
  { horseId: 211, proScore: 62, youtubeScore: 60 }, // インビンシブルパパ
  { horseId: 212, proScore: 74, youtubeScore: 72 }, // ルシード（4番人気）
  { horseId: 213, proScore: 44, youtubeScore: 42 }, // シュタールヴィント
];

// ※ 投票開始前のため推定オッズ。確定後に要更新。
export const marketOdds = [
  // 東京11R OP（13頭）
  { horseId: 101, odds: 18.0 },
  { horseId: 102, odds: 22.0 },
  { horseId: 103, odds: 3.2 },  // ルメール
  { horseId: 104, odds: 12.0 },
  { horseId: 105, odds: 25.0 },
  { horseId: 106, odds: 4.5 },  // 武豊
  { horseId: 107, odds: 20.0 },
  { horseId: 108, odds: 30.0 },
  { horseId: 109, odds: 5.5 },  // スミヨン
  { horseId: 110, odds: 7.0 },  // デムーロ
  { horseId: 111, odds: 35.0 },
  { horseId: 112, odds: 50.0 },
  { horseId: 113, odds: 28.0 },
  // 函館11R G3（13頭）想定オッズ（umanity.jp）
  { horseId: 201, odds: 22.0 },  // モズナナスター
  { horseId: 202, odds: 27.2 },  // ダノンマッキンリー
  { horseId: 203, odds: 2.7 },   // レイピア（1番人気）
  { horseId: 204, odds: 4.5 },   // カルプスペルシュ（2番人気）
  { horseId: 205, odds: 42.0 },  // ジョーメッドヴィン
  { horseId: 206, odds: 35.6 },  // ウイングレイテスト
  { horseId: 207, odds: 16.0 },  // ピューロマジック
  { horseId: 208, odds: 31.9 },  // ポッドベイダー
  { horseId: 209, odds: 30.8 },  // クラスペディア
  { horseId: 210, odds: 5.8 },   // エーティーマクフィ（3番人気）
  { horseId: 211, odds: 22.0 },  // インビンシブルパパ
  { horseId: 212, odds: 6.0 },   // ルシード（4番人気）
  { horseId: 213, odds: 57.8 },  // シュタールヴィント
];

export const finalScores = [];