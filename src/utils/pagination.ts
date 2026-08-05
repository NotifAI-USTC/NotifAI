interface OffsetPageState {
  itemCount: number
  page: number
  pageSize: number
  total: number
}

export function isOffsetPageExhausted({
  itemCount,
  page,
  pageSize,
  total,
}: OffsetPageState): boolean {
  return (page - 1) * pageSize + itemCount >= total
}

export function isOffsetPageInconsistent({
  itemCount,
  page,
  pageSize,
  total,
}: OffsetPageState): boolean {
  const remaining = Math.max(0, total - (page - 1) * pageSize)
  return itemCount !== Math.min(pageSize, remaining)
}
