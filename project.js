"use strict";
const CLIENT =
    "874381452451-gips8mhgik48giv89taqunqhtv1q3qi6.apps.googleusercontent.com",
  SCOPE = "https://www.googleapis.com/auth/drive.file",
  $ = (id) => document.getElementById(id);
let token = "",
  root = "",
  fileId = "",
  revision = "",
  busy = false,
  dirty = false,
  timer = null;
const fields = [
  "title",
  "grade",
  "subject",
  "plan",
  "method",
  "minutes",
  "standards",
];
let lessons = [],
  activeLesson = -1;
function status(s) {
  $("status").textContent = s;
  $("loginStatus").textContent = s;
}
function controls() {
  $("workspace").inert = busy;
  const ready = !!token && !!root;
  $("landing").hidden = ready;
  $("workspace").hidden = !ready;
  $("logout").hidden = !ready;
  for (const id of ["save", "reload", "logout", "fresh"])
    $(id).disabled = !ready || busy;
  $("heroLogin").disabled = busy;
  for (const id of [
    ...fields,
    "newTop",
    "saveTop",
    "importBtn",
    "addLesson",
    "lessonText",
  ])
    $(id).disabled = busy || !ready;
  for (const e of $("lessonList").querySelectorAll("input,button"))
    e.disabled = busy;
  for (const b of $("projects").querySelectorAll("button")) b.disabled = busy;
}
let sources = [],
  projectExtras = {};
function snapshot() {
  return {
    ...projectExtras,
    sources,
    ...Object.fromEntries(fields.map((k) => [k, $(k).value])),
    lessons: lessons.map((x) => ({ ...x })),
  };
}
function clearEditor() {
  resetStudio();
  projectExtras = {};
  sources = [];
  fields.forEach((k) => ($(k).value = ""));
  lessons = [];
  activeLesson = -1;
  renderLessons();
  updateHeading();
  showPanel("overview");
  fileId = "";
  revision = "";
  dirty = false;
}
function disconnect() {
  window.releaseSession?.();
  token = "";
  root = "";
  fileId = "";
  revision = "";
  clearEditor();
  $("projects").replaceChildren();
  $("folder").hidden = true;
  clearTimeout(timer);
  controls();
}
async function api(path, options = {}) {
  const r = await fetch("https://www.googleapis.com" + path, {
    ...options,
    headers: { ...options.headers, Authorization: "Bearer " + token },
  });
  if (r.status === 401) {
    throw Error(
      "인증이 만료되었습니다. JSON으로 변경 내용을 내려받은 뒤 연결을 해제하고 다시 로그인하세요.",
    );
  }
  if (!r.ok)
    throw Error(
      r.status === 412
        ? "동시 저장 충돌입니다. JSON으로 보관한 뒤 다시 불러오세요."
        : "Google Drive 오류 " + r.status,
    );
  return r.status === 204 ? null : r.json();
}
async function list(q) {
  let files = [],
    pageToken;
  do {
    const p = new URLSearchParams({
      q,
      fields: "nextPageToken,files(id,name,modifiedTime,version)",
      pageSize: "100",
    });
    if (pageToken) p.set("pageToken", pageToken);
    const r = await api("/drive/v3/files?" + p);
    files.push(...r.files);
    pageToken = r.nextPageToken;
  } while (pageToken);
  return files;
}
async function connect() {
  if (!window.google?.accounts?.oauth2) {
    status("인증 모듈 로딩 중입니다. 잠시 후 다시 눌러 주세요.");
    return;
  }
  google.accounts.oauth2
    .initTokenClient({
      client_id: CLIENT,
      scope: SCOPE,
      callback: async (r) => {
        if (r.error) {
          status("인증 오류: " + r.error);
          return;
        }
        token = r.access_token;
        busy = true;
        controls();
        try {
          const folders = await list(
            "trashed = false and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='lessonStudioRoot' and value='1' }",
          );
          root = folders[0]?.id;
          if (!root) {
            const f = await api("/drive/v3/files", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: "Lesson Studio",
                mimeType: "application/vnd.google-apps.folder",
                appProperties: { lessonStudioRoot: "1" },
              }),
            });
            root = f.id;
          }
          $("folder").href = "https://drive.google.com/drive/folders/" + root;
          $("folder").hidden = false;
          await refresh();
          status("Google Drive 연결 완료. 개인 프로젝트를 저장할 수 있습니다.");
        } catch (e) {
          status(e.message);
        } finally {
          busy = false;
          controls();
        }
      },
    })
    .requestAccessToken({ prompt: "select_account" });
}
async function refresh() {
  const files = await list(
    "'" +
      root +
      "' in parents and trashed = false and appProperties has { key='lessonStudioProject' and value='1' }",
  );
  $("projects").replaceChildren();
  for (const f of files) {
    const b = document.createElement("button");
    b.className = "secondary";
    b.textContent = f.name.replace(/\.json$/i, "") + " · " + f.modifiedTime.slice(0, 10);
    b.onclick = () => load(f);
    $("projects").append(b);
  }
  updateHeading();
}
async function load(f) {
  if (busy) return;
  if (dirty && !confirm("저장하지 않은 변경사항을 버릴까요?")) return;
  clearTimeout(timer);
  busy = true;
  controls();
  try {
    const meta = await api("/drive/v3/files/" + f.id + "?fields=version");
    const data = await api("/drive/v3/files/" + f.id + "?alt=media");
    restoreExtra(data);
    fields.forEach((k) => ($(k).value = String(data[k] ?? "")));
    lessons = normalizeLessons(data.lessons);
    activeLesson = -1;
    renderLessons();
    updateHeading();
    showPanel("overview");
    fileId = f.id;
    revision = meta.version;
    dirty = false;
    $("projectSwitch").open = false;
    status("프로젝트 불러오기 완료");
  } catch (e) {
    status(e.message);
  } finally {
    busy = false;
    controls();
  }
}
async function persistProject() {
  if (!token || !root || !$("title").value.trim())
    throw Error("프로젝트 이름과 Drive 연결을 확인하세요.");
  let matchTag = "";
  const saved = JSON.stringify(snapshot());
  const data = {
    ...JSON.parse(saved),
    schemaVersion: 2,
    updatedAt: new Date().toISOString(),
  };
  if (fileId) {
    const check = await fetch(
      "https://www.googleapis.com/drive/v3/files/" +
        encodeURIComponent(fileId) +
        "?fields=version",
      { headers: { Authorization: "Bearer " + token }, cache: "no-store" },
    );
    if (!check.ok) throw Error("Drive 버전 조회 실패 " + check.status);
    matchTag = check.headers.get("ETag");
    const meta = await check.json();
    if (meta.version !== revision)
      throw Error(
        "다른 기기에서 수정된 프로젝트입니다. 변경 내용을 JSON으로 다운로드한 뒤 다시 불러오세요.",
      );
  }
  const boundary = "lessonstudio" + crypto.randomUUID(),
    meta = {
      name: data.title + ".json",
      mimeType: "application/json",
      appProperties: { lessonStudioProject: "1" },
      ...(!fileId ? { parents: [root] } : {}),
    };
  const body =
    "--" +
    boundary +
    "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(meta) +
    "\r\n--" +
    boundary +
    "\r\nContent-Type: application/json\r\n\r\n" +
    JSON.stringify(data) +
    "\r\n--" +
    boundary +
    "--";
  const f = await api(
    "/upload/drive/v3/files" +
      (fileId ? "/" + fileId : "") +
      "?uploadType=multipart&fields=id,version",
    {
      method: fileId ? "PATCH" : "POST",
      headers: {
        "Content-Type": "multipart/related; boundary=" + boundary,
        ...(matchTag ? { "If-Match": matchTag } : {}),
      },
      body,
    },
  );
  fileId = f.id;
  revision = f.version;
  dirty = JSON.stringify(snapshot()) !== saved;
  try {
    await refresh();
  } catch {
    status("프로젝트 저장 완료 · 목록 갱신은 다음 연결에서 재시도합니다.");
    return;
  }
  status("Drive 저장 완료 · " + new Date().toLocaleTimeString("ko-KR"));
}
async function save() {
  if (busy || !token || !root) return;
  if (!$("title").value.trim()) {
    status("프로젝트 이름을 입력하세요.");
    return;
  }
  clearTimeout(timer);
  busy = true;
  controls();
  try {
    await persistProject();
  } catch (e) {
    status(e.message);
  } finally {
    busy = false;
    controls();
  }
}
$("heroLogin").onclick = () => {
  if (
    dirty &&
    !confirm("저장하지 않은 변경사항이 있습니다. 계정을 전환할까요?")
  )
    return;
  disconnect();
  connect();
};
$("logout").onclick = () => {
  if (dirty && !confirm("저장하지 않은 변경사항을 버릴까요?")) return;
  const t = token;
  disconnect();
  google.accounts.oauth2.revoke(t, () => {});
  status("Google Drive 연결 해제");
};
$("reload").onclick = async () => {
  try {
    await refresh();
    status("목록 갱신 완료");
  } catch (e) {
    status(e.message);
  }
};
$("save").onclick = save;
$("fresh").onclick = () => {
  if (dirty && !confirm("저장하지 않은 변경사항을 버릴까요?")) return;
  clearTimeout(timer);
  clearEditor();
  status("새 프로젝트");
};
$("download").onclick = () => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(snapshot(), null, 2)], {
      type: "application/json",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = ($("title").value || "lesson") + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
function updateHeading() {
  $("nextStep").textContent = !$("title").value.trim()
    ? ($("projects").childElementCount ? "저장한 프로젝트 열기" : "프로젝트 이름 입력")
    : (lessons.length ? "차시 자료 제작" : "＋ 첫 차시 만들기");
  $("studioTitle").textContent = $("title").value.trim() || "새 수업 프로젝트";
  $("studioMeta").textContent =
    [
      $("grade").value,
      $("subject").value,
      lessons.length ? lessons.length + "차시" : "",
    ]
      .filter(Boolean)
      .join(" · ") || "단원 설계에서 차시별 실행 자료까지";
}
function showPanel(name) {
  if (window.refreshStudio) refreshStudio(name);
  for (const b of document.querySelectorAll("[data-panel]")) {
    const selected = b.dataset.panel === name;
    b.setAttribute("aria-selected", String(selected));
    $("panel-" + b.dataset.panel).hidden = !selected;
  }
}
function markChanged() {
  dirty = true;
  updateHeading();
  clearTimeout(timer);
  if (fileId && token) timer = setTimeout(save, 2000);
}
function normalizeLessons(a) {
  return Array.isArray(a)
    ? a
        .filter((x) => x && typeof x === "object")
        .map((x) => ({
          ...x,
          title: String(x.title ?? ""),
          detail: String(x.detail ?? ""),
        }))
    : [];
}
function renderLessons() {
  const list = $("lessonList");
  list.replaceChildren();
  if (!lessons.length) {
    const e = document.createElement("div");
    e.className = "studio-empty";
    e.textContent = "차시를 추가하여 단원 흐름을 구성하세요.";
    list.append(e);
  }
  lessons.forEach((x, i) => {
    const row = document.createElement("div");
    row.className = "studio-lesson";
    const n = document.createElement("strong");
    n.textContent = i + 1 + "차시";
    const input = document.createElement("input");
    input.value = x.title;
    input.placeholder = "차시 제목";
    input.setAttribute("aria-label", i + 1 + "차시 제목");
    input.oninput = () => {
      x.title = input.value;
      markChanged();
    };
    const b = document.createElement("button");
    b.className = "secondary";
    b.textContent = "상세";
    b.onclick = () => {
      activeLesson = i;
      renderLessons();
    };
    row.append(n, input, b);
    list.append(row);
  });
  $("lessonDetail").hidden = activeLesson < 0 || !lessons[activeLesson];
  if (!$("lessonDetail").hidden) {
    $("lessonLabel").textContent = activeLesson + 1 + "차시 상세 설계";
    $("lessonText").value = lessons[activeLesson].detail;
  }
}
document
  .querySelectorAll("[data-panel]")
  .forEach((b) => (b.onclick = () => showPanel(b.dataset.panel)));
$("newTop").onclick = () => {
  $("fresh").click();
  if (!dirty) {
    $("projectSwitch").open = false;
    $("title").focus();
  }
};
$("nextStep").onclick = () => {
  if (!$("title").value.trim()) {
    if ($("projects").childElementCount) {
      $("projectSwitch").open = true;
      $("projects").firstElementChild.focus();
    } else {
      showPanel("overview");
      $("title").focus();
    }
  } else if (!lessons.length) {
    showPanel("lessons");
    $("addLesson").click();
    $("lessonList").querySelector("input")?.focus();
  } else {
    showPanel("materials");
    $("whichLesson").focus();
  }
};
$("saveTop").onclick = save;
$("addLesson").onclick = () => {
  if (lessons.length >= 200) return;
  lessons.push({ title: "", detail: "" });
  activeLesson = lessons.length - 1;
  renderLessons();
  markChanged();
};
$("lessonText").oninput = () => {
  if (lessons[activeLesson]) {
    lessons[activeLesson].detail = $("lessonText").value;
    markChanged();
  }
};
$("importBtn").onclick = () => $("importFile").click();
$("importFile").onchange = async () => {
  const f = $("importFile").files[0];
  $("importFile").value = "";
  if (!f || busy) return;
  if (f.size > 5000000) {
    status("5MB 이하의 파일을 선택하세요.");
    return;
  }
  busy = true;
  controls();
  try {
    const raw = await readDesignFile(f);
    if (f.name.toLowerCase().endsWith(".json")) {
      const obj = JSON.parse(raw);
      if (
        !obj ||
        typeof obj !== "object" ||
        Array.isArray(obj) ||
        typeof obj.title !== "string"
      )
        throw Error("Lesson Studio 프로젝트 JSON이 아닙니다.");
      if (
        dirty &&
        !confirm("현재 저장되지 않은 편집 내용을 버리고 파일을 가져올까요?")
      )
        return;
      clearTimeout(timer);
      clearEditor();
      restoreExtra(obj);
      fields.forEach((k) => ($(k).value = String(obj[k] ?? "")));
      lessons = normalizeLessons(obj.lessons);
      renderLessons();
      markChanged();
      status("가져오기 완료. 새 프로젝트로 저장하세요.");
    } else {
      if (
        $("plan").value &&
        !confirm("기존 설계 내용을 가져온 텍스트로 교체할까요?")
      )
        return;
      $("plan").value = raw;
      markChanged();
      status("설계 텍스트 가져오기 완료");
    }
  } catch (e) {
    status("가져오기 오류: " + e.message);
  } finally {
    busy = false;
    controls();
    if (dirty && fileId) markChanged();
  }
};
fields.forEach((k) => $(k).addEventListener("input", markChanged));
renderLessons();
updateHeading();
window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
controls();
