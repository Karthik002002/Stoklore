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
    # When the position was actually opened and closed. Both optional; `entried_at` defaults to
    # traded_at (for a hand-logged trade they are the same moment), and without `exited_at` MAE/MFE
    # can't be bounded, so those two metrics are left out of the snapshot rather than guessed at.
    entried_at: str | None = None
    exited_at: str | None = None


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
    # Volume-spike scan for trades filed under this account - see trade_context.volume_spike. A bar
    # trading at least `multiple` times its own 20-bar average volume, anywhere in the
    # `lookback` bars before entry, counts as a spike.
    vol_spike_multiple: float = 2
    vol_spike_lookback: int = 10
    # Losing trades in a row before Bar Replay interrupts with a reminder. None = off.
    loss_streak_alert: int | None = None

    def settings(self):
        """Cost + volume-spike fields as one dict - everything on the account that is a stored
        setting rather than an identity field."""
        return {
            "slippage_value": self.slippage_value,
            "slippage_type": self.slippage_type,
            "brokerage_flat": self.brokerage_flat,
            "brokerage_pct": self.brokerage_pct,
            "other_charges_pct": self.other_charges_pct,
            "vol_spike_multiple": self.vol_spike_multiple,
            "vol_spike_lookback": self.vol_spike_lookback,
            "loss_streak_alert": self.loss_streak_alert,
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


class ActivityDay(BaseModel):
    date: str  # "YYYY-MM-DD", the CLIENT's local calendar day - see routers/activity.py
    seconds: int


class ActivityTimeRequest(BaseModel):
    days: list[ActivityDay] = []


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


class LiveOrderRequest(BaseModel):
    """One real order. `stop_price`/`target_price` turn it into a Dhan Super Order, which is the
    shape worth wanting: the exits then live at the broker instead of in this app's poller."""
    symbol: str
    direction: str  # "long" | "short"
    quantity: int
    limit_price: float | None = None  # omitted = market order
    stop_price: float | None = None
    target_price: float | None = None
    trailing_jump: float | None = None
    product: Literal["INTRADAY", "CNC", "MARGIN", "MTF"] | None = None
    # What the UI showed the user when they pressed the button. Sizing guardrails are checked
    # against this for a market order, so the cap means something before the fill price exists.
    reference_price: float | None = None


class LiveModifyRequest(BaseModel):
    leg: Literal["ENTRY_LEG", "TARGET_LEG", "STOP_LOSS_LEG"]
    price: float | None = None
    quantity: int | None = None
    target_price: float | None = None
    stop_price: float | None = None
    trailing_jump: float | None = None


class LiveSettingsRequest(BaseModel):
    enabled: bool | None = None
    max_order_value: float | None = None
    max_orders_per_day: int | None = None
    daily_loss_limit: float | None = None
    max_position_pct: float | None = None
    product: Literal["INTRADAY", "CNC", "MARGIN", "MTF"] | None = None
    account_id: int | None = None
    api_base_url: str | None = None  # set to Dhan's sandbox while testing; blank = live


#: Kept in step with alerts.CONDITIONS - the module is the authority on what each one means, this
#: is only the door. 'above'/'below' are the two the app shipped with; they map onto
#: greater/less on the way in so old clients and old rows keep working.
AlertCondition = Literal[
    "crossing", "crossing_up", "crossing_down", "greater", "less",
    "entering_channel", "exiting_channel", "inside_channel", "outside_channel",
    "moving_up", "moving_down", "moving_up_pct", "moving_down_pct",
    "above", "below",
]


class AlertRequest(BaseModel):
    symbol: str
    condition: AlertCondition
    #: The level, or the first bound of a channel, or the size of the move for the moving_* ones.
    price: float
    #: The channel's other bound. Required by the four channel conditions, ignored by the rest.
    price2: float | None = None
    note: str | None = None
    trigger_mode: Literal["once", "once_per_day", "every_time"] = "once"
    #: ISO datetime. Omitted means it watches until it fires or is deleted.
    expires_at: str | None = None
    #: Legacy: the old spelling of trigger_mode == 'every_time'.
    recurring: bool = False


class AlertUpdateRequest(BaseModel):
    """Every field optional - this is also how an alert is paused (`active: false`) and resumed."""
    symbol: str | None = None
    condition: AlertCondition | None = None
    price: float | None = None
    price2: float | None = None
    note: str | None = None
    trigger_mode: Literal["once", "once_per_day", "every_time"] | None = None
    expires_at: str | None = None
    active: bool | None = None
