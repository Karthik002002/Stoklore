from fastapi import APIRouter
from fastapi import HTTPException

from app.core import backup

router = APIRouter(tags=["backup"])

@router.get("/api/backup/status")
def backup_status():
    return backup.status()


@router.post("/api/backup")
def backup_now():
    """Force a dump immediately - worth hitting before anything risky, rather than waiting out the
    interval."""
    try:
        return {"path": backup.run_dump()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
