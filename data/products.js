// 住宅会社の「商品（建て方）」データ。会社単位ではなく、建て方ごとに1行。
// tsubo: 本体工事の坪単価の目安（万円/坪）。付帯工事・外構・諸費用は app.js 側で別に計算する。
// order: full=フルオーダー（自由設計） / semi=セミオーダー（選択型） / kikaku=規格住宅
// est: true の行は、会社の価格帯からの推定値。公開前に必ず確認して est を外す。
// rec: 千葉レーダーのおすすめ度。1=いちばん推したい会社（上位に出やすく、専用の枠でも紹介） 2=おすすめ。画面に★を表示する。
// checked: この行の情報を最後に確認した日。
window.PRODUCT_DATA_UPDATED = "2026-10-29";
window.PRODUCT_DATA = [
  // ── ハイブランド ──
  { rec: 1, maker: "積水ハウス", product: "自由設計", order: "full", tsubo: [125, 180], tags: ["高級感", "街並み", "資産性", "大手安心", "大空間", "耐震"], note: "街並み・性能・安心感のバランスは大手随一。", checked: "2026-06-16" },
  { rec: 1, maker: "積水ハウス", product: "規格・企画型プラン", order: "kikaku", tsubo: [95, 125], est: true, tags: ["大手安心", "資産性", "耐震"], note: "大手の品質を、プランを絞って価格を抑えたい方に。", checked: "" },
  { rec: 1, maker: "住友林業", product: "自由設計", order: "full", tsubo: [100, 140], tags: ["木質感", "設計力", "上質", "ブランド", "平屋", "デザイン"], note: "木の質感と設計力が強み。", checked: "2026-06-16" },
  { rec: 1, maker: "住友林業", product: "規格・企画型プラン", order: "kikaku", tsubo: [80, 100], est: true, tags: ["木質感", "ブランド"], note: "住友林業らしさを残しつつ総額を抑える選択肢。", checked: "" },
  { maker: "三菱地所ホーム", product: "自由設計", order: "full", tsubo: [130, 180], tags: ["全館空調", "上質", "都市型", "高級感", "デザイン"], note: "全館空調エアロテックと上質な設計。", checked: "2026-06-16" },
  { rec: 1, maker: "ヘーベルハウス", product: "自由設計", order: "full", tsubo: [100, 140], tags: ["鉄骨", "耐久性", "防災", "都市型", "二世帯", "耐震"], note: "狭小地・3階建て・二世帯に強い鉄骨。", checked: "2026-06-16" },
  { rec: 2, maker: "パナソニックホームズ", product: "自由設計", order: "full", tsubo: [100, 155], tags: ["設備", "全館空調", "鉄骨", "家事ラク", "耐震"], note: "設備と性能のバランス、家事ラク動線。", checked: "2026-06-16" },
  { rec: 2, maker: "ミサワホーム", product: "自由設計", order: "full", tsubo: [100, 140], tags: ["蔵収納", "デザイン", "子育て", "大空間", "収納"], note: "「蔵」収納と空間設計が抜群。", checked: "2026-06-16" },
  { maker: "ダイワハウス", product: "自由設計", order: "full", tsubo: [95, 150], tags: ["鉄骨", "木造", "大手安心", "保証", "耐震"], note: "供給力と保証の安心感。", checked: "2026-06-16" },
  { rec: 2, maker: "三井ホーム", product: "自由設計", order: "full", tsubo: [90, 125], tags: ["デザイン", "全館空調", "洋風", "高級感"], note: "デザイン力と全館空調の提案。", checked: "2026-06-16" },
  { maker: "スウェーデンハウス", product: "自由設計", order: "full", tsubo: [93, 110], tags: ["高断熱", "木製サッシ", "北欧", "デザイン"], note: "北欧デザインと高断熱は唯一無二。", checked: "2026-06-16" },

  // ── ミドル ──
  { rec: 2, maker: "セキスイハイム", product: "選択型プラン", order: "semi", tsubo: [85, 120], tags: ["工場生産", "太陽光", "蓄電池", "防災", "耐震"], note: "工場生産の品質安定と、災害時の備え。", checked: "2026-06-16" },
  { maker: "トヨタホーム", product: "選択型プラン", order: "semi", tsubo: [85, 110], tags: ["鉄骨", "防災", "大手安心", "耐震"], note: "トヨタグループの鉄骨と安心感。", checked: "2026-06-16" },
  { rec: 2, maker: "一条工務店", product: "高性能プラン", order: "semi", tsubo: [80, 100], tags: ["高断熱", "性能", "太陽光", "子育て"], note: "断熱・気密の性能重視ならまず候補。", checked: "2026-06-16" },
  { maker: "アイ工務店", product: "自由設計", order: "full", tsubo: [90, 105], tags: ["自由設計", "収納", "コスパ", "大空間"], note: "自由設計と収納提案をミドル価格で。", checked: "2026-06-16" },
  { maker: "ヤマダホームズ", product: "自由設計", order: "semi", tsubo: [80, 120], tags: ["コスパ", "設備", "家事ラク", "自由設計"], note: "家電・設備込みの提案が得意。", checked: "2026-06-16" },
  { maker: "ヤマト住建", product: "高性能プラン", order: "semi", tsubo: [95, 100], tags: ["高断熱", "省エネ", "コスパ"], note: "性能を価格以上に求めたい方に。", checked: "2026-06-16" },
  { rec: 2, maker: "ウィザースホーム", product: "選択型プラン", order: "semi", tsubo: [70, 95], tags: ["外壁タイル", "コスパ", "千葉地場", "高耐久"], note: "千葉発。外壁タイルで将来のメンテ費を抑える。", checked: "2026-06-16" },
  { rec: 2, maker: "アキュラホーム", product: "自由設計", order: "semi", tsubo: [70, 90], tags: ["適正価格", "自由設計", "木造", "性能"], note: "適正価格で自由設計を叶えやすい。", checked: "2026-06-16" },

  // ── ロー・規格 ──
  { rec: 2, maker: "桧家住宅", product: "規格住宅", order: "kikaku", tsubo: [78, 100], tags: ["全館空調", "コスパ", "子育て"], note: "全館空調つきの規格住宅。", checked: "2026-06-16" },
  { rec: 2, maker: "タマホーム", product: "注文住宅", order: "semi", tsubo: [60, 85], est: true, tags: ["価格重視", "コスパ", "自由設計"], note: "価格を抑えながら間取りも相談したい方に。", checked: "" },
  { rec: 2, maker: "タマホーム", product: "規格住宅", order: "kikaku", tsubo: [40, 60], est: true, tags: ["価格重視", "コスパ"], note: "総額をしっかり抑えたい方に。", checked: "" },
  { rec: 2, maker: "セナリオハウス", product: "規格・セミオーダー", order: "kikaku", tsubo: [45, 85], tags: ["地域密着", "土地情報", "コスパ", "千葉地場"], note: "地域密着で土地探しから相談しやすい。", checked: "2026-06-16" },

  // ── 地域の工務店・設計事務所（個別社名は紹介時に） ──
  { maker: "千葉の地域工務店", product: "自由設計（設計事務所含む）", order: "full", tsubo: [65, 100], local: true, tags: ["自由設計", "千葉地場", "デザイン", "地域密着", "コスパ"], note: "会社ごとに得意が大きく違うので、条件に合う会社を個別にご紹介します。", checked: "" }
];
