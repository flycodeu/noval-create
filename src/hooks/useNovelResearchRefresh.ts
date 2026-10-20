import { useEffect } from 'react'
import { subscribeNovelResearchRefresh } from '../services/novel-research-events'

export function useNovelResearchRefresh(novelId: number, enabled = true): void {
  useEffect(() => enabled ? subscribeNovelResearchRefresh(novelId) : undefined, [novelId, enabled])
}
