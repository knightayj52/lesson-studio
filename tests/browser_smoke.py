"""Exercise the normal workspace using isolated OAuth, Sheets and Drive fixtures."""
import os
import re
import json
import tempfile
import threading
from contextlib import ExitStack
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from zipfile import ZipFile
from io import BytesIO

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
server = ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=ROOT))
threading.Thread(target=server.serve_forever, daemon=True).start()
project = {}
uploads = []
rows = [["학년군", "교과", "성취기준 코드", "성취기준", "성취수준 A"], ["가상", "통합", "[가상01-01]", "가상 원문", "가상의 수준 진술"]]


def drive(route):
    url = route.request.url
    if "fields=id,name" in url:
        body = route.request.post_data_buffer
        assert b'lessonStudioMaterial' in body and b'"project":"p1"' in body and b'PK' in body
        uploads.append(True)
        result = {"id": "material", "name": "package.zip"}
    elif "/upload/" in url:
        project.update(json.loads(route.request.post_data.split("Content-Type: application/json\r\n\r\n")[1].split("\r\n--")[0]))
        result = {"id": "p1", "version": "1"}
    elif "lessonStudioRoot" in url:
        result = {"files": [{"id": "root"}]}
    elif "/p1?" in url:
        result = project if "alt=media" in url else {"version": "1"}
    else:
        result = {"files": []}
    route.fulfill(json=result)


with ExitStack() as stack:
    stack.callback(server.shutdown)
    pw = stack.enter_context(sync_playwright())
    browser = pw.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH"), args=["--no-sandbox"])
    page = browser.new_page(accept_downloads=True)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("dialog", lambda d: d.accept())
    page.route("https://accounts.google.com/**", lambda r: r.fulfill(content_type="application/javascript", body="""
    window.google={accounts:{oauth2:{initTokenClient:({callback})=>({requestAccessToken:()=>callback({access_token:'fixture'})}),revoke:()=>{}}}};
    """))
    page.route("https://www.googleapis.com/**", drive)
    page.route("https://sheets.googleapis.com/**", lambda r: r.fulfill(json={"valueRanges":[{"values":rows},{"values":[["전략명"]]},{"values":[["교과서단원"]]}]}))
    page.goto(os.environ.get("LESSON_STUDIO_URL") or "http://127.0.0.1:"+str(server.server_port))
    assert page.locator("header button:visible").count() == 0
    page.click("#heroLogin")
    for i,topic in enumerate(["그늘", "변화율", "통근"]):
        page.click("[data-panel=overview]")
        page.get_by_text("학교급별 수업 예시 열기",exact=True).evaluate("s=>s.parentElement.open=true")
        page.locator("button[onclick='useExample("+str(i)+")']").click()
        assert topic in page.locator("#preview").inner_text()
        if i == 0:
            draft = page.evaluate("designFor(lessons[selectedLesson])")
            def gemini(route):
                assert route.request.headers["x-goog-api-key"] == "fixture-key"
                if route.request.method == "POST":
                    assert route.request.url.endswith("/models/gemini-3-flash:generateContent")
                    route.fulfill(json={"candidates": [{"content": {"parts": [{"text": json.dumps(draft)}]}}]})
                else:
                    route.fulfill(json={"models": [
                        {"name": "models/" + m, "supportedGenerationMethods": ["generateContent"]}
                        for m in ["gemini-2-flash", "gemini-3-flash", "gemini-3-image", "gemma-3"]
                    ]})
            page.route("https://generativelanguage.googleapis.com/**", gemini)
            page.fill("#aiKey", "fixture-key")
            page.click("#models")
            page.wait_for_selector("#suggest:enabled")
            assert page.locator("#model option").count() == 2
            assert page.input_value("#model") == "models/gemini-3-flash"
            page.click("#suggest")
            page.get_by_text("검토한 초안 적용", exact=True).click()
            page.fill("#aiKey", "")
            assert page.locator("#suggest").is_disabled()
        for k in range(6):
            page.click(f'#kinds button[data-kind="{k}"]')
            assert "1차시 · 활동 4" in page.locator("#preview").inner_text()
        page.click("[data-panel=lessons]")
        page.click("#copyLesson")
        page.get_by_label("2차시 제목").fill("후속 탐구")
        page.click("#openLesson")
        page.get_by_label("학습목표", exact=True).fill("새 사례에 적용해 설명한다.")
        # Download while lesson 2 is selected, preserving the active editor.
        with page.expect_download(timeout=90000) as unit:
            page.click('[data-out="unit"]')
        with ZipFile(unit.value.path()) as archive:
            names = [n for n in archive.namelist() if not n.endswith("/")]
            assert len(names) == 13
            with ZipFile(BytesIO(archive.read("단원 안내.docx"))) as guide:
                contents = guide.read("word/document.xml").decode()
                assert topic in contents and "후속 탐구" in contents
            for number in [1, 2]:
                path = f"{number:03}차시/교사용/교수학습 과정안.docx"
                with ZipFile(BytesIO(archive.read(path))) as doc:
                    contents = doc.read("word/document.xml").decode()
                    assert f"{number}차시 · 활동 4" in contents
                    assert ("새 사례에 적용해 설명한다." in contents) == (number == 2)
        assert page.locator("#whichLesson").input_value() == "1"
    page.get_by_label("학습목표", exact=True).fill("")
    page.select_option("#whichLesson", "0")
    page.click('[data-out="unit"]')
    page.get_by_text(re.compile("2차시 · 목표·질문")).wait_for()
    page.click("[data-panel=overview]")
    page.fill("#plan", "설계서에 연결된 기준 [가상01-01]")
    page.click("[data-panel=curriculum]")
    page.click("#syncSheet")
    page.locator("#matchedStandards button").click()
    rows[1][3] = "갱신한 원문"
    page.click("#syncSheet")
    page.get_by_text(re.compile("원문 변경됨")).first.wait_for()
    assert page.evaluate("sources[0].record['성취기준']") == "가상 원문"
    rows.pop()
    page.click("#syncSheet")
    page.get_by_text(re.compile("원본에서 삭제됨")).first.wait_for()
    page.click("[data-panel=materials]")
    page.get_by_text("이 차시에 적용할 성취기준", exact=True).click()
    page.locator("#designer fieldset input").nth(1).check()
    page.click('#kinds button[data-kind="5"]')
    mapping = page.locator("#preview .sheet-card").last.inner_text()
    assert "1차시 · 활동 2" in mapping and "가상의 수준 진술" in mapping and "1차시 · 활동 3" not in mapping
    page.check("#archive")
    with page.expect_download(timeout=90000) as dl:
        page.click('[data-out="zip"]')
    page.wait_for_function("document.querySelector('#outputStatus').textContent.includes('보관 완료')")
    assert project["title"] and uploads == [True]
    assert list(project["lessons"][0]["evidenceLinks"].values()) == [[1]]
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp)/"package.zip"
        dl.value.save_as(path)
        with ZipFile(path) as package:
            names = [n for n in package.namelist() if not n.endswith("/")]
            assert sorted(Path(n).suffix for n in names) == [".docx",".docx",".pdf",".png",".png",".pptx"]
            for name in names:
                raw = package.read(name)
                if name.endswith(".pptx"):
                    with ZipFile(BytesIO(raw)) as slides:
                        assert "ppt/notesSlides/notesSlide2.xml" in slides.namelist()
                elif name.endswith(".docx"):
                    with ZipFile(BytesIO(raw)) as doc:
                        xml = doc.read("word/document.xml").decode()
                        assert "1차시 · 활동 4" in xml
                        if "평가" in name:
                            assert "가상의 수준 진술" in xml and "1차시 · 활동 2 ·" in xml.split("원본 성취수준")[-1]
                elif name.endswith(".pdf"):
                    assert raw.startswith(b"%PDF")
                else:
                    assert raw.startswith(b"\x89PNG")
    assert not errors, errors
    print("Three schools, six resources, curriculum changes, ZIP and first Drive save passed.")
