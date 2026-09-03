import { useCallback, useMemo } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
import type { WritingRouteKey } from './components/InsightPanel'

export function parseWritingRouteId(value: string | null): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function resolveWritingRouteKey(pathname: string): WritingRouteKey {
  const routeKey = pathname.split('/').filter(Boolean)[3]
  return routeKey === 'context' || routeKey === 'review' || routeKey === 'history' ? routeKey : 'editor'
}

export function resolveWritingViewFromPathname(pathname: string): WritingRouteKey {
  return resolveWritingRouteKey(pathname)
}

/** Keeps Writing route parsing and query-param updates from diverging. */
export function useWritingRouteState(novelId: number) {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()

  const routeChapterId = useMemo(() => parseWritingRouteId(searchParams.get('chapterId')), [searchParams])
  const creativeStageId = useMemo(() => parseWritingRouteId(searchParams.get('stageId')), [searchParams])
  const activeWritingRoute = useMemo(() => resolveWritingRouteKey(location.pathname), [location.pathname])
  const navigateToWritingRoute = useCallback((routeKey: WritingRouteKey) => {
    const search = searchParams.toString()
    navigate({
      pathname: buildWorkspaceRoute(novelId, `writing/${routeKey}`),
      search: search ? `?${search}` : '',
    })
  }, [navigate, novelId, searchParams])
  const setCreativeStageId = useCallback((stageId: number | null) => {
    const next = new URLSearchParams(searchParams)
    if (stageId) next.set('stageId', String(stageId))
    else next.delete('stageId')
    setSearchParams(next)
  }, [searchParams, setSearchParams])
  const setRouteChapterId = useCallback((chapterId: number | null) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (chapterId) next.set('chapterId', String(chapterId))
      else next.delete('chapterId')
      return next
    }, { replace: true })
  }, [setSearchParams])

  return { activeWritingRoute, creativeStageId, navigate, navigateToWritingRoute, routeChapterId, setCreativeStageId, setRouteChapterId }
}
