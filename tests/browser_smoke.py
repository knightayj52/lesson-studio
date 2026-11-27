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
rows = [["학년군", "교과", "성취기준 코드", "성취기준"], ["초등", "과학", "[가상01]", "가상 원문"]]


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
    page.goto("http://127.0.0.1:"+str(server.server_port))
    page.click("#heroLogin")
    for i,topic in enumerate(["그늘", "변화율", "통근"]):
        page.click("[data-panel=overview]")
        page.get_by_text("학교급별 수업 예시 열기",exact=True).evaluate("s=>s.parentElement.open=true")
        page.locator("button[onclick='useExample("+str(i)+")']").click()
        assert topic in page.locator("#preview").inner_text()
        for k in range(6):
            page.click(f'#kinds button[data-kind="{k}"]')
            assert "L1-A4" in page.locator("#preview").inner_text()
    page.click("[data-panel=curriculum]")
    page.click("#syncSheet")
    page.locator("#hits button").first.click()
    rows[1][3] = "갱신한 원문"
    page.click("#syncSheet")
    page.get_by_text(re.compile("원문 변경됨")).first.wait_for()
    assert page.evaluate("sources[0].record['성취기준']") == "가상 원문"
    rows.pop()
    page.click("#syncSheet")
    page.get_by_text(re.compile("원본에서 삭제됨")).first.wait_for()
    page.click("[data-panel=materials]")
    page.check("#archive")
    with page.expect_download(timeout=90000) as dl:
        page.click('[data-out="zip"]')
    page.wait_for_function("document.querySelector('#outputStatus').textContent.includes('보관 완료')")
    assert project["title"] and uploads == [True]
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
                        assert "L1-A4" in doc.read("word/document.xml").decode()
                elif name.endswith(".pdf"):
                    assert raw.startswith(b"%PDF")
                else:
                    assert raw.startswith(b"\x89PNG")
    assert not errors, errors
    print("Three schools, six resources, curriculum changes, ZIP and first Drive save passed.")
