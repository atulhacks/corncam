from fastapi.testclient import TestClient

from corncam.api import app

client = TestClient(app, base_url="http://localhost")


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_media_rejects_path_traversal():
    assert client.get("/api/media/..%2F..%2Fetc%2Fpasswd").status_code in {400, 404}
    assert client.get("/api/media/not-a-sha").status_code == 400


def test_detect_rejects_empty_upload():
    r = client.post("/api/detect", files={"file": ("x.png", b"", "image/png")})
    assert r.status_code == 400


def test_forger_refuses_non_synthetic_persona(tmp_path, monkeypatch):
    from corncam import forger

    monkeypatch.setattr(forger, "PERSONAS", tmp_path)
    r = client.post("/api/forger/personas", data={"name": "A real person", "synthetic": "false"})
    assert r.status_code == 400 and "synthetic" in r.json()["detail"].lower()
    r = client.post("/api/forger/personas", data={"name": "Test Persona", "synthetic": "true"})
    assert r.status_code == 200 and r.json()["id"] == "test-persona"
    assert [p["id"] for p in client.get("/api/forger/personas").json()] == ["test-persona"]


def test_forger_ids_are_validated():
    assert client.post("/api/forger/candidates/../x/launder").status_code in {400, 404}
    assert client.get("/api/forger/personas/..%2Fetc/reference").status_code in {400, 404}


def test_ai_failures_are_503_not_500(monkeypatch, tmp_path):
    from corncam import ai

    monkeypatch.setattr(ai, "CACHE", tmp_path)

    def down(*a, **k):
        raise ai.AIError("AI is not configured")

    monkeypatch.setattr(ai, "chat", down)
    r = client.post("/api/ai/explain", json={"verdict": {"signals": []}})
    assert r.status_code == 503 and "not configured" in r.json()["detail"]
    r = client.post("/api/ai/ask", json={"verdict": {"signals": []}, "question": "why?"})
    assert r.status_code == 503


def test_foreign_host_and_cross_site_origin_are_refused():
    assert client.get("/api/health", headers={"host": "evil.example"}).status_code == 403  # DNS rebinding
    r = client.post("/api/forger/candidates/abc/launder", headers={"origin": "https://evil.example"})
    assert r.status_code == 403  # cross-site POST
    ok = client.get("/api/health", headers={"origin": "http://localhost:5173"})
    assert ok.status_code == 200 and ok.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in ok.headers["content-security-policy"]


def test_studio_palette_lists_detectors_and_advisory_forensics():
    tools = {t["name"]: t for t in client.get("/api/studio/tools").json()}
    assert tools["scan_whole_image"]["advisory"] is False and "image" in tools["scan_whole_image"]["media"]
    assert tools["hidden_data"]["advisory"] is True and set(tools["hidden_data"]["media"]) == {"image", "text"}
    assert "finish" not in tools
    assert client.get("/api/studio/artifacts/..%2Fetc.png").status_code == 404


def test_every_studio_node_has_a_category_and_purpose():
    from corncam.investigate import CATEGORIES

    tools = client.get("/api/studio/tools").json()
    assert all(t["category"] in CATEGORIES and t["purpose"] for t in tools)
    kinds = {k: [t["name"] for t in tools if k in t["media"]] for k in ("image", "video", "audio", "text")}
    assert "text_style" in kinds["text"] and "frame_sheet" in kinds["video"] and "audio_spectrogram" in kinds["audio"]


def test_api_json_is_never_cached():
    r = client.get("/api/studio/tools")
    assert r.headers["cache-control"] == "no-store"
