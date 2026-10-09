export default function RecoveryMessage({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
    <p>{message}</p>{onRetry && <button type="button" className="btn btn-secondary mt-2" onClick={onRetry}>Try again</button>}
  </div>;
}
