"""Release-only installed Firefox smoke for the temporary WXT XPI."""

from __future__ import annotations

import json
import re
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait


ADDON_ID = "media-bulk-downloads@mralaminahamed"
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c6360f8cfc0000004010100c9fe92ef0000000049454e44ae426082"
)


class Fixture(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 - stdlib callback name
        if self.path == "/media.png":
            self.send_response(200)
            self.send_header("content-type", "image/png")
            self.send_header("content-length", str(len(PNG)))
            self.end_headers()
            self.wfile.write(PNG)
            return
        body = b'<!doctype html><title>Firefox fixture</title><img src="/media.png" alt="fixture">'
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format: str, *_args: object) -> None:
        return


def extension_uuid(profile: Path) -> str:
    prefs = profile / "prefs.js"
    deadline = time.time() + 15
    while time.time() < deadline:
        text = prefs.read_text(encoding="utf-8", errors="ignore") if prefs.exists() else ""
        match = re.search(r'user_pref\("extensions\.webextensions\.uuids", "(.*)"\);', text)
        if match:
            encoded = json.loads(f'"{match.group(1)}"')
            mapping = json.loads(encoded)
            if ADDON_ID in mapping:
                return mapping[ADDON_ID]
        time.sleep(0.2)
    raise RuntimeError("Firefox did not expose the installed extension UUID")


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: firefox-installed-smoke.py path/to/firefox.xpi")
    xpi = Path(sys.argv[1]).resolve(strict=True)
    with tempfile.TemporaryDirectory(prefix="mbd-firefox-downloads-") as download_dir:
        options = webdriver.FirefoxOptions()
        options.add_argument("-headless")
        options.set_preference("browser.download.folderList", 2)
        options.set_preference("browser.download.dir", download_dir)
        options.set_preference("browser.download.useDownloadDir", True)
        options.set_preference("browser.helperApps.neverAsk.saveToDisk", "image/png,application/octet-stream")
        driver = webdriver.Firefox(options=options)
        server = ThreadingHTTPServer(("127.0.0.1", 0), Fixture)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            driver.install_addon(str(xpi), temporary=True)
            profile = Path(driver.capabilities["moz:profile"])
            uuid = extension_uuid(profile)

            driver.get(f"http://127.0.0.1:{server.server_port}/")
            ActionChains(driver).key_down(Keys.CONTROL).key_down(Keys.SHIFT).send_keys("y").key_up(Keys.SHIFT).key_up(Keys.CONTROL).perform()
            WebDriverWait(driver, 20).until(lambda _driver: any(Path(download_dir).iterdir()))

            driver.get(f"moz-extension://{uuid}/popup.html")
            WebDriverWait(driver, 15).until(lambda d: "Media Bulk Downloads" in d.find_element(By.TAG_NAME, "body").text)
            driver.find_element(By.CSS_SELECTOR, 'button[title="Settings"]').click()
            WebDriverWait(driver, 10).until(lambda d: d.find_element(By.CSS_SELECTOR, '[role="dialog"]'))
            driver.find_element(By.XPATH, '//button[@role="tab" and normalize-space()="Privacy"]').click()
            WebDriverWait(driver, 10).until(lambda d: "Automatic media-count scanning" in d.find_element(By.TAG_NAME, "body").text)
            print(json.dumps({
                "installed": True,
                "runtime_uuid_resolved": True,
                "collection_queue_download": True,
                "settings_privacy_smoke": True,
            }))
        finally:
            server.shutdown()
            driver.quit()


if __name__ == "__main__":
    main()
