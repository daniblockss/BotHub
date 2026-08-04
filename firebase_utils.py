import os
import time
from typing import Any, Optional

import firebase_admin
from firebase_admin import credentials, db

SERVICE_ACCOUNT_KEY = "serviceAccountKey.json"
FIREBASE_APP = None


def init_firebase(firebase_url: str) -> Optional[firebase_admin.App]:
    global FIREBASE_APP
    if FIREBASE_APP:
        return FIREBASE_APP
    if not firebase_url or not os.path.exists(SERVICE_ACCOUNT_KEY):
        return None

    try:
        cred = credentials.Certificate(SERVICE_ACCOUNT_KEY)
        FIREBASE_APP = firebase_admin.initialize_app(cred, {"databaseURL": firebase_url})
        return FIREBASE_APP
    except Exception:
        return None


def firebase_available() -> bool:
    return FIREBASE_APP is not None


def db_ref(path: str):
    if not firebase_available():
        return None
    return db.reference(path)


def get_value(path: str, default: Any = None) -> Any:
    ref = db_ref(path)
    if not ref:
        return default
    try:
        value = ref.get()
        return value if value is not None else default
    except Exception:
        return default


def set_value(path: str, value: Any) -> bool:
    ref = db_ref(path)
    if not ref:
        return False
    try:
        ref.set(value)
        return True
    except Exception:
        return False


def update_value(path: str, value: Any) -> bool:
    ref = db_ref(path)
    if not ref:
        return False
    try:
        ref.update(value)
        return True
    except Exception:
        return False


def transaction(path: str, update_fn, max_retries: int = 3):
    ref = db_ref(path)
    if not ref:
        return None
    try:
        return ref.transaction(update_fn, max_attempts=max_retries)
    except Exception:
        return None


def timestamp() -> float:
    return time.time()
