"""Serveur MCP : un agent (Claude, ChatGPT, Le Chat…) consulte, crée et modifie les candidatures.

Chaque utilisateur a son lien personnel /mcp/<clé>/ : la clé est son uid signé avec MCP_SECRET.
Le lien sert de mot de passe, il ne faut pas le partager.
"""

import hashlib
import hmac
import os
import re
import secrets
from typing import Literal

from fastapi import HTTPException
from fastapi.responses import JSONResponse
from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from fastmcp.server.dependencies import get_http_request

from . import main

SUMMARY_FIELDS = ("id", "type", "company", "jobTitle", "status", "lastStatusChangeAt", "sentAt")
SINGLE_KINDS = main.SECTION_KINDS - {"conversation", "custom"}  # une seule section de ces types par candidature
SECTIONS_DOC = """
Sections are objects with a "kind" and the fields of that kind (all text unless stated):
- offerLink: url, rawText (full text of the job offer)
- keyPoints: contract, salary, workMode, experience, start, responsibilities (list of text),
  requirements (list of text), why (why the user chose this offer)
- company: summary (what the company does), why (why the user chose this company)
- letter: text (cover letter)
- conversation: name, handle (email, phone number, username…), platform (Outlook, LinkedIn, WhatsApp…),
  messages (list of {"date": "YYYY-MM-DD", "text"}); name, handle and platform are required.
  An application can have several conversations. To add a message, send the conversation's id
  with its full messages list.
- contact: name, position, email, phone, extra (list of {"label", "value"})
- custom: title, content
A spontaneous application cannot have offerLink or keyPoints. CV files (kind cv) can only be added in the web app.
"""

mcp = FastMCP("Helper", instructions="Job application tracker of the user. " + SECTIONS_DOC)


def key_for(uid: str) -> str:
    signature = hmac.new(os.environ["MCP_SECRET"].encode(), uid.encode(), hashlib.sha256).hexdigest()
    return f"{uid}.{signature}"


def _is_valid(key: str) -> bool:
    uid = key.rsplit(".", 1)[0]
    return bool(os.getenv("MCP_SECRET")) and hmac.compare_digest(key, key_for(uid))


def _uid() -> str:
    return get_http_request().path_params["key"].rsplit(".", 1)[0]


def _call(fn, *args):
    """Appelle une route de main.py en traduisant ses erreurs HTTP en erreurs d'outil."""
    try:
        return fn(*args)
    except HTTPException as exc:
        raise ToolError(exc.detail) from exc


def _with_ids(sections: list[dict]) -> list[dict]:
    """Donne un id aux nouvelles sections pour pouvoir les modifier ensuite."""
    return [{"id": "m" + secrets.token_hex(4), **s} for s in sections]


@mcp.tool
def list_applications() -> list[dict]:
    """List the user's job applications (without their sections), most recent status change first."""
    applications = main.list_applications(_uid())
    applications.sort(key=lambda a: a.get("lastStatusChangeAt", ""), reverse=True)
    return [{k: a[k] for k in SUMMARY_FIELDS if k in a} for a in applications]


@mcp.tool
def get_application(application_id: str) -> dict:
    """Get one job application with all its sections."""
    return _call(main.get_application, application_id, _uid())


@mcp.tool(description="Create a job application. Status notsent means not sent yet." + SECTIONS_DOC)
def create_application(type: Literal["regular", "spontaneous"], company: str,
                       status: Literal["notsent", "sent", "positive", "refused"],
                       jobTitle: str = "", sections: list[dict] = []) -> dict:
    data = main.ApplicationIn(type=type, company=company, jobTitle=jobTitle, status=status,
                              sections=_with_ids(sections))
    return _call(main.create_application, data, _uid())


@mcp.tool(description="""Modify a job application. Only the given values change.
Each given section is merged into the existing section with the same id (or the same kind, except conversation
and custom);
otherwise it is added. Sections cannot be removed here.""" + SECTIONS_DOC)
def update_application(application_id: str, company: str | None = None, jobTitle: str | None = None,
                       status: Literal["notsent", "sent", "positive", "refused"] | None = None,
                       sections: list[dict] = []) -> dict:
    uid = _uid()
    old = _call(main.get_application, application_id, uid)
    merged = [dict(s) for s in old["sections"]]
    for new in sections:
        match = next((s for s in merged if (new.get("id") and s.get("id") == new["id"])
                      or (new.get("kind") in SINGLE_KINDS and s["kind"] == new["kind"])), None)
        if match:
            match.update(new)
        else:
            merged += _with_ids([new])
    data = main.ApplicationIn(type=old["type"], company=old["company"] if company is None else company,
                              jobTitle=old["jobTitle"] if jobTitle is None else jobTitle,
                              status=status or old["status"], sections=merged)
    return _call(main.update_application, application_id, data, uid)


http_app = mcp.http_app(path="/", stateless_http=True, json_response=True)


async def endpoint(scope, receive, send):
    """Point d'entrée ASGI monté sur /mcp/{key} : refuse les liens dont la clé n'est pas valide."""
    if not _is_valid(scope["path_params"]["key"]):
        return await JSONResponse({"detail": "Invalid MCP link."}, status_code=401)(scope, receive, send)
    await http_app(scope, receive, send)


class TrailingSlash:
    """Accepte /mcp/<clé> sans « / » final. Sinon Starlette redirige, et derrière Cloud Run
    la redirection pointe vers une adresse http:// que les agents (claude.ai…) ne suivent pas."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and re.fullmatch(r"/mcp/[^/]+", scope["path"]):
            scope = {**scope, "path": scope["path"] + "/"}
        await self.app(scope, receive, send)


main.app.router.lifespan_context = http_app.lifespan
main.app.mount("/mcp/{key}", endpoint)
main.app.add_middleware(TrailingSlash)
