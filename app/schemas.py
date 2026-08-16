"""Every Pydantic request model in one place.

Kept together rather than per-router because several are genuinely shared - TradeAccountRequest
is used by both the journal and paper-trading routers, and splitting them would have one router
importing another's schemas.
"""
from typing import Literal

from pydantic import BaseModel

from app.core import price_sources

class ChatRequest(BaseModel):
    sessionId: str
    messages: list[dict]
    model: str | None = None


class AddStockRequest(BaseModel):
    symbol: str


class ScrapeRequest(BaseModel):
    url: str


class ActiveModelRequest(BaseModel):
    model: str


class SentimentRequest(BaseModel):
    url: str


class BulkMaxCollectRequest(BaseModel):
    symbols: list[str]
    source: str = price_sources.DEFAULT_SOURCE
    model: str | None = None


class WatchlistRequest(BaseModel):
    list_name: str


class WatchlistListRequest(BaseModel):
    name: str


class RenameWatchlistRequest(BaseModel):
    new_name: str


class ReorderWatchlistsRequest(BaseModel):
    names: list[str]


class LiteLLMConfigRequest(BaseModel):
    base_url: str
    api_key: str | None = None  # None (omitted) leaves the previously-saved key untouched


class CogencisConfigRequest(BaseModel):
    token: str


class WatchRuleRequest(BaseModel):
    name: str
    text: str


class ActiveBrokerRequest(BaseModel):
    broker: str


class DhanConfigRequest(BaseModel):
    client_id: str
    access_token: str


class KiteConfigRequest(BaseModel):
    api_key: str
    api_secret: str


class BacktestRunRequest(BaseModel):
    symbol: str
    short: int = 20
    long: int = 50
    from_date: str | None = None
    to_date: str | None = None


class BacktestSaveRequest(BacktestRunRequest):
    lessons: str | None = None


class BacktestLessonsRequest(BaseModel):
    lessons: str


class AutoBacktestScriptRequest(BaseModel):
    name: str
    script: str


class ManualTradeRequest(BaseModel):
    symbol: str
    direction: str  # "long" | "short"
    quantity: float
    entry_price: float
    exit_price: float | None = None
    stop_loss: float | None = None
    target: float | None = None
    is_open: bool = False
    result: str | None = None  # "profit" | "loss" | "neutral"
    emotion: str | None = None
    tags: list[str] = []
    notes: str | None = None
    traded_at: str | None = None  # ISO datetime; omitted -> now()
    image_filename: str | None = None  # already-uploaded file (e.g. from the Bulk Trades import)
    setup: str | None = None  # freeform strategy/setup label, e.g. "Breakout" - see manual-backtesting plan
    ideal_risk_amount: float | None = None  # planned risk in rupees, for Expected-R / risk-deviation
    account_id: int | None = None  # which trade_accounts row this belongs to; None = unassigned
    # When the position was actually closed. Optional - without it MAE/MFE can't be bounded, so
    # those two metrics are left out of the snapshot rather than guessed at.
    exited_at: str | None = None
    # Which market date the trade refers to, defaulting to traded_at. The two differ for Bar
    # Replay, which journals under real wall-clock time while the trade itself happened in replayed
    # history - without this, a 2022 replay would be scored against today's chart.
    market_at: str | None = None


class TradeAccountRequest(BaseModel):
    name: str
    strategy: str | None = None  # exactly one strategy per account, by design
    strategy_explanation: str | None = None
    opening_balance: float = 0
    max_position_size: float | None = None
    max_position_size_type: Literal["currency", "percentage"] = "currency"
    max_position_count: int | None = None
    # Trading costs, charged per side of a round trip - see db.py's trade_accounts comment and
    # frontend/src/lib/tradeCosts.js. All default to zero, so an account created before these
    # existed (or by a caller that doesn't know about them) simply has no costs.
    slippage_value: float = 0
    slippage_type: Literal["per_share", "bps"] = "per_share"
    brokerage_flat: float = 0
    brokerage_pct: float = 0
    other_charges_pct: float = 0

    def costs(self):
        return {
            "slippage_value": self.slippage_value,
            "slippage_type": self.slippage_type,
            "brokerage_flat": self.brokerage_flat,
            "brokerage_pct": self.brokerage_pct,
            "other_charges_pct": self.other_charges_pct,
        }


class ManualBacktestSettingsRequest(BaseModel):
    setups: list[str] = []
    risk_deviation_tolerance_pct: float = 10
    opening_balance: float = 0


class TradingGoalRequest(BaseModel):
    id: str
    metric: str  # key into the frontend's GOAL_METRICS - unknown keys simply render as unscored
    operator: Literal["gt", "lt"]  # "gt" = a target to reach, "lt" = a limit to stay under
    target: float
    period: Literal["daily", "weekly", "monthly"]
    mode: Literal["continuous", "binary"] = "continuous"
    label: str | None = None


class BalanceAdjustmentRequest(BaseModel):
    amount: float
    type: str  # "add" (deposit) | "subtract" (withdrawal)
    reason: str | None = None
    notes: str | None = None
    adjusted_at: str | None = None  # ISO datetime; omitted -> now()
    account_id: int | None = None  # which account's wallet this moves


class ActivityPingRequest(BaseModel):
    kind: str  # "analyze" | "review"


class ActivitySettingsRequest(BaseModel):
    qualifiers: dict[str, bool]
    daily_goal_minutes: int


class PaperLegRequest(BaseModel):
    id: str
    price: float
    qty: float


class PaperOrderRequest(BaseModel):
    account_id: int
    symbol: str
    direction: str  # "long" | "short"
    order_type: Literal["market", "limit"] = "market"
    quantity: float
    limit_price: float | None = None  # required for a limit order; ignored for a market one
    # Laddered exits: each leg covers part of the quantity, so "50% at target 1, the rest at
    # target 2" is two legs. Same shape Bar Replay uses.
    stop_losses: list[PaperLegRequest] = []
    targets: list[PaperLegRequest] = []
    notes: str | None = None


class PaperModifyRequest(BaseModel):
    stop_losses: list[PaperLegRequest] = []
    targets: list[PaperLegRequest] = []


class PaperCloseRequest(BaseModel):
    quantity: float | None = None  # partial close; omitted = the whole remaining position
