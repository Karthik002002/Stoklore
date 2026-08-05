from fastapi import APIRouter
from fastapi import HTTPException

import db
import llm

from app.schemas import (
    ActiveBrokerRequest,
    ActiveModelRequest,
    CogencisConfigRequest,
    DhanConfigRequest,
    KiteConfigRequest,
    LiteLLMConfigRequest,
)

router = APIRouter(tags=["settings"])

@router.get("/api/models")
def models():
    return llm.get_models()


@router.get("/api/settings/active-model")
def get_active_model():
    return {"model": db.get_active_model()}


@router.put("/api/settings/active-model")
def set_active_model(req: ActiveModelRequest):
    db.set_active_model(req.model)
    return {"model": req.model}


@router.get("/api/settings/litellm")
def get_litellm_config():
    # never echo the api key back - the UI shows "•••• saved" instead of the real value
    return {"base_url": db.get_litellm_base_url(), "has_api_key": bool(db.get_litellm_api_key())}


@router.put("/api/settings/litellm")
def set_litellm_config(req: LiteLLMConfigRequest):
    db.set_litellm_config(req.base_url.rstrip("/"), req.api_key or None)
    llm.configure_litellm(db.get_litellm_base_url(), db.get_litellm_api_key())
    return {"ok": True}


@router.get("/api/settings/cogencis")
def get_cogencis_config():
    # never echo the token back - the UI shows "•••• saved" instead of the real value
    return {"has_token": bool(db.get_cogencis_token())}


@router.put("/api/settings/cogencis")
def set_cogencis_config(req: CogencisConfigRequest):
    db.set_cogencis_token(req.token)
    return {"ok": True}




@router.get("/api/settings/broker")
def get_broker_config():
    return {
        "active_broker": db.get_active_broker(),
        "dhan": {"has_credentials": bool(db.get_dhan_credentials())},
        "kite": {
            "has_credentials": bool(db.get_kite_credentials()),
            "logged_in_today": bool(db.get_kite_session()),
        },
    }


@router.put("/api/settings/broker")
def set_broker_config(req: ActiveBrokerRequest):
    if req.broker not in SUPPORTED_BROKERS:
        raise HTTPException(status_code=422, detail=f"'{req.broker}' isn't supported yet")
    db.set_active_broker(req.broker)
    return {"ok": True}


@router.put("/api/settings/dhan")
def set_dhan_config(req: DhanConfigRequest):
    db.set_dhan_credentials(req.client_id.strip(), req.access_token.strip())
    return {"ok": True}


@router.put("/api/settings/kite")
def set_kite_config(req: KiteConfigRequest):
    db.set_kite_credentials(req.api_key.strip(), req.api_secret.strip())
    return {"ok": True}
