type SnapshotWithTimestamp = {
  timestamp?: string | Date;
};

function toTimestampMs(snapshot: SnapshotWithTimestamp | null): number {
  if (!snapshot?.timestamp) {
    return Number.NEGATIVE_INFINITY;
  }

  const ms = new Date(snapshot.timestamp).getTime();
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

export function pickLatestSnapshot<T extends SnapshotWithTimestamp>(
  primary: T | null,
  fallback: T | null,
): T | null {
  if (!primary) {
    return fallback;
  }

  if (!fallback) {
    return primary;
  }

  return toTimestampMs(primary) >= toTimestampMs(fallback) ? primary : fallback;
}
