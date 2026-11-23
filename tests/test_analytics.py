from datetime import datetime, timezone

from app import analytics

from .test_app import _new, client  # noqa: F401  (fixture)


def test_events_are_recorded(client):  # noqa: F811
    _new(client)
    resp = client.post("/api/events", json={"session": "s1", "events": [
        {"event": "$pageview", "props": {"page": "box", "cv_text": "x" * 500, "nested": {"a": 1}}},
        {"event": "Bad Name!"},
    ]})
    assert resp.json() == {"stored": 1}
    names = [e["event"] for e in client.events]
    assert names == ["application_created", "$pageview"]
    page = client.events[-1]
    assert page["uid"] == "u1" and page["session"] == "s1"
    assert page["props"]["cv_text"] == "x" * 120 and "nested" not in page["props"]  # textes tronqués, objets refusés


def test_posthog_forwarding(client, monkeypatch):  # noqa: F811
    sent = []
    monkeypatch.setenv("POSTHOG_API_KEY", "phc_test")
    monkeypatch.setattr(analytics.httpx, "post", lambda url, json, timeout: sent.append((url, json)))
    monkeypatch.setattr(analytics.threading, "Thread", lambda target, daemon: type("T", (), {"start": lambda self: target()})())
    _new(client)
    url, body = sent[0]
    assert url == "https://eu.i.posthog.com/batch/"
    assert body["api_key"] == "phc_test" and body["batch"][0]["distinct_id"] == "u1"


def test_stats_reserved_to_admins(client, monkeypatch):  # noqa: F811
    assert client.get("/api/stats").status_code == 403
    monkeypatch.setenv("ADMIN_EMAILS", "someone@example.com, U1@example.com")
    _new(client)
    data = client.get("/api/stats", params={"days": 7}).json()
    assert data["totals"]["users"] == 1 and data["totals"]["activeToday"] == 1
    assert len(data["daily"]) == 7
    assert client.get("/api/me").json()["admin"] is True


def test_summarize():
    end = datetime(2026, 11, 18, 12, tzinfo=timezone.utc)

    def ev(uid, name, day, **props):
        return {"uid": uid, "event": name, "at": f"2026-11-{day}T10:00:00.000+00:00", "session": f"{uid}-{day}", "props": props}

    events = [
        ev("a", "$pageview", 17, page="box"), ev("a", "application_created", 17), ev("a", "offer_summarized", 17, ok=True, ms=4000),
        ev("a", "reply_analyzed", 18, ok=True, ms=2000), ev("a", "prep_generated", 18, ok=False, ms=9000, error="LLMError"),
        ev("b", "$pageview", 18, page="box"), ev("b", "$pageview", 18, page="offers"), ev("b", "reply_analyzed", 18, ok=True, ms=1000),
        ev("c", "application_created", 10),
    ]
    s = analytics.summarize(events, 7, end)
    assert s["totals"] == {"users": 3, "activeToday": 2, "active7d": 2, "events": 9, "sessions": 4}
    assert s["daily"][-1] == {"day": "2026-11-18", "users": 2, "events": 5}
    # Entonnoir : seuls ceux qui ont franchi chaque étape précédente comptent (b n'a pas créé de
    # candidature) ; la préparation ratée de a ne compte pas.
    assert [f["users"] for f in s["funnel"]] == [2, 1, 1, 1, 0]
    ai = {a["event"]: a for a in s["ai"]}
    assert ai["reply_analyzed"] == {"event": "reply_analyzed", "calls": 2, "errors": 0, "avgMs": 1500}
    assert ai["prep_generated"]["errors"] == 1
    assert s["pages"][0] == {"page": "box", "views": 2}
    assert s["errors"][0]["event"] == "prep_generated"
