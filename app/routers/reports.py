from fastapi import APIRouter
import db

router = APIRouter(tags=["reports"])

@router.get("/api/reports")
def reports(limit: int = 20):
    return db.list_recent_items(limit)


@router.delete("/api/reports/{item_id}")
def delete_report(item_id: int):
    db.delete_item(item_id)
    return {"ok": True}
