import { get, set, del } from 'idb-keyval'

// Batch 4 Phase D3: minimal IndexedDB-backed queue for hours-log entries
// that fail to POST because the device is offline. Writes are retried the
// next time the app is online and the caller invokes flushQueue().

const QUEUE_KEY = 'bhr:hours-queue:v1'

export type QueuedHoursEntry = {
  id: string // client-generated uuid so we can dedupe
  enqueuedAt: number
  payload: Record<string, unknown>
}

export async function readQueue(): Promise<QueuedHoursEntry[]> {
  try {
    return ((await get(QUEUE_KEY)) as QueuedHoursEntry[] | undefined) ?? []
  } catch {
    return []
  }
}

export async function writeQueue(rows: QueuedHoursEntry[]): Promise<void> {
  if (rows.length === 0) {
    await del(QUEUE_KEY)
    return
  }
  await set(QUEUE_KEY, rows)
}

export async function enqueueHoursEntry(payload: Record<string, unknown>): Promise<QueuedHoursEntry> {
  const queue = await readQueue()
  const entry: QueuedHoursEntry = {
    id: crypto.randomUUID(),
    enqueuedAt: Date.now(),
    payload,
  }
  queue.push(entry)
  await writeQueue(queue)
  return entry
}

export async function removeFromQueue(id: string): Promise<void> {
  const queue = await readQueue()
  await writeQueue(queue.filter((q) => q.id !== id))
}

export async function countPending(): Promise<number> {
  const q = await readQueue()
  return q.length
}
