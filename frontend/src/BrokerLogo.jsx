// Shared between the Holdings page's broker picker and Settings' broker tabs so both stay in
// sync if a broker's label/icon ever changes. Logo files live in frontend/public (dhan.png,
// kite.png), served at the root - no import needed.
const BROKERS = {
  dhan: { label: 'Dhan', icon: '/dhan.png' },
  kite: { label: 'Kite', icon: '/kite.png' },
}

export function BrokerLogo({ broker, className = '' }) {
  const { label, icon } = BROKERS[broker] ?? {}
  if (!icon) return null
  return (
    <img
      src={icon}
      alt=""
      className={`size-4 shrink-0 rounded-[4px] object-contain ${className}`}
      title={label}
    />
  )
}

export function brokerLabel(broker) {
  return BROKERS[broker]?.label ?? broker
}
