#!/usr/bin/env python3
"""駅別の土地相場を、国交省「不動産情報ライブラリ」から更新する。

使い方:
  # 毎月の更新（APIキーは環境変数で渡す）
  REINFOLIB_API_KEY=xxxx python3 scripts/update_prices.py

  # 駅を追加したとき：国土数値情報の駅データ(N02_Station.geojson)から駅コード表を作り直す
  python3 scripts/update_prices.py --build-codes path/to/N02-24_Station.geojson

仕組み（変化率で更新する方式）:
  - 駅近の相場 tp は、千葉レーダーの集計値をベースとして残す
  - XIT001（取引価格・成約価格）を駅コード指定で取得し、駅を最寄りとする住宅地の土地の
    直近8四半期の坪単価の中央値 area を出す（バス圏も含むエリア全体の実取引）
  - 前回の area から今回の area への変化率だけを tp に掛ける（1回あたり ±5% まで）
  - 初回は area を記録するだけで、tp は変えない
  - 件数が少ない駅は tp を変えず、src="prev" として「今回は補正できていない」ことを残す
  - 取得の失敗が多いときは何も書き換えずに終了する（古いデータを最新のように見せない）
"""
import argparse
import datetime as dt
import gzip
import json
import os
import re
import statistics
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIONS_JS = os.path.join(ROOT, "data", "stations.js")
CODES_JSON = os.path.join(ROOT, "data", "station_codes.json")

API_URL = "https://www.reinfolib.mlit.go.jp/ex-api/external/XIT001"
QUARTERS = 8            # 直近何四半期分で中央値をとるか
MIN_COUNT = 5           # これ未満の件数なら area を出さない
MIN_COUNT_FOR_CHANGE = 10  # 変化率を tp に反映するのに必要な件数（少ないと中央値がぶれる）
MAX_STEP = 0.05         # 1回の更新で tp を動かす上限（±5%）
AREA_RANGE = (80, 500)  # 住宅用地として見る面積（㎡）。農地や大規模用地を除く
MAX_FAIL_RATE = 0.3     # 取得失敗がこの割合を超えたら書き換えない
SLEEP_SEC = 0.4
# 相場とかけ離れやすい取引は除く
EXCLUDE_REMARKS = ["関係者間", "隣地", "私道", "調停", "競売", "他の権利", "瑕疵"]
# 原則として家を建てられない区域は除く
EXCLUDE_PLANNING = {"市街化調整区域"}
TSUBO_SQM = 3.305785


# ───────── stations.js の読み書き ─────────
FIELDS = ("s", "l", "tp", "n", "area", "an", "src")


def load_stations_js(path):
    text = open(path, encoding="utf-8").read()
    rows = []
    body = text.split("window.STATION_PRICE_DATA")[1].split("window.STATION_CITY_MAP")[0]
    for obj in re.findall(r"\{([^}]*)\}", body):
        row = {}
        for k, v in re.findall(r'(\w+):("[^"]*"|[\d.]+)', obj):
            row[k] = v.strip('"') if v.startswith('"') else (int(v) if k in ("n", "an") else float(v))
        rows.append(row)
    city_part = text.split("window.STATION_CITY_MAP")[1]
    city_map = dict(re.findall(r'"([^"]+)":"([^"]+)"', city_part))
    return rows, city_map


def write_stations_js(path, rows, city_map, meta):
    out = ["// このファイルは scripts/update_prices.py が毎月自動で書き換えます。tp（駅近の相場）を手で直すと、次からはその値に変化率が掛かります。",
           "window.STATION_DATA_META = " + json.dumps(meta, ensure_ascii=False) + ";",
           "window.STATION_PRICE_DATA = ["]
    line = None
    for r in rows:
        if r["l"] != line:
            line = r["l"]
            out.append(f"// {line}")
        parts = []
        for k in FIELDS:
            v = r.get(k)
            if v is None:
                continue
            parts.append(f'{k}:"{v}"' if isinstance(v, str) else f"{k}:{v}")
        out.append("{" + ",".join(parts) + "},")
    out[-1] = out[-1].rstrip(",")
    out.append("];")
    out.append("window.STATION_CITY_MAP = {")
    items = [f'"{k}":"{v}"' for k, v in city_map.items()]
    for i in range(0, len(items), 6):
        out.append(",".join(items[i:i + 6]) + ("," if i + 6 < len(items) else ""))
    out.append("};")
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")
    os.replace(tmp, path)


# ───────── 駅コード表 ─────────
def build_codes(geojson_path, rows):
    """国土数値情報の駅データから、千葉周辺の駅名→グループコード表を作る。"""
    data = json.load(open(geojson_path, encoding="utf-8"))
    found = {}
    for f in data["features"]:
        p = f["properties"]
        coords = f["geometry"]["coordinates"]
        while isinstance(coords[0][0], list):
            coords = coords[0]
        lon = sum(c[0] for c in coords) / len(coords)
        lat = sum(c[1] for c in coords) / len(coords)
        if not (139.6 < lon < 141.0 and 34.8 < lat < 36.2):  # 千葉県とその周辺だけ
            continue
        found.setdefault(p["N02_005"], set()).add(p["N02_005g"])
    codes, problems = {}, []
    for name in sorted({r["s"] for r in rows}):
        g = found.get(name, set())
        if len(g) == 1:
            codes[name] = g.pop()
        else:
            problems.append(f"{name}: {sorted(g) or '見つからない'}")
    return codes, problems


# ───────── API ─────────
def api_get(params, key, retries=3):
    url = API_URL + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Ocp-Apim-Subscription-Key": key, "Accept-Encoding": "gzip"})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                raw = res.read()
                if res.headers.get("Content-Encoding") == "gzip" or raw[:2] == b"\x1f\x8b":
                    raw = gzip.decompress(raw)
                return json.loads(raw.decode("utf-8")).get("data", [])
        except urllib.error.HTTPError as e:
            if e.code == 404:          # その期間のデータがない
                return []
            if e.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                time.sleep(2 ** attempt * 2)
                continue
            raise
        except urllib.error.URLError:
            if attempt < retries - 1:
                time.sleep(2 ** attempt * 2)
                continue
            raise
    return []


def fetch_station(code, years, key):
    records = []
    for y in years:
        records += api_get({"year": y, "station": code}, key)
        time.sleep(SLEEP_SEC)
    return records


# ───────── 集計 ─────────
def period_key(period):
    """'2025年第2四半期' → (2025, 2)"""
    m = re.search(r"(\d{4})年第(\d)四半期", period or "")
    return (int(m.group(1)), int(m.group(2))) if m else None


def to_num(v):
    try:
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None   # 「2000㎡以上」などは数値にしない


def land_tsubo_prices(records, keep_periods):
    prices = []
    for r in records:
        if r.get("Type") != "宅地(土地)" or r.get("Region") != "住宅地":
            continue
        if r.get("CityPlanning") in EXCLUDE_PLANNING:
            continue
        if period_key(r.get("Period")) not in keep_periods:
            continue
        if any(w in (r.get("Remarks") or "") for w in EXCLUDE_REMARKS):
            continue
        area, price = to_num(r.get("Area")), to_num(r.get("TradePrice"))
        if not area or not price or not (AREA_RANGE[0] <= area <= AREA_RANGE[1]):
            continue
        prices.append(price / 10000 / (area / TSUBO_SQM))
    return prices


def summarize(prices):
    return {"area": round(statistics.median(prices), 1), "an": len(prices)}


def recent_periods(all_records, count):
    ps = sorted({period_key(r.get("Period")) for r in all_records} - {None}, reverse=True)
    return set(ps[:count])


# ───────── メイン ─────────
def update(key, fetch=fetch_station, today=None):
    today = today or dt.date.today()
    rows, city_map = load_stations_js(STATIONS_JS)
    codes = json.load(open(CODES_JSON, encoding="utf-8"))
    years = [today.year - 2, today.year - 1, today.year]

    fetched, failed = {}, []
    for name in sorted({r["s"] for r in rows}):
        code = codes.get(name)
        if not code:
            failed.append(f"{name}（駅コードなし）")
            continue
        try:
            fetched[name] = fetch(code, years, key)
        except Exception as e:  # noqa: BLE001 ここでは失敗した駅を数えて最後に判断する
            failed.append(f"{name}（{e}）")
    total = len({r["s"] for r in rows})
    if len(failed) / total > MAX_FAIL_RATE:
        print(f"取得失敗が多すぎるため、更新を中止しました（{len(failed)}/{total}駅）", file=sys.stderr)
        for f in failed[:20]:
            print("  -", f, file=sys.stderr)
        return 1

    periods = recent_periods([r for rs in fetched.values() for r in rs], QUARTERS)
    summary = {}
    for name, recs in fetched.items():
        prices = land_tsubo_prices(recs, periods)
        if len(prices) >= MIN_COUNT:
            summary[name] = summarize(prices)

    adjusted, first, kept, clipped = set(), set(), set(), []
    for r in rows:
        new = summary.get(r["s"])
        if not new:
            r["src"] = "prev"
            kept.add(r["s"])
            continue
        old_area, old_an = r.get("area"), r.get("an") or 0
        if old_area and min(old_an, new["an"]) >= MIN_COUNT_FOR_CHANGE:
            ratio = new["area"] / old_area
            step = max(1 - MAX_STEP, min(1 + MAX_STEP, ratio))
            if step != ratio:
                clipped.append(f'{r["s"]}（{r["l"]}）: エリア {old_area}→{new["area"]}万/坪（{ratio - 1:+.0%}）を{step - 1:+.0%}に抑えた')
            r["tp"] = round(r["tp"] * step, 1)
            r["src"] = "mlit"
            adjusted.add(r["s"])
        elif old_area:
            r["src"] = "prev"   # 件数が少なく、変化率が当てにならない
            kept.add(r["s"])
        else:
            r["src"] = "base"   # 初回：基準を記録するだけ
            first.add(r["s"])
        r.update(new)

    ps = sorted(periods)
    meta = {
        "updated": today.isoformat(),
        "source": "千葉レーダー集計をベースに、国土交通省 不動産情報ライブラリの取引価格の変化率で毎月補正",
        "areaSource": "国土交通省 不動産情報ライブラリ（取引価格・成約価格）を千葉レーダーが加工",
        "periodFrom": f"{ps[0][0]}年第{ps[0][1]}四半期" if ps else None,
        "periodTo": f"{ps[-1][0]}年第{ps[-1][1]}四半期" if ps else None,
        "areaMethod": f"駅を最寄りとする住宅地の土地（{AREA_RANGE[0]}〜{AREA_RANGE[1]}㎡・市街化調整区域を除く）の取引の坪単価の中央値。バス圏を含む",
        "adjustedStations": len(adjusted),
        "baselineStations": len(first),
        "keptStations": len(kept),
    }
    write_stations_js(STATIONS_JS, rows, city_map, meta)

    print(f"補正: {len(adjusted)}駅 ／ 基準を記録（初回）: {len(first)}駅 ／ 補正なし: {len(kept)}駅 ／ 期間: {meta['periodFrom']}〜{meta['periodTo']}")
    if failed:
        print("取得できなかった駅:", "、".join(failed))
    if clipped:
        print("変化が大きく、上限で抑えた駅（念のため確認）:")
        for c in clipped:
            print("  -", c)
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--build-codes", metavar="GEOJSON", help="国土数値情報の駅データから駅コード表を作り直す")
    args = ap.parse_args()

    if args.build_codes:
        rows, _ = load_stations_js(STATIONS_JS)
        codes, problems = build_codes(args.build_codes, rows)
        with open(CODES_JSON, "w", encoding="utf-8") as f:
            json.dump(codes, f, ensure_ascii=False, indent=1, sort_keys=True)
        print(f"{len(codes)}駅のコードを書き出しました: {CODES_JSON}")
        for p in problems:
            print("  要確認:", p)
        return 0

    key = os.environ.get("REINFOLIB_API_KEY")
    if not key:
        print("環境変数 REINFOLIB_API_KEY にAPIキーを入れてください", file=sys.stderr)
        return 2
    return update(key)


if __name__ == "__main__":
    sys.exit(main())
