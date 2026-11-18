"""Stockage Firestore : candidatures et fichiers PDF.

Les PDF sont découpés en morceaux (un document par morceau) pour rester sous la limite
de 1 Mio par document Firestore, sans passer par Cloud Storage (payant).
"""

import os
from datetime import datetime, timezone
from functools import cache

import google.auth
from google.auth.transport.requests import AuthorizedSession
from google.cloud import firestore

CHUNK_SIZE = 900_000


@cache
def _db() -> firestore.Client:
    return firestore.Client(project=os.getenv("FIREBASE_PROJECT_ID") or None)


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---------- Candidatures ----------

def list_applications(uid: str) -> list[dict]:
    query = _db().collection("applications").where(filter=firestore.FieldFilter("uid", "==", uid))
    return [{**d.to_dict(), "id": d.id} for d in query.stream()]


def get_application(app_id: str) -> dict | None:
    doc = _db().collection("applications").document(app_id).get()
    return {**doc.to_dict(), "id": doc.id} if doc.exists else None


def create_application(data: dict) -> dict:
    ref = _db().collection("applications").document()
    ref.set(data)
    return {**data, "id": ref.id}


def update_application(app_id: str, data: dict) -> dict:
    _db().collection("applications").document(app_id).set(data)
    return {**data, "id": app_id}


def delete_application(app_id: str) -> None:
    _db().collection("applications").document(app_id).delete()


# ---------- Statistiques ----------

def list_application_dates() -> list[str]:
    return [d.get("createdAt") for d in _db().collection("applications").select(["createdAt"]).stream()]


def list_account_dates() -> list[str]:
    """Dates de création des comptes Firebase Auth, via l'API Identity Toolkit."""
    session = AuthorizedSession(google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])[0])
    url = f"https://identitytoolkit.googleapis.com/v1/projects/{os.getenv('FIREBASE_PROJECT_ID')}/accounts:batchGet"
    dates, page = [], ""
    while True:
        response = session.get(url, params={"maxResults": 1000, "nextPageToken": page})
        response.raise_for_status()
        body = response.json()
        dates += [datetime.fromtimestamp(int(u["createdAt"]) / 1000, timezone.utc).isoformat(timespec="seconds")
                  for u in body.get("users", [])]
        page = body.get("nextPageToken")
        if not page:
            return dates


# ---------- Fichiers ----------

def save_file(meta: dict, content: bytes) -> str:
    ref = _db().collection("files").document()
    chunks = [content[i:i + CHUNK_SIZE] for i in range(0, len(content), CHUNK_SIZE)]
    ref.set({**meta, "chunks": len(chunks)})
    for i, chunk in enumerate(chunks):
        ref.collection("chunks").document(str(i)).set({"data": chunk})
    return ref.id


def get_file(file_id: str) -> tuple[dict, bytes] | None:
    ref = _db().collection("files").document(file_id)
    doc = ref.get()
    if not doc.exists:
        return None
    meta = doc.to_dict()
    content = b"".join(ref.collection("chunks").document(str(i)).get().get("data") for i in range(meta["chunks"]))
    return meta, content


def get_file_meta(file_id: str) -> dict | None:
    doc = _db().collection("files").document(file_id).get()
    return doc.to_dict() if doc.exists else None


def delete_file(file_id: str) -> None:
    ref = _db().collection("files").document(file_id)
    for chunk in ref.collection("chunks").stream():
        chunk.reference.delete()
    ref.delete()
