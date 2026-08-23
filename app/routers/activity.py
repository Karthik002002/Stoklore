from fastapi import APIRouter
from datetime import date, timedelta

from fastapi import HTTPException

from app.core import db

from app.schemas import ActivityPingRequest, ActivitySettingsRequest, ActivityTimeRequest

router = APIRouter(tags=["activity"])

# --- Consistency/streak tracking (Profile modal) -----------------------------------------------
# Self-directed accountability nudge: tracks daily usage time + which "qualifying" actions (trade
# logged / backtest run / watchlist-events reviewed) happened each day, purely to compute a
# streak and surface it back to the same user - nothing here is sent anywhere else.

ACTIVITY_DAYS_WINDOW = 371
# A day cannot receive more than 24h of usage however enthusiastic the client is - a backstop
# against a broken clock or a doctored payload, not against normal use.
MAX_DAY_SECONDS = 86_400
# How far back a sync may credit. The browser only carries a couple of weeks of backlog
# (activityTime.KEEP_DAYS); anything older is a clock problem, not a late delivery.
MAX_BACKLOG_DAYS = 30


@router.post("/api/activity/time")
def add_activity_time(req: ActivityTimeRequest):
    """Occasional catch-up from the browser's own ledger - NOT a heartbeat.

    Time is counted in localStorage now (frontend/src/lib/activityTime.js). This used to be a
    WebSocket taking ~20s ticks, which meant the day's total only existed if that socket was up:
    when it wasn't, the ticks went nowhere and the retry loop reconnected every 5s forever, so the
    Profile modal showed 0s for a day that had actually been worked. The client now sends whatever
    the server hasn't been told yet, tagged with the LOCAL day it was spent on, and simply keeps
    the backlog if this call fails.

    Dates are the client's local calendar days on purpose: CURRENT_DATE here is the database
    server's, which splits an evening session across two rows whenever the two disagree.
    """
    today = date.today()
    oldest = today - timedelta(days=MAX_BACKLOG_DAYS)
    for entry in req.days:
        try:
            day = date.fromisoformat(entry.date)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"bad date: {entry.date}") from None
        # A future date is a wrong clock, not a prediction - dropped rather than written where no
        # amount of later usage could correct it.
        if day > today or day < oldest or entry.seconds <= 0:
            continue
        db.add_activity_seconds(min(int(entry.seconds), MAX_DAY_SECONDS), day)
    return {"ok": True}


@router.post("/api/activity/ping")
def activity_ping(req: ActivityPingRequest):
    if req.kind not in ("analyze", "review"):
        raise HTTPException(status_code=422, detail="kind must be 'analyze' or 'review'")
    db.ping_activity("analyzed" if req.kind == "analyze" else "reviewed")
    return {"ok": True}


@router.get("/api/activity/summary")
def activity_summary():
    qualifiers = db.get_activity_qualifiers()
    activity_by_date = {r["date"]: r for r in db.list_activity_days(ACTIVITY_DAYS_WINDOW)}
    traded = db.traded_dates(ACTIVITY_DAYS_WINDOW) if qualifiers.get("trade") else set()

    today = date.today()
    start = today - timedelta(days=ACTIVITY_DAYS_WINDOW - 1)

    days = []
    d = start
    while d <= today:
        row = activity_by_date.get(d)
        qualifies = (
            (qualifiers.get("trade") and d in traded)
            or (qualifiers.get("analyze") and bool(row and row["analyzed"]))
            or (qualifiers.get("review") and bool(row and row["reviewed"]))
        )
        days.append({
            "date": d.isoformat(),
            "seconds_active": row["seconds_active"] if row else 0,
            "qualifies": bool(qualifies),
        })
        d += timedelta(days=1)

    # Current streak counts through today only if today already qualifies - otherwise today is
    # still "pending" (not yet a miss) and the streak is whatever it was through yesterday.
    streak_days = days if days[-1]["qualifies"] else days[:-1]
    current_streak = 0
    for day in reversed(streak_days):
        if not day["qualifies"]:
            break
        current_streak += 1

    best_streak = run = 0
    for day in days:
        run = run + 1 if day["qualifies"] else 0
        best_streak = max(best_streak, run)

    # Full missed days counting back from yesterday (today doesn't count as a miss until it's
    # actually over) - capped since past ~30 the guilt-banner tier is already maxed out anyway.
    # If today already qualifies, the gap is closed right now - no need to keep citing whatever
    # streak was missed before today happened.
    days_missed_in_a_row = 0
    if not days[-1]["qualifies"]:
        for day in reversed(days[:-1]):
            if day["qualifies"] or days_missed_in_a_row >= 30:
                break
            days_missed_in_a_row += 1

    last_7 = days[-7:]
    avg_seconds_7d = round(sum(d["seconds_active"] for d in last_7) / len(last_7)) if last_7 else 0

    today_row = activity_by_date.get(today)
    today_breakdown = {
        "traded": today in traded,
        "analyzed": bool(today_row and today_row["analyzed"]),
        "reviewed": bool(today_row and today_row["reviewed"]),
    }

    return {
        "days": days,
        "today_qualifies": days[-1]["qualifies"],
        "today_breakdown": today_breakdown,
        "current_streak": current_streak,
        "best_streak": best_streak,
        "days_missed_in_a_row": days_missed_in_a_row,
        "avg_seconds_today": days[-1]["seconds_active"],
        "avg_seconds_7d": avg_seconds_7d,
        "daily_goal_minutes": db.get_activity_daily_goal_minutes(),
        "qualifiers": qualifiers,
    }


@router.get("/api/settings/activity")
def get_activity_settings():
    return {
        "qualifiers": db.get_activity_qualifiers(),
        "daily_goal_minutes": db.get_activity_daily_goal_minutes(),
    }


@router.put("/api/settings/activity")
def set_activity_settings(req: ActivitySettingsRequest):
    if not any(req.qualifiers.values()):
        raise HTTPException(status_code=422, detail="at least one qualifying action must stay enabled")
    if req.daily_goal_minutes <= 0:
        raise HTTPException(status_code=422, detail="daily_goal_minutes must be positive")
    db.set_activity_qualifiers(req.qualifiers)
    db.set_activity_daily_goal_minutes(req.daily_goal_minutes)
    return {"ok": True}
