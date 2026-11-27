"use strict";
const sheetId = "1gK6KWo-Zuco0aDnW-bP4BTPo3u76Ku_TSNSd9fINEAU";
const tabRanges = { 전체: "A:K", 전략은행: "A:F", 통합교과단원: "A:I" };
let sheetToken = "",
  sheetEpoch = 0,
  syncing = false,
  catalog = {},
  retrieved = "";
function keyFor(kind, r) {
  const cols =
    kind === "전체"
      ? ["학년군", "교과", "과목", "성취기준 코드"]
      : kind === "전략은행"
        ? ["단계", "하위유형", "전략명"]
        : ["교과서단원", "학년", "학기", "성취기준코드"];
  return JSON.stringify([kind, ...cols.map((k) => r[k] || "")]);
}
function parseTabs(ranges) {
  const result = {};
  Object.keys(tabRanges).forEach((kind, i) => {
    const [headers, ...rows] = ranges[i]?.values || [];
    const needed = {
      전체: ["학년군", "교과", "성취기준 코드", "성취기준"],
      전략은행: ["전략명"],
      통합교과단원: ["교과서단원"],
    }[kind];
    if (!headers || !needed.every((x) => headers.includes(x)))
      throw Error(kind + " 탭의 열 구성을 확인해 주세요.");
    const map = new Map();
    rows.forEach((row, index) => {
      const record = Object.fromEntries(
        headers.map((key, j) => [key, row[j] || ""]),
      );
      if (!record[needed.at(-1)]) return;
      const key = keyFor(kind, record),
        prev = map.get(key);
      if (prev) {
        if (JSON.stringify(prev.record) !== JSON.stringify(record))
          prev.conflict = true;
        return;
      }
      map.set(key, { key, kind, record, row: index + 2 });
    });
    result[kind] = map;
  });
  return result;
}
async function syncCatalog() {
  if (!sheetToken || syncing) return;
  const epoch = sheetEpoch;
  syncing = true;
  try {
    const params = new URLSearchParams();
    for (const [tab, range] of Object.entries(tabRanges))
      params.append("ranges", "'" + tab + "'!" + range);
    const r = await fetch(
      "https://sheets.googleapis.com/v4/spreadsheets/" +
        sheetId +
        "/values:batchGet?" +
        params,
      { headers: { Authorization: "Bearer " + sheetToken }, cache: "no-store" },
    );
    if (epoch !== sheetEpoch) return;
    if (r.status === 401) {
      sheetToken = "";
      throw Error("조회 인증 만료 · 원본 연결을 다시 눌러 주세요.");
    }
    if (!r.ok)
      throw Error(
        "Sheets " +
          r.status +
          " · 시트 열람 권한 및 Sheets API 활성화를 확인하세요.",
      );
    const data = parseTabs((await r.json()).valueRanges);
    if (epoch !== sheetEpoch) return;
    catalog = data;
    retrieved = new Date().toISOString();
    $("syncState").textContent =
      "기준 " +
      data["전체"].size.toLocaleString() +
      "건 · " +
      new Date().toLocaleString("ko-KR") +
      " 조회";
    renderCatalog();
  } catch (e) {
    if (epoch === sheetEpoch)
      $("syncState").textContent =
        e.message + (retrieved ? " · 이전 조회 결과 표시" : "");
  } finally {
    if (epoch === sheetEpoch) syncing = false;
  }
}
$("syncSheet").onclick = () => {
  if (sheetToken) return syncCatalog();
  const epoch = sheetEpoch;
  google.accounts.oauth2
    .initTokenClient({
      client_id: CLIENT,
      scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
      include_granted_scopes: false,
      callback: (r) => {
        if (epoch !== sheetEpoch) return;
        if (!r.access_token) {
          $("syncState").textContent = "교육과정 읽기 권한이 필요합니다.";
          return;
        }
        sheetToken = r.access_token;
        syncCatalog();
      },
    })
    .requestAccessToken();
};
function renderMatches() {
  const host = $("matchedStandards");
  host.replaceChildren();
  if (!catalog["전체"]) return;
  const text = [
    $("plan").value,
    $("standards").value,
    ...lessons.map((l) => l.title + " " + l.detail),
  ].join("\n");
  const codes = new Set(text.match(/\[[^\]\s]{1,22}\d{2}-\d{2}\]/g) || []);
  if (!codes.size) return;
  const byCode = new Map();
  for (const entry of catalog["전체"].values()) {
    const code = entry.record["성취기준 코드"];
    if (!codes.has(code)) continue;
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push(entry);
  }
  const matches = [],
    unresolved = [];
  for (const code of codes) {
    const rows = byCode.get(code) || [];
    if (rows.length !== 1 || rows[0].conflict) {
      unresolved.push(code);
      continue;
    }
    if (!sources.some((s) => s.key === rows[0].key)) matches.push(rows[0]);
  }
  if (matches.length) {
    host.append(
      node(
        "p",
        "설계서와 원본에서 일치하는 기준 · " +
          matches.map((e) => e.record["성취기준 코드"]).join(", "),
      ),
    );
    const add = node("button", matches.length + "개 기준 함께 연결");
    add.onclick = () => {
      sources.push(...matches.map((entry) => ({ ...entry, date: retrieved })));
      markChanged();
      renderCatalog();
    };
    host.append(add);
  }
  if (unresolved.length)
    host.append(
      node(
        "p",
        "원본을 한 건으로 특정할 수 없는 코드 · " + unresolved.join(", "),
        "studio-note",
      ),
    );
}
function renderCatalog() {
  renderMatches();
  const kind = $("sheetKind").value,
    terms = $("query").value.toLowerCase().trim().split(/\s+/);
  const all = Array.from(catalog[kind]?.values() || []).filter((x) =>
    terms.every((t) =>
      Object.values(x.record).join(" ").toLowerCase().includes(t),
    ),
  );
  const hits = $("hits");
  hits.replaceChildren();
  if (catalog[kind])
    hits.append(
      node("small", "검색 결과 " + all.length + "건 · 최대 30건 표시"),
    );
  for (const entry of all.slice(0, 30)) {
    const r = entry.record,
      card = node("article", null, "hit"),
      add = node("button", "연결");
    add.className = "secondary";
    card.append(
      node("strong", r["성취기준"] || r["전략명"] || r["교과서단원"]),
      node(
        "small",
        [r["학년군"], r["교과"], r["과목"], r["한 줄 설명"], r["핵심아이디어"]]
          .filter(Boolean)
          .join(" · "),
      ),
    );
    const linked = sources.some((s) => s.key === entry.key);
    add.disabled = linked || entry.conflict;
    add.textContent = entry.conflict
      ? "중복 원문 확인 필요"
      : linked
        ? "연결됨"
        : "프로젝트에 연결";
    add.onclick = () => {
      sources.push({ ...entry, date: retrieved });
      markChanged();
      renderCatalog();
    };
    card.append(add);
    hits.append(card);
  }
  const list = $("sources");
  list.replaceChildren();
  sources.forEach((s, i) => {
    const current = catalog[s.kind]?.get(s.key);
    const change =
      catalog[s.kind] &&
      (!current
        ? "원본에서 삭제됨"
        : current.conflict
          ? "중복 원문 확인 필요"
          : JSON.stringify(s.record) !== JSON.stringify(current.record)
            ? "원문 변경됨"
            : "");
    const box = node("details");
    box.append(
      node(
        "summary",
        (change ? change + " · " : "") +
          (s.record["성취기준 코드"] ||
            s.record["전략명"] ||
            s.record["교과서단원"]) +
          " · 연결 자료",
      ),
    );
    box.append(
      node(
        "p",
        Object.entries(s.record)
          .filter(([, v]) => v)
          .map(([k, v]) => k + "　" + v)
          .join("\n"),
      ),
      node("small", s.kind + " 탭 " + s.row + "행 · " + s.date),
    );
    if (change === "원문 변경됨") {
      const update = node("button", "최신 원문 적용");
      update.onclick = () => {
        sources[i] = { ...current, date: retrieved };
        markChanged();
        renderCatalog();
      };
      box.append(update);
    }
    const remove = node("button", "연결 해제", "secondary");
    remove.onclick = () => {
      sources.splice(i, 1);
      markChanged();
      renderCatalog();
    };
    box.append(remove);
    list.append(box);
  });
}
$("sheetKind").onchange = renderCatalog;
$("query").oninput = renderCatalog;
setInterval(() => {
  if (!document.hidden && token && sheetToken) syncCatalog();
}, 300000);
window.addEventListener("focus", () => {
  if (sheetToken && Date.now() - Date.parse(retrieved) > 60000) syncCatalog();
});
