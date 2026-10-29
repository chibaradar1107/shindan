(() => {
  "use strict";

  // ───────── 設定（金額はすべて万円） ─────────
  const CONFIG = {
    stationMeta: window.STATION_DATA_META || { updated: "2026-06-16", source: "千葉土地レーダー集計（掲載物件ベース・成約価格ではありません）" },
    threadsUrl: "https://www.threads.com/@chiba_home_radar",
    instagramDmUrl: "https://ig.me/m/chiba_home_radar",
    futaiRate: 0.20,          // 付帯工事：本体の約2割（地盤改良・給排水・照明カーテン等）
    landCostRate: 0.07,       // 土地の諸費用：仲介手数料・登記・税
    buildCostRate: 0.06,      // 建物の諸費用：ローン手数料・登記・火災保険
    reserveRate: 0.03,        // 予備費
    gaikouBase: 100,          // 外構：基本 + 土地1坪あたり
    gaikouPerTsubo: 3,
    gaikouOwnLand: 150,
    demolitionPerTsubo: 4.5,  // 建て替えの解体費
    unitPosition: 0.35,       // 坪単価レンジのどこを概算に使うか（0=下限, 1=上限）
    loan: { rate: 0.010, years: 35, ratio: 0.20 },
    saveTarget: 0.90,         // 総額を抑える案は予算の9割に収める
    fewDataCount: 20
  };

  const WALK = {
    near: { label: "徒歩10分以内", short: "徒歩10分", factor: 1.15 },
    mid: { label: "徒歩15分くらい", short: "徒歩15分", factor: 1.0 },
    bus: { label: "徒歩20分・バス便も可", short: "バス可", factor: 0.8 }
  };

  const ORDER = {
    full: { label: "フルオーダー（自由設計）", short: "フルオーダー" },
    semi: { label: "セミオーダー（選択型）", short: "セミオーダー" },
    kikaku: { label: "規格住宅", short: "規格住宅" }
  };

  const PRIORITIES = [
    { id: "price", label: "価格を抑えたい", tags: ["コスパ", "価格重視", "適正価格"] },
    { id: "insul", label: "断熱・省エネ", tags: ["高断熱", "性能", "省エネ", "全館空調", "太陽光", "木製サッシ"] },
    { id: "quake", label: "耐震・災害に強い", tags: ["耐震", "鉄骨", "防災", "耐久性", "工場生産", "蓄電池"] },
    { id: "design", label: "デザイン・雰囲気", tags: ["デザイン", "設計力", "上質", "洋風", "北欧", "木質感", "高級感"] },
    { id: "chores", label: "家事動線・収納", tags: ["家事ラク", "収納", "蔵収納", "設備"] },
    { id: "space", label: "広さ・庭", tags: ["大空間", "平屋"] },
    { id: "kids", label: "子育てしやすさ", tags: ["子育て", "収納"] },
    { id: "commute", label: "通勤・駅近", tags: [] },
    { id: "asset", label: "資産性・大手の安心", tags: ["資産性", "大手安心", "保証", "ブランド", "街並み"] },
    { id: "mainte", label: "メンテ費を抑える", tags: ["外壁タイル", "高耐久", "耐久性", "工場生産"] }
  ];

  const CITY_GROUPS = [
    { label: "東葛エリア", cities: ["松戸市", "柏市", "流山市", "我孫子市", "野田市", "鎌ケ谷市"] },
    { label: "湾岸・葛南エリア", cities: ["市川市", "船橋市", "習志野市", "浦安市", "八千代市"] },
    { label: "千葉市", cities: ["千葉市中央区", "千葉市稲毛区", "千葉市美浜区", "千葉市花見川区", "千葉市若葉区", "千葉市緑区"] },
    { label: "北総・印旛エリア", cities: ["印西市", "白井市", "佐倉市", "四街道市", "成田市", "酒々井町", "八街市"] },
    { label: "外房・東部エリア", cities: ["大網白里市", "茂原市", "山武市", "旭市", "匝瑳市"] }
  ];

  const COMMUTE = {
    tokyo: { label: "都内へ電車通勤", lines: ["JR総武線", "JR京葉線", "JR常磐線", "東京メトロ東西線", "JR武蔵野線", "京成本線", "北総線", "東葉高速鉄道", "東武野田線"] },
    chiba: { label: "千葉市・県内へ電車通勤", lines: ["JR総武線", "京成千葉線", "JR外房線", "京成千原線", "JR総武本線", "JR京葉線", "京成本線"] },
    car: { label: "車通勤が中心", lines: [] },
    home: { label: "在宅が多い・特になし", lines: [] }
  };

  // ───────── データ準備 ─────────
  const RAW = window.STATION_PRICE_DATA || [];
  const CITY_OF = window.STATION_CITY_MAP || {};
  const PRODUCTS = (window.PRODUCT_DATA || []).map((p, i) => ({ ...p, id: i }));

  // 同じ駅が複数路線にある場合はまとめる（坪単価は平均）
  const STATIONS = (() => {
    const map = new Map();
    RAW.forEach(r => {
      const city = CITY_OF[r.s] || "";
      if (!city || city.includes("東京")) return;
      if (!map.has(r.s)) map.set(r.s, { name: r.s, city, lines: [], tps: [], n: null, prev: false });
      const st = map.get(r.s);
      st.lines.push(r.l);
      st.tps.push(r.tp);
      // 自動更新後は同じ駅コードの件数が路線ごとに重複するので、合計ではなく最大をとる
      if (r.n != null) st.n = Math.max(st.n || 0, r.n);
      if (r.src === "prev") st.prev = true;
      // 国交省の実取引（バス圏を含むエリア全体）。同じ駅なら路線が違っても同じ値
      if (r.area != null) { st.area = r.area; st.an = r.an; }
    });
    return [...map.values()].map(st => ({ ...st, tp: avg(st.tps) }));
  })();
  const LINES = [...new Set(RAW.map(r => r.l))];

  {
    const m = CONFIG.stationMeta;
    const el = document.getElementById("dataSource");
    if (el) el.textContent = `駅別坪単価：${m.source}（最終更新 ${m.updated}）。`;
    const hc = document.getElementById("heroCount");
    if (hc) hc.textContent = STATIONS.length;
  }

  // ───────── 状態 ─────────
  const state = {
    land: null, budget: null, income: null, down: 0,
    areaMode: "city", cities: [], lines: [],
    commute: null, walk: "mid",
    family: null, rooms: null, parking: null,
    priorities: [], freedom: null,
    landTsubo: null, floorTsubo: null,
    plan: 0, consultDirty: false, brandPicks: []
  };
  let stepIndex = 0;

  // ───────── 質問 ─────────
  const QUESTIONS = [
    {
      id: "land", title: "土地はどうしますか？", auto: true,
      render: () => opts("land", [
        ["search", "これから探す", "土地と建物をセットで考える"],
        ["own", "土地はある", "親の土地・購入済みなど"],
        ["rebuild", "建て替え", "今の家を解体して建てる"]
      ]),
      valid: () => !!state.land
    },
    {
      id: "budget", title: "総予算はどのくらいですか？",
      help: () => state.land === "search" ? "土地・建物・付帯工事・外構・諸費用をぜんぶ含めた金額です。" : "建物・付帯工事・外構・諸費用をぜんぶ含めた金額です（土地代は除く）。",
      render: () => {
        const list = state.land === "search"
          ? [[3500, "3,500万円まで"], [4500, "4,500万円まで"], [5500, "5,500万円まで"], [6500, "6,500万円まで"], [8000, "8,000万円まで"], [10000, "1億円まで"]]
          : [[2000, "2,000万円まで"], [2500, "2,500万円まで"], [3000, "3,000万円まで"], [4000, "4,000万円まで"], [5000, "5,000万円まで"], [7000, "7,000万円まで"]];
        let h = `<div class="opts cols-2">` + list.map(([v, l]) => optBtn("budget", v, l)).join("") + `</div>`;
        h += `<div class="opts" style="margin-top:8px">${optBtn("budget", "unknown", "まだ分からない", "年収から借入の目安を出します")}</div>`;
        if (state.budget === "unknown") {
          h += `<p class="q-sub">世帯年収（税込）</p><div class="chips">` +
            [400, 500, 600, 700, 800, 1000, 1200].map(v => chip("income", v, v === 1200 ? "1,200万円〜" : `${fmt(v)}万円`)).join("") +
            chip("income", "unknown", "分からない") + `</div>`;
          h += `<p class="q-sub">頭金・親からの援助</p><div class="chips">` +
            [[0, "なし"], [300, "300万円"], [500, "500万円"], [1000, "1,000万円"], [2000, "2,000万円〜"]].map(([v, l]) => chip("down", v, l)).join("") + `</div>`;
          h += `<p class="note-box">返済負担率20%・金利${(CONFIG.loan.rate * 100).toFixed(1)}%・${CONFIG.loan.years}年の、無理のない借入額で計算します。</p>`;
        }
        return h;
      },
      valid: () => typeof state.budget === "number" || (state.budget === "unknown" && state.income != null)
    },
    {
      id: "area", title: () => state.land === "search" ? "住みたいエリアは？" : "建てる場所はどこですか？",
      help: () => state.land === "search" ? "いくつ選んでもOK。迷ったら「おまかせ」で、通勤条件から候補を出します。" : "分かる範囲で大丈夫です（相談文に入ります）。",
      render: () => {
        if (state.land !== "search") return cityChips();
        let h = `<div class="tabs" role="tablist">` +
          [["city", "市町村で選ぶ"], ["line", "沿線で選ぶ"], ["auto", "おまかせ"]].map(([v, l]) =>
            `<button class="tab" role="tab" aria-selected="${state.areaMode === v}" data-tab="${v}">${l}</button>`).join("") + `</div>`;
        if (state.areaMode === "city") h += cityChips();
        else if (state.areaMode === "line") h += `<div class="chips">` + LINES.map(l => {
          const c = STATIONS.filter(s => s.lines.includes(l)).length;
          return chipMulti("lines", l, `${l}<small>${c}駅</small>`);
        }).join("") + `</div>`;
        else h += `<p class="note-box">次の質問の通勤条件と予算から、千葉県内の${STATIONS.length}駅から候補を探します。</p>`;
        const picked = state.areaMode === "city" ? STATIONS.filter(s => state.cities.includes(s.city)).length
          : state.areaMode === "line" ? STATIONS.filter(s => s.lines.some(l => state.lines.includes(l))).length : 0;
        if (picked) h += `<p class="picked">選択中：${picked}駅をスキャンします</p>`;
        return h;
      },
      valid: () => state.land !== "search" || state.areaMode === "auto" || (state.areaMode === "city" ? state.cities.length > 0 : state.lines.length > 0)
    },
    {
      id: "commute", title: "通勤・駅までの距離は？",
      render: () => {
        let h = `<p class="q-sub">ふだんの通勤</p>` + opts("commute", Object.entries(COMMUTE).map(([k, v]) => [k, v.label]), "cols-2");
        if (state.land === "search") {
          h += `<p class="q-sub">駅からの距離（あとで変えて比べられます）</p>` + opts("walk", Object.entries(WALK).map(([k, v]) => [k, v.label]));
        }
        return h;
      },
      valid: () => !!state.commute && !!state.walk
    },
    {
      id: "family", title: "家族と暮らし方は？",
      render: () => {
        let h = `<p class="q-sub">住む人数</p><div class="chips big">` + [[2, "2人"], [3, "3人"], [4, "4人"], [5, "5人以上"]].map(([v, l]) => chip("family", v, l)).join("") + `</div>`;
        h += `<p class="q-sub">ほしい間取り</p><div class="chips big">` + [[2, "2LDK"], [3, "3LDK"], [4, "4LDK"], [5, "5LDK以上"]].map(([v, l]) => chip("rooms", v, l)).join("") + `</div>`;
        h += `<p class="q-sub">駐車台数</p><div class="chips big">` + [[0, "なし"], [1, "1台"], [2, "2台"], [3, "3台以上"]].map(([v, l]) => chip("parking", v, l)).join("") + `</div>`;
        return h;
      },
      valid: () => state.family != null && state.rooms != null && state.parking != null
    },
    {
      id: "priorities", title: "大切にしたいことを3つまで",
      help: () => "選んだ順に優先度が高くなります。",
      render: () => `<div class="opts cols-2">` + PRIORITIES.map(p => {
        const i = state.priorities.indexOf(p.id);
        return `<button class="opt" type="button" data-prio="${p.id}" aria-pressed="${i >= 0}">${i >= 0 ? `<span class="rank">${i + 1}</span>` : ""}<strong>${p.label}</strong></button>`;
      }).join("") + `</div>`,
      valid: () => state.priorities.length > 0
    },
    {
      id: "freedom", title: "間取りの自由度は？", auto: true,
      render: () => opts("freedom", [
        ["full", "自由に決めたい", "フルオーダー・自由設計"],
        ["semi", "選択式でもよい", "決まった中から選ぶセミオーダー"],
        ["price", "価格優先", "規格住宅も大歓迎"],
        ["unknown", "まだ分からない", "3つの案で比べて決めたい"]
      ]),
      valid: () => !!state.freedom
    }
  ];

  // ───────── UI部品 ─────────
  function optBtn(key, value, label, sub) {
    const on = String(state[key]) === String(value);
    return `<button class="opt" type="button" data-key="${key}" data-value="${value}" aria-pressed="${on}"><strong>${label}</strong>${sub ? `<small>${sub}</small>` : ""}</button>`;
  }
  function opts(key, list, cls = "") {
    return `<div class="opts ${cls}">` + list.map(([v, l, s]) => optBtn(key, v, l, s)).join("") + `</div>`;
  }
  function chip(key, value, label) {
    const on = String(state[key]) === String(value);
    return `<button class="chip" type="button" data-key="${key}" data-value="${value}" aria-pressed="${on}">${label}</button>`;
  }
  function chipMulti(key, value, label) {
    return `<button class="chip" type="button" data-multi="${key}" data-value="${value}" aria-pressed="${state[key].includes(value)}">${label}</button>`;
  }
  function cityChips() {
    return CITY_GROUPS.map(g => `<p class="group-label">${g.label}</p><div class="chips">` + g.cities.map(c => {
      const sts = STATIONS.filter(s => s.city === c);
      const range = sts.length ? `${Math.round(Math.min(...sts.map(s => s.tp)))}〜${Math.round(Math.max(...sts.map(s => s.tp)))}万/坪` : "";
      return chipMulti("cities", c, `${c.replace("千葉市", "")}<small>${range}</small>`);
    }).join("") + `</div>`).join("");
  }

  // ───────── 画面遷移 ─────────
  const $ = sel => document.querySelector(sel);
  function show(name) {
    document.querySelectorAll(".screen").forEach(s => { s.hidden = s.dataset.screen !== name; });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function renderQuestion(animate = false) {
    const q = QUESTIONS[stepIndex];
    const title = typeof q.title === "function" ? q.title() : q.title;
    const help = q.help ? q.help() : "";
    $("#progressBar").style.width = `${((stepIndex + 1) / QUESTIONS.length) * 100}%`;
    $("#stepCount").textContent = `${stepIndex + 1} / ${QUESTIONS.length}`;
    $("#question").innerHTML = `<div class="${animate ? "q-anim" : ""}"><h2 class="q-title">${title}</h2>${help ? `<p class="q-help">${help}</p>` : ""}${q.render()}</div>`;
    $("#nextBtn").disabled = !q.valid();
    $("#nextBtn").textContent = stepIndex === QUESTIONS.length - 1 ? "診断する" : "次へ";
  }

  document.addEventListener("click", e => {
    const go = e.target.closest("[data-go]");
    if (go) {
      e.preventDefault();
      if (go.dataset.go === "intro") show("intro");
      else { stepIndex = 0; show("quiz"); renderQuestion(true); }
      return;
    }
    const q = e.target.closest("#question");
    if (!q) return;
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.tab) state.areaMode = b.dataset.tab;
    else if (b.dataset.multi) {
      const arr = state[b.dataset.multi], v = b.dataset.value, i = arr.indexOf(v);
      i >= 0 ? arr.splice(i, 1) : arr.push(v);
    } else if (b.dataset.prio) {
      const i = state.priorities.indexOf(b.dataset.prio);
      if (i >= 0) state.priorities.splice(i, 1);
      else if (state.priorities.length < 3) state.priorities.push(b.dataset.prio);
      else toast("3つまで選べます");
    } else if (b.dataset.key) {
      const v = b.dataset.value;
      state[b.dataset.key] = /^\d+$/.test(v) ? Number(v) : v;
      if (b.dataset.key === "land") { state.budget = null; }
    }
    renderQuestion();
    // 1つ選べば決まる質問は、そのまま次へ進む
    const cur = QUESTIONS[stepIndex];
    const single = cur.auto || (cur.id === "budget" && typeof state.budget === "number");
    if (single && b.dataset.key && cur.valid()) setTimeout(goNext, 260);
  });

  function goNext() {
    if (!QUESTIONS[stepIndex].valid()) return;
    if (stepIndex < QUESTIONS.length - 1) { stepIndex++; renderQuestion(true); window.scrollTo({ top: 0 }); }
    else startResult();
  }
  $("#nextBtn").addEventListener("click", goNext);
  $("#backBtn").addEventListener("click", () => {
    if (stepIndex === 0) show("intro");
    else { stepIndex--; renderQuestion(true); }
  });

  // ───────── 計算 ─────────
  function avg(a) { return a.reduce((s, x) => s + x, 0) / a.length; }
  function median(a) {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function round10(x) { return Math.round(x / 10) * 10; }
  function fmt(x) { return Math.round(x).toLocaleString("ja-JP"); }
  function man(x) { return `${fmt(round10(x))}万円`; }

  function loanAmount(income) {
    const { rate, years, ratio } = CONFIG.loan;
    const r = rate / 12, n = years * 12, monthly = income * ratio / 12;
    return monthly * (1 - Math.pow(1 + r, -n)) / r;
  }
  function resolveBudget() {
    if (typeof state.budget === "number") return { value: state.budget, note: "" };
    if (state.income === "unknown") return { value: 5000, note: "年収が分からないため、仮に総予算5,000万円で計算しています。" };
    const loan = round10(loanAmount(state.income));
    return { value: loan + state.down, note: `年収${fmt(state.income)}万円の無理のない借入額 約${fmt(loan)}万円 ＋ 頭金${fmt(state.down)}万円で計算しています。` };
  }

  function defaultFloor() { return { 2: 26, 3: 30, 4: 34, 5: 40 }[state.rooms] + (state.family >= 5 && state.rooms < 5 ? 2 : 0); }
  function defaultLand(floor) {
    // 2階建て・建ぺい率50%想定で延床と同じ広さ ＋ 駐車1台3.5坪 ＋ 庭を重視するなら+8坪
    const t = floor + state.parking * 3.5 + (state.priorities.includes("space") ? 8 : 0);
    return Math.max(30, Math.round(t));
  }

  function unitOf(p) { return p.tsubo[0] + (p.tsubo[1] - p.tsubo[0]) * CONFIG.unitPosition; }

  function breakdown(p, tp, landTsubo, floorTsubo) {
    const buying = state.land === "search";
    const unit = unitOf(p);
    const items = [];
    const landPrice = buying ? tp * landTsubo : 0;
    if (buying) items.push({ k: "land", label: "土地", note: `${landTsubo}坪 × ${Math.round(tp)}万円/坪`, v: landPrice });
    if (state.land === "rebuild") items.push({ k: "demo", label: "解体工事", note: "既存の家の解体", v: floorTsubo * CONFIG.demolitionPerTsubo });
    const honntai = unit * floorTsubo;
    items.push({ k: "body", label: "建物本体", note: `${floorTsubo}坪 × ${Math.round(unit)}万円/坪`, v: honntai });
    items.push({ k: "futai", label: "付帯工事", note: "地盤改良・給排水・照明カーテンなど", v: honntai * CONFIG.futaiRate });
    items.push({ k: "gaikou", label: "外構", note: "駐車場・フェンス・植栽", v: buying ? CONFIG.gaikouBase + landTsubo * CONFIG.gaikouPerTsubo : CONFIG.gaikouOwnLand });
    items.push({ k: "fee", label: "諸費用", note: "仲介手数料・登記・ローン・保険", v: landPrice * CONFIG.landCostRate + honntai * (1 + CONFIG.futaiRate) * CONFIG.buildCostRate });
    const sub = items.reduce((s, i) => s + i.v, 0);
    items.push({ k: "reserve", label: "予備費", note: "想定外の追加に備える", v: sub * CONFIG.reserveRate });
    const total = items.reduce((s, i) => s + i.v, 0);
    return { items, total, unit };
  }
  // この商品で予算内に収まる土地の坪単価の上限
  function maxTp(p, budget, landTsubo, floorTsubo) {
    const zero = breakdown(p, 0, landTsubo, floorTsubo).total;
    const per = landTsubo * (1 + CONFIG.landCostRate) * (1 + CONFIG.reserveRate);
    return (budget - zero) / per;
  }

  function scoreProduct(p, opt = {}) {
    let score = 0;
    const matched = [];
    state.priorities.forEach((id, rank) => {
      const pr = PRIORITIES.find(x => x.id === id);
      const w = 3 - rank;
      const hit = p.tags.filter(t => pr.tags.includes(t));
      if (hit.length) { score += w * 8; matched.push(`「${pr.label}」に強い（${hit.slice(0, 2).join("・")}）`); }
      if (id === "price") score += w * (110 - unitOf(p)) / 6;
    });
    const fit = {
      full: { full: 16, semi: 6, kikaku: 0 },
      semi: { full: 8, semi: 16, kikaku: 8 },
      price: { full: 0, semi: 10, kikaku: 16 },
      unknown: { full: 4, semi: 8, kikaku: 4 }
    }[state.freedom][p.order];
    score += fit;
    if (opt.cheap) score += (110 - unitOf(p)) / 3;
    if (p.local && state.priorities.includes("design")) score += 3;
    score += { 1: 22, 2: 11 }[p.rec] || 0;   // 千葉レーダーのおすすめ会社
    return { score, matched };
  }

  function selectedStations() {
    const walk = WALK[state.walk].factor;
    let list;
    if (state.areaMode === "city") list = STATIONS.filter(s => state.cities.includes(s.city));
    else if (state.areaMode === "line") list = STATIONS.filter(s => s.lines.some(l => state.lines.includes(l)));
    else {
      const ls = COMMUTE[state.commute].lines;
      list = ls.length ? STATIONS.filter(s => s.lines.some(l => ls.includes(l))) : STATIONS.slice();
    }
    return list.map(s => ({ ...s, tpAdj: s.tp * walk }));
  }
  function allStations() {
    const walk = WALK[state.walk].factor;
    return STATIONS.map(s => ({ ...s, tpAdj: s.tp * walk }));
  }
  function areaLabel() {
    if (state.land !== "search") return state.cities.length ? state.cities.join("・") : "未定";
    if (state.areaMode === "city") return state.cities.join("・");
    if (state.areaMode === "line") return state.lines.join("・");
    return `おまかせ（${COMMUTE[state.commute].label}）`;
  }

  function diagnose(t) {
    const { budget, landTsubo: L, floorTsubo: F } = t;
    const buying = state.land === "search";
    const plans = [];

    if (!buying) {
      [["full", "こだわり案", "フルオーダーで間取りも仕様も自由に。"],
       ["semi", "バランス案", "選択型で、こだわる所と抑える所を分ける。"],
       ["kikaku", "総額を抑える案", "規格住宅で予算に余裕を残す。"]].forEach(([order, name, lead], i) => {
        const target = i === 2 ? budget * CONFIG.saveTarget : budget;
        const ps = PRODUCTS.filter(p => p.order === order || (order === "kikaku" && p.order === "semi" && unitOf(p) < 75))
          .map(p => ({ ...p, ...scoreProduct(p, { cheap: i === 2 }), ...(() => { const b = breakdown(p, 0, L, F); return { total: b.total }; })() }))
          .map(p => ({ ...p, fits: p.total <= target }))
          .sort((a, b) => (b.fits - a.fits) || (i === 2 ? a.total - b.total : b.score - a.score));
        const top = ps[0];
        const give = [];
        if (!top.fits) give.push(`総額が約${man(top.total - target)}オーバー。延床を${Math.max(22, F - 4)}坪くらいにすると近づきます。`);
        if (order === "kikaku") give.push("間取りは決まったプランから選ぶ形になります。");
        if (order === "full" && top.fits) give.push("打ち合わせの回数が多く、決めることも増えます。");
        plans.push({
          key: order, name, lead, stations: [], products: ps.slice(0, 3), top, tp: 0, L, F, target,
          bd: breakdown(top, 0, L, F), give,
          checks: nextChecks()
        });
      });
      return plans;
    }

    const sel = selectedStations();
    const tpRef = median(sel.map(s => s.tpAdj));
    const selNames = new Set(sel.map(s => s.name));
    const selLines = new Set(sel.flatMap(s => s.lines));
    const commuteLines = COMMUTE[state.commute].lines;

    // ── A：エリア優先 ──
    {
      const ps = PRODUCTS.map(p => {
        const b = breakdown(p, tpRef, L, F);
        return { ...p, ...scoreProduct(p), total: b.total, fits: b.total <= budget };
      });
      const fitting = ps.filter(p => p.fits).sort((a, b) => b.score - a.score);
      const products = fitting.length ? fitting.slice(0, 3) : ps.sort((a, b) => a.total - b.total).slice(0, 3);
      const top = products[0];
      const limit = maxTp(top, budget, L, F);
      const ok = sel.filter(s => s.tpAdj <= limit).sort((a, b) => b.tpAdj - a.tpAdj);
      const stations = (ok.length ? ok : [...sel].sort((a, b) => a.tpAdj - b.tpAdj)).slice(0, 4).map(s => ({ ...s, total: breakdown(top, s.tpAdj, L, F).total }));
      const give = [];
      const want = state.freedom === "full" ? "full" : state.freedom === "semi" ? "semi" : null;
      if (want && top.order !== want) give.push(`間取りの自由度を「${ORDER[want].short}」→「${ORDER[top.order].short}」に下げて予算を合わせています。`);
      if (!fitting.length) {
        const cheapest = breakdown(top, stations[0].tpAdj, L, F).total;
        give.push(cheapest <= budget
          ? `希望エリアの平均的な相場だと約${man(top.total - budget)}オーバー。予算内に収まるのは、相場が低めの駅です。`
          : `いちばん安い組み合わせでも約${man(top.total - budget)}オーバー。土地の広さや駅距離をゆるめる必要があります。`);
      }
      if (ok.length && ok.length < sel.length) give.push(`選んだエリア${sel.length}駅のうち、予算内は${ok.length}駅。人気駅は予算オーバーです。`);
      plans.push({
        key: "area", name: "希望エリア優先案", lead: "場所はゆずらず、建て方で予算を合わせる。",
        stations, stationsOk: ok.length, stationsAll: sel.length, products, top, tp: tpRef, L, F, target: budget,
        bd: breakdown(top, stations[0].tpAdj, L, F), give, checks: nextChecks()
      });
    }

    // ── B：家のこだわり優先 ──
    {
      const levels = { full: ["full"], semi: ["semi", "full"], price: ["semi"], unknown: ["full", "semi"] }[state.freedom];
      const all = allStations();
      // 県内で3駅以上は建てられる商品の中から、いちばん条件に合うものを選ぶ
      const ps = PRODUCTS.filter(p => levels.includes(p.order)).map(p => {
        const lim = maxTp(p, budget, L, F);
        return { ...p, ...scoreProduct(p), reach: all.filter(s => s.tpAdj <= lim).length };
      }).sort((a, b) => ((b.reach >= 3) - (a.reach >= 3)) || (b.score - a.score));
      if (ps[0].reach < 3) ps.sort((a, b) => b.reach - a.reach || unitOf(a) - unitOf(b));
      const top = ps[0];
      const limit = maxTp(top, budget, L, F);
      const cands = all.filter(s => s.tpAdj <= limit).map(s => {
        let r = s.tpAdj / 2;
        if (selNames.has(s.name)) r += 100;
        if (s.lines.some(l => selLines.has(l))) r += 40;
        if (s.lines.some(l => commuteLines.includes(l))) r += 20;
        return { ...s, rank: r };
      }).sort((a, b) => b.rank - a.rank);
      const stations = (cands.length ? cands : all.sort((a, b) => a.tpAdj - b.tpAdj)).slice(0, 4)
        .map(s => ({ ...s, total: breakdown(top, s.tpAdj, L, F).total }));
      const products = ps.slice(0, 3).map(p => ({ ...p, total: breakdown(p, stations[0].tpAdj, L, F).total })).map(p => ({ ...p, fits: p.total <= budget }));
      const give = [];
      const outside = stations.filter(s => !selNames.has(s.name));
      if (!cands.length) give.push(`千葉県内のどの駅でも約${man(stations[0].total - budget)}オーバー。延床や土地を小さくする必要があります。`);
      else if (outside.length) give.push(`希望エリアの外（${outside.slice(0, 3).map(s => s.name).join("・")}）まで広げています。通勤時間を確認してください。`);
      if (state.walk === "near") give.push("駅距離を「徒歩15分」に広げると、候補の駅が増えます。");
      plans.push({
        key: "house", name: "家のこだわり優先案", lead: `${ORDER[top.order].short}で建てられる街を、県内から探す。`,
        stations, products, top, tp: stations[0].tpAdj, L, F, target: budget,
        bd: breakdown(top, stations[0].tpAdj, L, F), give, checks: nextChecks(),
        limitTp: limit
      });
    }

    // ── C：総額を抑える ──
    {
      const target = budget * CONFIG.saveTarget;
      const L2 = Math.max(28, L - 4), F2 = Math.max(24, F - 2);
      const ps = PRODUCTS.filter(p => p.order !== "full" || p.local).map(p => {
        const b = breakdown(p, tpRef, L2, F2);
        return { ...p, ...scoreProduct(p, { cheap: true }), total: b.total, fits: b.total <= target };
      });
      let products = ps.filter(p => p.fits).sort((a, b) => b.score - a.score).slice(0, 3);
      let pool = sel;
      if (!products.length) {
        // 希望エリアで収まらなければ、同じ沿線のもう少し安い駅まで広げる
        products = ps.sort((a, b) => a.total - b.total).slice(0, 3);
        pool = allStations().filter(s => s.lines.some(l => selLines.has(l)) || selNames.has(s.name));
      }
      const top = products[0];
      const limit = maxTp(top, target, L2, F2);
      const ok = pool.filter(s => s.tpAdj <= limit).sort((a, b) => b.tpAdj - a.tpAdj);
      const stations = (ok.length ? ok : [...pool].sort((a, b) => a.tpAdj - b.tpAdj)).slice(0, 4).map(s => ({ ...s, total: breakdown(top, s.tpAdj, L2, F2).total }));
      const tp = stations[0].tpAdj;
      const bd = breakdown(top, tp, L2, F2);
      const give = [];
      give.push(`土地 ${L}坪→${L2}坪、延床 ${F}坪→${F2}坪に少しコンパクトにしています。`);
      give.push(`${ORDER[top.order].short}で、仕様は標準から選ぶ前提です。`);
      if (pool !== sel) give.push("希望エリアでは9割に収まらないため、同じ沿線の駅まで広げています。");
      const spare = budget - bd.total;
      plans.push({
        key: "save", name: "総額を抑える案", lead: spare > 0 ? `予算に約${man(spare)}の余裕を残す。` : "できるだけ総額を下げる組み合わせ。",
        stations, products: products.map(p => ({ ...p, total: breakdown(p, tp, L2, F2).total })).map(p => ({ ...p, fits: p.total <= budget })),
        top, tp, L: L2, F: F2, target: budget, bd, give, checks: nextChecks(), spare
      });
    }
    return plans;
  }

  function nextChecks() {
    const c = [];
    if (state.land === "search") {
      c.push("気になる駅の「徒歩圏の土地」の実際の売出価格（駅の平均と差が出やすい）");
      c.push("ハザードマップ（浸水・液状化・土砂災害）");
      c.push("建ぺい率・容積率で、希望の広さと駐車台数が取れるか");
    }
    if (state.land === "rebuild") c.push("解体費と、工事中の仮住まい費用の見積もり");
    if (state.land === "own") c.push("地盤調査・上下水道の引き込み状況（付帯工事が増えやすい所）");
    c.push("見積もりに付帯工事・外構・諸費用が含まれているか");
    c.push("標準仕様の断熱等級・耐震等級");
    c.push("住宅ローンの事前審査で、借入額と金利を確定");
    return c;
  }

  // 駅距離の条件を変えると、希望の建て方で建てられる駅がいくつあるか
  function walkComparison(t, plan) {
    if (state.land !== "search") return "";
    const base = selectedStations().map(s => s.tp);
    const limit = maxTp(plan.top, t.budget, t.landTsubo, t.floorTsubo);
    const counts = Object.values(WALK).map(w => base.filter(tp => tp * w.factor <= limit).length);
    const parts = Object.values(WALK).map((w, i) => `${w.short} <b>${counts[i]}</b>駅`);
    const hint = counts.every(n => n === 0) ? "<br>どの距離でも0駅です。土地の広さか総予算を動かしてみてください。" : "";
    return `<div class="delta">「${plan.top.maker}（${ORDER[plan.top.order].short}）」で予算内の駅（選んだ${base.length}駅中）：${parts.join(" ／ ")}${hint}</div>`;
  }

  // ───────── 結果画面 ─────────
  let tune = null;

  function startResult() {
    const b = resolveBudget();
    const F = defaultFloor();
    tune = { budget: b.value, budgetNote: b.note, floorTsubo: F, landTsubo: defaultLand(F) };
    state.plan = 0;
    state.consultDirty = false;
    state.brandPicks = [];
    show("scanning");
    const n = state.land === "search" ? selectedStations().length : PRODUCTS.length;
    $("#scanText").textContent = state.land === "search"
      ? `${n}駅 × ${PRODUCTS.length}の建て方を、総額で計算しています…`
      : `${PRODUCTS.length}の建て方を、総額で計算しています…`;
    setTimeout(() => { show("result"); renderResultShell(); renderResultBody(); }, 1300);
  }

  function renderResultShell() {
    const buying = state.land === "search";
    const bMin = buying ? 2500 : 1200, bMax = buying ? 12000 : 8000;
    const wide = window.matchMedia("(min-width: 980px)").matches;
    $("#result").innerHTML = `
      <div class="result-grid">
        <aside class="result-side">
          <div id="summary"></div>
          <details class="tuner" ${wide ? "open" : ""}>
            <summary><h3>条件を動かして比べる</h3><span class="chev">▼</span></summary>
            <p class="tuner-now" id="tunerNow"></p>
            <div class="tuner-body">
              <div class="tune-row"><label>総予算 <output id="oBudget"></output></label>
                <input type="range" id="tBudget" min="${bMin}" max="${bMax}" step="100" value="${tune.budget}"></div>
              ${buying ? `<div class="tune-row"><label>駅からの距離</label><div class="seg" id="tWalk">${Object.entries(WALK).map(([k, w]) => `<button type="button" data-walk="${k}" aria-pressed="${state.walk === k}">${w.short}</button>`).join("")}</div></div>
              <div class="tune-row"><label>土地の広さ <output id="oLand"></output></label>
                <input type="range" id="tLand" min="25" max="80" step="1" value="${tune.landTsubo}"></div>` : ""}
              <div class="tune-row"><label>建物の広さ（延床） <output id="oFloor"></output></label>
                <input type="range" id="tFloor" min="22" max="50" step="1" value="${tune.floorTsubo}"></div>
              <div id="walkDelta"></div>
            </div>
          </details>
        </aside>
        <div class="result-main">
          <div class="section-head"><h3>3つの案</h3><p>タップで詳しく</p></div>
          <div class="plan-cards" role="tablist" id="planCards"></div>
          <div class="dots-nav" id="planDots"></div>
          <div id="planBody"></div>
          <div id="brands"></div>
          <div class="consult" id="consult">
            <p class="eyebrow">CONSULT</p>
            <h3>この条件で本当に建てられるか、<br>千葉レーダーに相談する</h3>
            <p>診断の内容を相談文にしました。そのままでも、書き足しても大丈夫です。</p>
            <textarea id="consultText" aria-label="相談文"></textarea>
            <div class="actions">
              <a class="btn-ember btn-wide" id="toThreads" href="${CONFIG.threadsUrl}" target="_blank" rel="noopener">相談文をコピーしてThreadsを開く</a>
              <button class="btn-light btn-wide" type="button" id="copyOnly">コピーだけする</button>
            </div>
            <ol class="steps">
              <li>ボタンを押すと相談文がコピーされ、千葉レーダーのThreadsが開きます</li>
              <li>プロフィールの「メッセージ」から、貼り付けて送信</li>
            </ol>
            <p class="sub-link"><a href="${CONFIG.instagramDmUrl}" target="_blank" rel="noopener">InstagramのDMで送る場合はこちら</a></p>
            <p class="disclose" id="disclose"></p>
          </div>
          <div class="restart"><button class="btn-ghost" type="button" id="restart">条件を選び直す</button></div>
        </div>
      </div>
      <div class="result-pad"></div>
      <div class="sticky-cta" id="stickyCta"><a class="btn-ember" href="#consult">この結果をThreadsで相談する</a></div>`;

    $("#tBudget").addEventListener("input", e => { tune.budget = +e.target.value; renderResultBody(); });
    $("#tFloor").addEventListener("input", e => { tune.floorTsubo = +e.target.value; renderResultBody(); });
    if (buying) {
      $("#tLand").addEventListener("input", e => { tune.landTsubo = +e.target.value; renderResultBody(); });
      $("#tWalk").addEventListener("click", e => {
        const b = e.target.closest("[data-walk]"); if (!b) return;
        state.walk = b.dataset.walk;
        $("#tWalk").querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b));
        renderResultBody();
      });
    }
    $("#planCards").addEventListener("click", e => {
      const b = e.target.closest("[data-plan]"); if (!b) return;
      state.plan = +b.dataset.plan;
      renderResultBody();
      $("#planBody").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("#planCards").addEventListener("scroll", e => {
      const el = e.currentTarget;
      const i = Math.round(el.scrollLeft / (el.scrollWidth / 3));
      $("#planDots").querySelectorAll("span").forEach((d, j) => d.classList.toggle("on", j === i));
    }, { passive: true });
    $("#brands").addEventListener("click", e => {
      const b = e.target.closest("[data-pick]"); if (!b) return;
      const m = b.dataset.pick, i = state.brandPicks.indexOf(m);
      i >= 0 ? state.brandPicks.splice(i, 1) : state.brandPicks.push(m);
      renderResultBody();
      if (i < 0) toast(`${m}を相談文に入れました`);
    });
    $("#consultText").addEventListener("input", () => { state.consultDirty = true; });
    $("#toThreads").addEventListener("click", () => copyText($("#consultText").value, "コピーしました。Threadsのメッセージに貼り付けてください"));
    $("#copyOnly").addEventListener("click", () => copyText($("#consultText").value, "相談文をコピーしました"));
    $("#restart").addEventListener("click", () => { stepIndex = 0; show("quiz"); renderQuestion(); });

    // 相談欄が見えているあいだは、下の固定ボタンを隠す
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(([en]) => $("#stickyCta").classList.toggle("hide", en.isIntersecting), { threshold: 0.15 })
        .observe($("#consult"));
    }
  }

  function renderResultBody() {
    const buying = state.land === "search";
    $("#oBudget").textContent = `${fmt(tune.budget)}万円`;
    $("#oFloor").textContent = `${tune.floorTsubo}坪（約${Math.round(tune.floorTsubo * 3.306)}㎡）`;
    if (buying) $("#oLand").textContent = `${tune.landTsubo}坪（約${Math.round(tune.landTsubo * 3.306)}㎡）`;
    $("#tunerNow").textContent = `予算 ${fmt(tune.budget)}万円${buying ? `・${WALK[state.walk].short}・土地${tune.landTsubo}坪` : ""}・延床${tune.floorTsubo}坪`;

    const plans = diagnose(tune);
    const plan = plans[state.plan] || plans[0];

    // サマリー
    const a = plans[0];
    const landPart = buying ? a.bd.items.find(i => i.k === "land").v : 0;
    const fitCount = plans.filter(p => p.bd.total <= p.target).length;
    $("#summary").innerHTML = `
      <div class="summary">
        <p class="eyebrow">YOUR RADAR</p>
        <h2>総予算 <em>${fmt(tune.budget)}</em>万円で、<br>${fitCount ? `予算内の案が${fitCount}つ見つかりました。` : "条件を少しゆるめると見えてきます。"}</h2>
        <dl class="summary-grid">
          <div><dt>${buying ? "希望エリアの相場" : "延床"}</dt><dd>${buying ? `${Math.round(a.tp)}万/坪` : `${tune.floorTsubo}坪`}</dd></div>
          <div><dt>${buying ? "土地の目安" : "間取り"}</dt><dd>${buying ? man(landPart) : `${state.rooms}LDK`}</dd></div>
          <div><dt>${buying ? "建物にまわせる額" : "駐車"}</dt><dd>${buying ? man(Math.max(0, tune.budget - landPart)) : `${state.parking}台`}</dd></div>
        </dl>
        <p class="summary-cond">${areaLabel()} ／ ${state.family}人・${state.rooms}LDK・駐車${state.parking}台${buying ? ` ／ ${WALK[state.walk].label}` : ""}${tune.budgetNote ? `<br>${tune.budgetNote}` : ""}</p>
      </div>`;

    $("#walkDelta").innerHTML = walkComparison(tune, plans[0]);

    $("#planCards").innerHTML = plans.map((p, i) => {
      const fits = p.bd.total <= p.target;
      const where = buying && p.stations[0] ? `<b>${p.stations[0].name}</b>周辺 ・ ` : "";
      return `<button class="plan-card" type="button" role="tab" data-plan="${i}" aria-selected="${i === state.plan}">
        <span class="pc-top"><small>PLAN ${"ABC"[i]}</small>${fits ? `<span class="badge ok">予算内</span>` : `<span class="badge over">${man(p.bd.total - p.target)}オーバー</span>`}</span>
        <span class="pc-name">${p.name}</span>
        <span class="pc-total" style="color:${fits ? "var(--ok)" : "var(--ember)"}">${man(p.bd.total)}</span>
        <span class="pc-meta">${where}<b>${p.top.rec ? "★" : ""}${p.top.maker}</b>・${ORDER[p.top.order].short}</span>
      </button>`;
    }).join("");
    $("#planDots").innerHTML = plans.map((_, i) => `<span class="${i === 0 ? "on" : ""}"></span>`).join("");

    $("#planBody").innerHTML = renderPlan(plan, buying);
    $("#brands").innerHTML = renderBrands(tune, plans);

    $("#disclose").textContent = "★は千葉レーダーのおすすめ会社です。条件が近い場合は優先して表示しています。相談は無料です。";

    if (!state.consultDirty) $("#consultText").value = consultText(plans, plan);
  }

  // いちばん推したい会社（rec:1）で建てるといくらか、どこなら建てられるか
  function renderBrands(t, plans) {
    const buying = state.land === "search";
    const brands = PRODUCTS.filter(p => p.rec === 1 && p.order === "full");
    if (!brands.length) return "";
    const { budget, landTsubo: L, floorTsubo: F } = t;
    const sel = buying ? selectedStations() : [];
    const selLines = new Set(sel.flatMap(s => s.lines));
    const tpRef = buying ? median(sel.map(s => s.tpAdj)) : 0;
    const cards = brands.map(p => {
      const total = breakdown(p, tpRef, L, F).total;
      const diff = total - budget;
      let where = "";
      if (buying) {
        const limit = maxTp(p, budget, L, F);
        const inArea = sel.filter(s => s.tpAdj <= limit).sort((a, b) => b.tpAdj - a.tpAdj);
        const near = allStations().filter(s => s.tpAdj <= limit && s.lines.some(l => selLines.has(l)) && !inArea.some(x => x.name === s.name))
          .sort((a, b) => b.tpAdj - a.tpAdj);
        if (inArea.length) where = `予算内で建てられる駅：<b>${inArea.slice(0, 3).map(s => s.name).join("・")}</b>${inArea.length > 3 ? ` ほか${inArea.length - 3}駅` : ""}`;
        else if (near.length) where = `同じ沿線なら予算内：<b>${near.slice(0, 3).map(s => s.name).join("・")}</b>`;
        else where = `予算内にするには、延床を${Math.max(22, F - 6)}坪くらいにするか、予算をあと約${man(Math.max(0, diff))}`;
      } else {
        where = diff <= 0 ? `<b>予算内で建てられます</b>（残り約${man(-diff)}）` : `予算内にするには、延床を${Math.max(22, F - 6)}坪くらいにするか、予算をあと約${man(diff)}`;
      }
      const picked = state.brandPicks.includes(p.maker);
      return `<div class="brand-card">
        <div class="bc-head"><strong>${p.maker}</strong><span>${p.tsubo[0]}〜${p.tsubo[1]}万/坪</span></div>
        <p class="bc-note">${p.note}</p>
        <div class="bc-row"><span>${buying ? "希望エリアで建てると" : "この条件で建てると"}</span><b style="color:${diff <= 0 ? "var(--ok)" : "var(--ember)"}">${man(total)}${diff > 0 ? `（+${man(diff)}）` : ""}</b></div>
        <p class="bc-st">${where}</p>
        <button class="pick" type="button" data-pick="${p.maker}" aria-pressed="${picked}">${picked ? "✓ 相談文に入れました" : "この会社も相談したい"}</button>
      </div>`;
    }).join("");
    return `<section class="brands">
      <p class="eyebrow">PREMIUM</p>
      <h3>憧れのハウスメーカーで建てるなら</h3>
      <p>千葉レーダーが特におすすめする3社。今の条件で建てた場合の総額と、予算内で建てられる場所です。</p>
      <div class="brand-list">${cards}</div>
    </section>`;
  }

  function renderPlan(p, buying) {
    const fits = p.bd.total <= p.target;
    const colors = { land: "#0f3d3e", demo: "#4d5f59", body: "#cf5a36", futai: "#e08a55", gaikou: "#b2863c", fee: "#8a9088", reserve: "#ddd2bd" };
    const stationsHtml = buying ? `
      <div class="block"><h4>AREA<span>候補の駅</span></h4>
        <div class="stations">${p.stations.map(s => `
          <div class="station"><div><strong>${s.name}</strong>
            ${s.prev && CONFIG.stationMeta.periodTo ? ` <span class="badge est">取引少・自動補正なし</span>` : s.n != null && s.n < CONFIG.fewDataCount ? ` <span class="badge est">データ少なめ</span>` : ""}
            <span class="st-sub">${s.city}・${s.lines.join("／")}</span>
            ${s.area != null ? `<span class="st-sub">エリア全体の実取引（バス圏含む）${Math.round(s.area)}万/坪・${s.an}件</span>` : ""}</div>
            <div class="num">${Math.round(s.tpAdj)}万/坪<small style="color:${s.total <= p.target ? "var(--ok)" : "var(--ember)"}">総額 ${man(s.total)}</small></div></div>`).join("")}
        </div>
        ${p.stationsAll ? `<p class="data-note">選んだエリア${p.stationsAll}駅のうち、この組み合わせで予算内は${p.stationsOk}駅。</p>` : ""}
      </div>` : "";
    const productsHtml = `
      <div class="block"><h4>HOUSE<span>住宅会社と建て方</span></h4>
        <div class="products">${p.products.map((x, i) => `
          <div class="product ${i === 0 ? "top" : ""} ${x.rec === 1 ? "rec1" : ""}">
            <div class="product-head"><strong>${x.rec ? `<span class="star">★</span>` : ""}${x.maker}</strong><span class="order">${x.product === ORDER[x.order].short ? x.product : `${x.product}・${ORDER[x.order].short}`}</span></div>
            <div class="price">本体 ${x.tsubo[0]}〜${x.tsubo[1]}万円/坪 ／ 総額目安 ${man(x.total)}</div>
            <div class="why">${(x.matched && x.matched.length ? x.matched.slice(0, 2).join("、") + "。" : "") + x.note}</div>
            <div class="badges">
              ${x.fits ? `<span class="badge ok">予算内</span>` : `<span class="badge over">${man(x.total - p.target)}オーバー</span>`}
              ${x.rec ? `<span class="badge rec">千葉レーダーおすすめ</span>` : ""}
              ${x.est ? `<span class="badge est">価格は推定・要確認</span>` : ""}
            </div>
          </div>`).join("")}
        </div></div>`;
    const bdHtml = `
      <div class="block"><details class="bd">
        <summary><h4>BREAKDOWN<span>概算の内訳</span></h4><span class="bd-total" style="color:${fits ? "var(--ok)" : "var(--ember)"}">${man(p.bd.total)} <span class="bd-open">▼</span></span></summary>
        <p class="data-note" style="margin-top:6px">${p.top.maker}${buying && p.stations[0] ? `・${p.stations[0].name}駅周辺` : ""}で計算</p>
        <table class="breakdown">${p.bd.items.map(i => `<tr><td><span style="color:${colors[i.k]}">■</span> ${i.label}<br><small>${i.note}</small></td><td>${man(i.v)}</td></tr>`).join("")}
          <tr class="total"><td>合計</td><td style="color:${fits ? "var(--ok)" : "var(--ember)"}">${man(p.bd.total)}</td></tr></table>
      </details>
        <div class="bar-viz">${p.bd.items.map(i => `<span style="width:${(i.v / p.bd.total) * 100}%;background:${colors[i.k]}" title="${i.label}"></span>`).join("")}</div>
        <p class="data-note" style="margin-top:4px">予算 ${fmt(p.target)}万円 → ${fits ? `残り約${man(p.target - p.bd.total)}` : `約${man(p.bd.total - p.target)}オーバー`}</p>
      </div>`;
    const reasons = [];
    if (p.top.matched && p.top.matched.length) reasons.push(...p.top.matched);
    if (buying && p.stations[0]) reasons.push(`${p.stations[0].name}駅周辺（${WALK[state.walk].short}想定）で土地 ${p.L}坪が約${man(p.stations[0].tpAdj * p.L)}`);
    reasons.push(`${ORDER[p.top.order].label}で${state.rooms}LDK・延床${p.F}坪`);

    return `
      <article class="plan">
        <div class="plan-head"><div><h3>${p.name}</h3><p class="plan-lead">${p.lead}</p></div>
          ${fits ? `<span class="badge ok">予算内</span>` : `<span class="badge over">予算オーバー</span>`}</div>
        ${stationsHtml}
        ${productsHtml}
        ${bdHtml}
        <div class="block"><h4>WHY<span>合う理由</span></h4><ul class="dots">${reasons.map(r => `<li>${r}</li>`).join("")}</ul></div>
        <div class="block"><h4>TRADE-OFF<span>ゆずる必要がある条件</span></h4><ul class="dots give">${(p.give.length ? p.give : ["大きくゆずる条件はありません。"]).map(r => `<li>${r}</li>`).join("")}</ul></div>
        <div class="block"><h4>NEXT<span>次に確認すること</span></h4><ul class="dots check">${p.checks.map(r => `<li>${r}</li>`).join("")}</ul></div>
        <p class="data-note">${buying ? `駅別坪単価：${CONFIG.stationMeta.source}（最終更新 ${CONFIG.stationMeta.updated}）。${CONFIG.stationMeta.areaSource ? `「エリア全体の実取引」は${CONFIG.stationMeta.areaSource}（${CONFIG.stationMeta.periodFrom}〜${CONFIG.stationMeta.periodTo}）。駅から遠い住宅地も含むため、駅近の相場とは差が出ます。` : ""}駅距離の補正（徒歩10分 ×1.15・バス可 ×0.8）は目安です。` : ""}住宅会社の坪単価は千葉レーダー調べの目安（${window.PRODUCT_DATA_UPDATED}時点）。付帯工事は本体の${CONFIG.futaiRate * 100}%、予備費は${CONFIG.reserveRate * 100}%で計算しています。</p>
      </article>`;
  }

  function consultText(plans, current) {
    const buying = state.land === "search";
    const landLabel = { search: "これから探す", own: "土地あり", rebuild: "建て替え" }[state.land];
    const prios = state.priorities.map(id => PRIORITIES.find(p => p.id === id).label).join("・");
    const freedom = { full: "自由に決めたい", semi: "選択式でもよい", price: "価格優先", unknown: "まだ分からない" }[state.freedom];
    const lines = [];
    lines.push("千葉レーダーの家づくり診断を見て相談です。");
    lines.push("");
    lines.push(`総予算：${fmt(tune.budget)}万円${state.budget === "unknown" ? "（年収から算出）" : ""}／土地：${landLabel}`);
    lines.push(`${buying ? "希望エリア" : "建築地"}：${areaLabel()}`);
    lines.push(`通勤：${COMMUTE[state.commute].label}${buying ? `／駅距離：${WALK[state.walk].label}` : ""}`);
    lines.push(`家族：${state.family}人／希望：${state.rooms}LDK・駐車場${state.parking}台`);
    lines.push(`重視すること：${prios}`);
    lines.push(`間取りの自由度：${freedom}`);
    lines.push("");
    lines.push(`気になった案：${current.name}`);
    if (buying && current.stations.length) lines.push(`・エリア：${current.stations.slice(0, 3).map(s => s.name).join("、")}`);
    lines.push(`・住宅会社：${current.products.slice(0, 3).map(p => `${p.maker}（${ORDER[p.order].short}）`).join("、")}`);
    lines.push(`・総額の目安：${man(current.bd.total)}`);
    const others = plans.filter(p => p !== current).map(p => `${p.name}（${p.top.maker}${buying && p.stations[0] ? `・${p.stations[0].name}` : ""}）`);
    if (others.length) lines.push(`ほかの案：${others.join("／")}`);
    if (state.brandPicks.length) lines.push(`気になる会社：${state.brandPicks.join("、")}`);
    lines.push("");
    lines.push("この条件で進められるか、相談したいです。");
    return lines.join("\n");
  }

  // ───────── その他 ─────────
  function copyText(text, msg) {
    const done = () => toast(msg);
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, () => { fallbackCopy(text); done(); });
    } else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (_) { /* 失敗しても相談文は画面に残っている */ }
    ta.remove();
  }
  function toast(msg) {
    const t = document.createElement("div");
    t.className = "toast"; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }
})();
