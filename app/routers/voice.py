"""Voice capture: WAV in, text out. The audio is transcribed locally (app/core/speech.py) and
never stored - the bytes live only for the length of the request."""
from fastapi import APIRouter, File, HTTPException, UploadFile

from app.core import speech

router = APIRouter(tags=["voice"])

#: A minute of 16kHz mono 16-bit WAV is ~1.9MB; this is the hard stop on a stuck key.
MAX_BYTES = 4 * 1024 * 1024


@router.get("/api/voice/status")
def voice_status():
    return {"model": speech.MODEL_ID, "loaded": speech.loaded()}


@router.post("/api/voice/transcribe")
async def transcribe(file: UploadFile = File(...)):
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="recording too long")
    try:
        return {"text": speech.transcribe(data)}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:  # model download/load failure - say so instead of a bare 500
        raise HTTPException(status_code=503, detail=f"speech model unavailable: {e}") from e
