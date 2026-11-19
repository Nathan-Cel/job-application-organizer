import json

import pytest

from app import mcp_server
from tests.test_app import client  # noqa: F401  (fixture : Firestore en mémoire)


@pytest.fixture(autouse=True)
def secret(monkeypatch):
    monkeypatch.setenv("MCP_SECRET", "test-secret")


def _call(client, tool, path=None, **arguments):
    """Appelle un outil MCP comme le ferait un agent ; renvoie (statut HTTP, résultat)."""
    path = path or f"/mcp/{mcp_server.key_for('u1')}/"
    resp = client.post(path, headers={"Accept": "application/json, text/event-stream"},
                       json={"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                             "params": {"name": tool, "arguments": arguments}})
    if resp.status_code != 200:
        return resp.status_code, None
    result = resp.json()["result"]
    return 200, result if result["isError"] else json.loads(result["content"][0]["text"])


def test_link(client):
    assert client.get("/api/mcp/link").json()["path"] == f"/mcp/{mcp_server.key_for('u1')}/"


def test_invalid_link_refused(client):
    assert _call(client, "list_applications", path="/mcp/u1.forged/")[0] == 401


def test_create_list_get(client):
    _, created = _call(client, "create_application", type="regular", company="Halden Labs", status="sent",
                       sections=[{"kind": "keyPoints", "salary": "45k"}])
    assert created["uid"] == "u1" and created["sentAt"] and created["sections"][0]["id"]
    _, listed = _call(client, "list_applications")
    assert listed == [{k: created[k] for k in mcp_server.SUMMARY_FIELDS}]
    _, fetched = _call(client, "get_application", application_id=created["id"])
    assert fetched["sections"][0]["salary"] == "45k"


def test_update_merges(client):
    client.post("/api/applications", json={
        "type": "regular", "company": "Halden Labs", "status": "notsent",
        "sections": [{"id": "s1", "kind": "cv", "file": {"id": "f1"}},
                     {"id": "s2", "kind": "contact", "name": "Maya", "phone": "06"}]})
    _, updated = _call(client, "update_application", application_id="a1", status="sent",
                       sections=[{"kind": "contact", "phone": "07"}, {"kind": "custom", "title": "Notes"}])
    assert updated["status"] == "sent" and updated["company"] == "Halden Labs"
    cv, contact, custom = updated["sections"]
    assert cv["file"] == {"id": "f1"}
    assert contact == {"id": "s2", "kind": "contact", "name": "Maya", "phone": "07"}
    assert custom["title"] == "Notes" and custom["id"]

    conv = {"kind": "conversation", "name": "Maya", "handle": "maya@x.example", "platform": "Outlook", "messages": []}
    _call(client, "update_application", application_id="a1", sections=[conv])
    _, updated = _call(client, "update_application", application_id="a1", sections=[conv | {"platform": "LinkedIn"}])
    assert [s["platform"] for s in updated["sections"] if s["kind"] == "conversation"] == ["Outlook", "LinkedIn"]


def test_errors_reach_agent(client):
    _, result = _call(client, "create_application", type="spontaneous", company="Halden Labs", status="sent",
                      sections=[{"kind": "keyPoints"}])
    assert result["isError"] and "no job offer" in result["content"][0]["text"]
    _, result = _call(client, "get_application", application_id="nope")
    assert result["isError"]
