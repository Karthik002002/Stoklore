from fastapi import APIRouter
from fastapi import HTTPException

from app.core import db
from app.core import llm

from app.schemas import (
    ScreenerConfigRequest,
    TelegramConfigRequest,
    ActiveBrokerRequest,
    ActiveModelRequest,
    CogencisConfigRequest,
    DhanConfigRequest,
    KiteConfigRequest,
    LiteLLMConfigRequest,
    OmniRouteConfigRequest,
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


@router.get("/api/settings/fallback-model")
def get_fallback_model():
    """The standby model for unattended runs - empty when there is none."""
    return {"model": db.get_fallback_model()}


@router.put("/api/settings/fallback-model")
def set_fallback_model(req: ActiveModelRequest):
    db.set_fallback_model(req.model)
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


@router.get("/api/settings/omniroute")
def get_omniroute_config():
    # never echo the api key back - the UI shows "•••• saved" instead of the real value
    return {
        "base_url": db.get_omniroute_base_url() or "",
        "default_base_url": llm.DEFAULT_OMNIROUTE_BASE,
        "has_api_key": bool(db.get_omniroute_api_key()),
        # What the Model tab will offer for auto-routing, so the tab can say what it enables
        # without a second copy of the list.
        "auto_models": [{"id": i, "label": label} for i, label in llm.AUTO_MODELS],
    }


@router.put("/api/settings/omniroute")
def set_omniroute_config(req: OmniRouteConfigRequest):
    db.set_omniroute_config(req.base_url.rstrip("/"), req.api_key or None)
    llm.configure_omniroute(db.get_omniroute_base_url(), db.get_omniroute_api_key())
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


# --- Telegram: where workflow notifications go when the app is closed ---------------------------------


@router.get("/api/settings/telegram")
def get_telegram_config():
    """The token is never sent back - only whether one is saved."""
    return {
        "has_token": bool(db.get_setting_value("telegram_bot_token")),
        "chat_id": db.get_setting_value("telegram_chat_id") or "",
        "last_error": db.get_setting_value("telegram_last_error") or None,
    }


@router.put("/api/settings/telegram")
def set_telegram_config(req: TelegramConfigRequest):
    if req.bot_token.strip():
        db.set_setting_value("telegram_bot_token", req.bot_token.strip())
    db.set_setting_value("telegram_chat_id", req.chat_id.strip())
    return get_telegram_config()


@router.post("/api/settings/telegram/test")
def test_telegram():
    """Sends one message now, so a wrong chat id shows up here rather than as silence at 9am."""
    from app.services import workflow_notify

    error = workflow_notify.send_telegram("Stoklore: workflow notifications will arrive in this chat.")
    if error:
        raise HTTPException(status_code=400, detail=error)
    return {"ok": True}


# --- screener.in: the user's own session, so unattended screen runs aren't stopped by the wall -------


@router.get("/api/settings/screener")
def get_screener_config():
    """Whether a session cookie is saved - never the cookie itself."""
    return {"has_session": bool(db.get_screener_cookie())}


@router.put("/api/settings/screener")
def set_screener_config(req: ScreenerConfigRequest):
    if req.session_cookie.strip():
        db.set_screener_cookie(req.session_cookie)
    return get_screener_config()


@router.delete("/api/settings/screener")
def clear_screener_config():
    db.set_screener_cookie("")
    return get_screener_config()


@router.post("/api/settings/screener/test")
def test_screener():
    """Opens one public screen with the saved cookie, so a bad or expired one says so here rather
    than as a failed run tomorrow morning."""
    from app.core import scraper

    try:
        screen = scraper.get_screen(
            "https://www.screener.in/screens/86/quarterly-growers/",
            max_pages=1,
            session_cookie=db.get_screener_cookie(),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "name": screen.get("name"), "total": screen.get("total")}
