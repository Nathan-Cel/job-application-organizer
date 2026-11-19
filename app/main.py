"""Helper : centre de suivi des candidatures."""

import asyncio
import csv
import io
import json
import os
from pathlib import Path
from typing import Literal
from urllib.parse import quote

import pypdfium2 as pdfium
from dotenv import load_dotenv
from fastapi import Cookie, Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from pydantic import BaseModel, ValidationError

load_dotenv()

from . import jobs, llm, offer, store, websearch  # noqa: E402  (après load_dotenv)

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
MAX_FILE_BYTES = 10_000_000
SECTION_KINDS = {"offerLink", "keyPoints", "company", "cv", "letter", "conversation", "contact", "custom"}
OFFER_KINDS = {"offerLink", "keyPoints"}
CONVERSATION_REQUIRED = ("name", "handle", "platform")
DATE_KEYS = ("createdAt", "lastStatusChangeAt", "sentAt")
CONTACT_COLUMNS = {"contactName": "name", "contactPosition": "position", "contactEmail": "email", "contactPhone": "phone"}
CSV_COLUMNS = ["company", "jobTitle", "type", "status", "offerUrl", *CONTACT_COLUMNS, "lastStatusChangeAt", "sentAt"]

app = FastAPI(title="Helper")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


class ApplicationIn(BaseModel):
    type: Literal["regular", "spontaneous"]
    company: str
    jobTitle: str = ""
    status: Literal["notsent", "sent", "positive", "refused"]
    sections: list[dict] = []


class OfferRequest(BaseModel):
    url: str = ""
    text: str = ""
    withCompany: bool = False


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


def current_user(session: str = Cookie("", alias="__session")) -> str:
    """Vérifie le jeton Firebase du cookie __session (seul cookie transmis par Firebase Hosting)."""
    try:
        claims = id_token.verify_firebase_token(session, google_requests.Request(),
                                                audience=os.getenv("FIREBASE_PROJECT_ID"))
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Please sign in.") from exc
    return claims["sub"]


# ---------- Candidatures ----------

def _validate(data: ApplicationIn) -> None:
    if not data.company.strip():
        raise HTTPException(status_code=400, detail="Company is required.")
    for section in data.sections:
        kind = section.get("kind")
        if kind not in SECTION_KINDS:
            raise HTTPException(status_code=400, detail=f"Unknown section: {kind}")
        if data.type == "spontaneous" and kind in OFFER_KINDS:
            raise HTTPException(status_code=400, detail="A spontaneous application has no job offer.")
        if kind == "conversation" and not all(str(section.get(k) or "").strip() for k in CONVERSATION_REQUIRED):
            raise HTTPException(status_code=400, detail="A conversation needs a name, a contact and a platform.")


def _upgrade(sections: list[dict]) -> list[dict]:
    """Convertit les anciennes sections « email » en conversations."""
    def convert(s: dict) -> dict:
        text = "\n\n".join(v for v in (s.get("sentAt"), s.get("subject"), s.get("body")) if v)
        return {"id": s.get("id"), "kind": "conversation", "name": "", "handle": s.get("to", ""),
                "platform": "E-mail", "messages": [{"date": "", "text": text}] if text else []}
    return [convert(s) if s.get("kind") == "email" else s for s in sections]


def _new_record(data: ApplicationIn, uid: str, dates: dict | None = None) -> dict:
    now = store.now()
    record = {**data.model_dump(), "uid": uid, "createdAt": now, "lastStatusChangeAt": now}
    if data.status != "notsent":
        record["sentAt"] = now
    return record | (dates or {})


def _file_ids(sections: list[dict]) -> set[str]:
    return {s["file"]["id"] for s in sections if (s.get("file") or {}).get("id")}


def _delete_files(file_ids: set[str], uid: str) -> None:
    for file_id in file_ids:
        if (store.get_file_meta(file_id) or {}).get("uid") == uid:
            store.delete_file(file_id)


@app.get("/api/applications")
def list_applications(uid: str = Depends(current_user)):
    return [{**a, "sections": _upgrade(a["sections"])} for a in store.list_applications(uid)]


@app.get("/api/applications/{app_id}")
def get_application(app_id: str, uid: str = Depends(current_user)):
    application = store.get_application(app_id)
    if application is None or application.get("uid") != uid:
        raise HTTPException(status_code=404, detail="Application not found.")
    return {**application, "sections": _upgrade(application["sections"])}


@app.post("/api/applications", status_code=201)
def create_application(data: ApplicationIn, uid: str = Depends(current_user)):
    _validate(data)
    return store.create_application(_new_record(data, uid))


@app.put("/api/applications/{app_id}")
def update_application(app_id: str, data: ApplicationIn, uid: str = Depends(current_user)):
    _validate(data)
    old = get_application(app_id, uid)
    if data.type != old["type"]:
        raise HTTPException(status_code=400, detail="The type of an application cannot change.")
    record = {k: v for k, v in old.items() if k != "id"} | data.model_dump()
    if data.status != old["status"]:
        record["lastStatusChangeAt"] = store.now()
        if data.status != "notsent" and not old.get("sentAt"):
            record["sentAt"] = record["lastStatusChangeAt"]
    saved = store.update_application(app_id, record)
    _delete_files(_file_ids(old["sections"]) - _file_ids(data.sections), uid)
    return saved


@app.delete("/api/applications/{app_id}", status_code=204)
def delete_application(app_id: str, uid: str = Depends(current_user)):
    application = get_application(app_id, uid)
    _delete_files(_file_ids(application["sections"]), uid)
    store.delete_application(app_id)


# ---------- Import / export ----------

def _csv_row(application: dict) -> dict:
    link = next((s for s in application["sections"] if s["kind"] == "offerLink"), {})
    contact = next((s for s in application["sections"] if s["kind"] == "contact"), {})
    return ({k: application.get(k, "") for k in ("company", "jobTitle", "type", "status", "lastStatusChangeAt", "sentAt")}
            | {"offerUrl": link.get("url", "")}
            | {col: contact.get(key, "") for col, key in CONTACT_COLUMNS.items()})


def _from_csv_row(row: dict) -> dict:
    sections = []
    if row.get("offerUrl"):
        sections.append({"kind": "offerLink", "url": row["offerUrl"]})
    contact = {key: row.get(col, "") for col, key in CONTACT_COLUMNS.items()}
    if any(contact.values()):
        sections.append({"kind": "contact", **contact, "extra": []})
    return {"company": row.get("company", ""), "jobTitle": row.get("jobTitle", ""),
            "type": row.get("type") or "regular", "status": row.get("status") or "notsent", "sections": sections}


def _read_csv(text: str) -> list[dict]:
    """Lit un CSV séparé par des virgules ou des points-virgules (Excel en français)."""
    header = text.split("\n", 1)[0]
    delimiter = ";" if header.count(";") > header.count(",") else ","
    rows = [{k.strip(): (v or "").strip() for k, v in row.items() if isinstance(k, str)}
            for row in csv.DictReader(io.StringIO(text), delimiter=delimiter)]
    return [_from_csv_row(row) for row in rows if any(row.values())]


@app.get("/api/export/{fmt}")
def export_applications(fmt: Literal["csv", "json"], uid: str = Depends(current_user)):
    applications = [{k: v for k, v in a.items() if k not in ("id", "uid")} for a in list_applications(uid)]
    if fmt == "json":
        content = json.dumps(applications, ensure_ascii=False, indent=2)
    else:
        buffer = io.StringIO()
        writer = csv.DictWriter(buffer, CSV_COLUMNS)
        writer.writeheader()
        writer.writerows(_csv_row(a) for a in applications)
        content = "﻿" + buffer.getvalue()  # BOM : Excel lit alors les accents correctement
    media = "application/json" if fmt == "json" else "text/csv"
    return Response(content, media_type=f"{media}; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="applications.{fmt}"'})


@app.post("/api/import/{fmt}")
async def import_applications(fmt: Literal["csv", "json"], request: Request, uid: str = Depends(current_user)):
    raw = await request.body()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("cp1252")  # CSV enregistré par Excel sans l'option UTF-8
    try:
        items = json.loads(text) if fmt == "json" else _read_csv(text)
    except (json.JSONDecodeError, csv.Error) as exc:
        raise HTTPException(status_code=400, detail="This file cannot be read.") from exc
    if not isinstance(items, list):
        raise HTTPException(status_code=400, detail="This file cannot be read.")
    records = []
    for n, item in enumerate(items, 1):
        try:
            data = ApplicationIn.model_validate(item)
            # Les PDF ne font pas partie de l'export : on retire les références aux fichiers.
            data.sections = [{k: v for k, v in s.items() if k != "file"} for s in _upgrade(data.sections)]
            _validate(data)
        except ValidationError as exc:
            error = exc.errors()[0]
            raise HTTPException(status_code=400,
                                detail=f"Entry {n}: {'.'.join(map(str, error['loc']))}: {error['msg']}") from exc
        except HTTPException as exc:
            raise HTTPException(status_code=400, detail=f"Entry {n}: {exc.detail}") from exc
        dates = {k: item[k] for k in DATE_KEYS if fmt == "json" and item.get(k)}
        records.append(_new_record(data, uid, dates))
    for record in records:
        store.create_application(record)
    return {"imported": len(records)}


# ---------- Fichiers PDF ----------

def _read_pdf(content: bytes) -> tuple[int, bytes]:
    """Renvoie le nombre de pages et un aperçu PNG de la première page."""
    try:
        pdf = pdfium.PdfDocument(content)
    except pdfium.PdfiumError as exc:
        raise HTTPException(status_code=400, detail="This file is not a valid PDF.") from exc
    page = pdf[0]
    image = page.render(scale=224 / page.get_width()).to_pil()
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return len(pdf), buffer.getvalue()


@app.post("/api/files", status_code=201)
async def upload_file(request: Request, name: str, uid: str = Depends(current_user)):
    content = await request.body()
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="The file is larger than 10 MB.")
    pages, preview = _read_pdf(content)
    meta = {"name": name, "pages": pages, "addedAt": store.now()}
    file_id = store.save_file({**meta, "uid": uid, "preview": preview}, content)
    return {**meta, "id": file_id}


@app.get("/api/files/{file_id}")
def download_file(file_id: str, download: bool = False, uid: str = Depends(current_user)):
    found = store.get_file(file_id)
    if found is None or found[0].get("uid") != uid:
        raise HTTPException(status_code=404, detail="File not found.")
    meta, content = found
    disposition = "attachment" if download else "inline"
    return Response(content, media_type="application/pdf",
                    headers={"Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(meta['name'])}"})


@app.get("/api/files/{file_id}/preview")
def file_preview(file_id: str, uid: str = Depends(current_user)):
    meta = store.get_file_meta(file_id)
    if meta is None or meta.get("uid") != uid:
        raise HTTPException(status_code=404, detail="File not found.")
    return Response(meta["preview"], media_type="image/png")


# ---------- Offres ----------

@app.post("/api/offer/summary", dependencies=[Depends(current_user)])
async def summarize_offer(req: OfferRequest):
    if not req.url.strip() and not req.text.strip():
        raise HTTPException(status_code=400, detail="Give a link or paste the offer text.")
    try:
        return await offer.summarize(req.url, req.text, req.withCompany)
    except websearch.WebSearchError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except llm.LLMError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/api/jobs", dependencies=[Depends(current_user)])
async def search_jobs(q: str = "", location: str = "", department: str = "", kind: str = "emploi"):
    if kind not in jobs.KINDS:
        raise HTTPException(status_code=400, detail="Unknown contract type.")
    result = {
        "offers": [], "error": None,
        "web": [], "web_error": None,
        "links": jobs.external_links(q, location, kind),
    }

    async def from_france_travail():
        if jobs.is_configured():
            try:
                result["offers"] = await jobs.search(q, department, kind)
            except Exception as exc:  # l'appli reste utilisable via le web et les liens
                result["error"] = str(exc)

    async def from_web():
        if q.strip():
            try:
                result["web"] = await websearch.search_jobs(q, location, kind)
            except Exception as exc:
                result["web_error"] = str(exc)

    await asyncio.gather(from_france_travail(), from_web())
    return result
