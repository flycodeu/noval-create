import React, { useEffect, useState } from 'react'
import { Popover } from 'antd'
import type { RuntimeIdentity } from '../../shared/runtime-identity'

export default function RuntimeBanner() {
  const [identity, setIdentity] = useState<RuntimeIdentity | null>(null)
  useEffect(() => {
    let active = true
    void window.electron?.app?.getRuntimeInfo?.().then(value => { if (active) setIdentity(value) }).catch(() => {})
    return () => { active = false }
  }, [])
  if (!identity) return null
  const isTest = identity.environment === 'test'
  return <Popover trigger="click" placement="bottomRight" title={isTest ? '测试副本 · 不会同步正式正文' : '本机正式作品库'} content={
    <div className="runtime-details">
      <span>NovelForge {identity.version} · {identity.source === 'source' ? '源码运行' : '安装版'}</span>
      <dl><dt>程序位置</dt><dd>{identity.executable}</dd><dt>数据位置</dt><dd>{identity.dataDirectory}</dd></dl>
    </div>
  }>
    <button type="button" className={`runtime-badge runtime-badge--${identity.environment}`} aria-label={isTest ? '测试副本：查看运行信息' : '查看版本与数据位置'}>
      <span className="runtime-badge__dot" aria-hidden="true" />
      <span>{isTest ? '测试副本' : `v${identity.version}`}</span>
    </button>
  </Popover>
}
