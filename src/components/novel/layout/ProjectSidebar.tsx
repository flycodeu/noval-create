import React, { useEffect, useMemo, useState } from 'react'
import { CaretDownFilled, CaretRightFilled, ThunderboltOutlined } from '@ant-design/icons'
import type { WorkspaceNavGroup } from '../../../shared/workspace-types'
import { type WorkspaceViewMode, getWorkspaceModeOptions } from '../../../shared/novel-workspace'
import StatusTag from '../common/StatusTag'

interface ProjectSidebarProps {
  title: string
  stageLabel: string
  progressText: string
  currentTask: string
  navGroups: WorkspaceNavGroup[]
  activeKey: string
  mode: WorkspaceViewMode
  onModeChange: (mode: WorkspaceViewMode) => void
  onNavigate: (route: string) => void
}

export default function ProjectSidebar({
  title,
  stageLabel,
  progressText,
  currentTask,
  navGroups,
  activeKey,
  mode,
  onModeChange,
  onNavigate,
}: ProjectSidebarProps) {
  const modeOptions = getWorkspaceModeOptions()
  const activeGroup = useMemo(
    () => navGroups.find((group) => group.items.some((item) => item.key === activeKey))?.key || navGroups[0]?.key,
    [activeKey, navGroups],
  )
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!activeGroup) return
    setOpenGroups((current) => ({ ...current, [activeGroup]: true }))
  }, [activeGroup])

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateRows: 'auto auto minmax(0, 1fr)',
        gap: 16,
        height: '100%',
        padding: 16,
      }}
    >
      <div
        style={{
          display: 'grid',
          gap: 12,
          padding: 16,
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-light)',
          background: '#fff',
        }}
      >
        <div style={{ display: 'grid', gap: 6 }}>
          <strong style={{ fontSize: 18, lineHeight: 1.35, color: 'var(--text-main)' }}>{title}</strong>
          <span style={{ fontSize: 12, color: 'var(--text-sub)' }}>{`当前阶段：${stageLabel}`}</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{`模块完成：${progressText}`}</span>
        </div>
        <div
          style={{
            display: 'grid',
            gap: 8,
            padding: 12,
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-soft)',
            border: '1px solid rgba(166, 106, 43, 0.16)',
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)' }}>当前主任务</span>
          <strong style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-main)' }}>{currentTask}</strong>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gap: 8,
          padding: 12,
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border-light)',
          background: '#fff',
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          工作模式
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {modeOptions.map((option) => {
            const active = mode === option.value

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onModeChange(option.value)}
                style={{
                  display: 'grid',
                  gap: 4,
                  padding: '10px 12px',
                  textAlign: 'left',
                  borderRadius: 'var(--radius-sm)',
                  border: `1px solid ${active ? 'rgba(166, 106, 43, 0.32)' : 'var(--border-light)'}`,
                  background: active ? 'var(--primary-soft)' : '#fff',
                  cursor: 'pointer',
                }}
              >
                <strong style={{ fontSize: 13, color: active ? 'var(--primary)' : 'var(--text-main)' }}>{option.label}</strong>
                <span style={{ fontSize: 11, lineHeight: 1.6, color: 'var(--text-muted)' }}>{option.description}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10, minHeight: 0, overflowY: 'auto', paddingRight: 4 }}>
        {navGroups.map((group) => {
          const isOpen = openGroups[group.key] ?? group.key === activeGroup
          const canCollapse = group.items.length > 0

          return (
            <section
              key={group.key}
              style={{
                display: 'grid',
                gap: 10,
                padding: 12,
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-light)',
                background: '#fff',
              }}
            >
              <button
                type="button"
                onClick={() => canCollapse && setOpenGroups((current) => ({ ...current, [group.key]: !isOpen }))}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  border: 'none',
                  background: 'transparent',
                  padding: 0,
                  cursor: canCollapse ? 'pointer' : 'default',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {canCollapse ? (isOpen ? <CaretDownFilled /> : <CaretRightFilled />) : <ThunderboltOutlined />}
                  <strong style={{ fontSize: 13, color: 'var(--text-main)' }}>{group.title}</strong>
                </div>
                {group.progress ? (
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>
                    {`${group.progress.done}/${group.progress.total}`}
                  </span>
                ) : null}
              </button>

              {isOpen ? (
                <div style={{ display: 'grid', gap: 6 }}>
                  {group.items.map((item) => {
                    const active = item.key === activeKey

                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => onNavigate(item.route)}
                        style={{
                          display: 'grid',
                          gap: 6,
                          padding: '10px 12px',
                          borderRadius: 'var(--radius-sm)',
                          border: `1px solid ${active ? 'rgba(166, 106, 43, 0.28)' : 'var(--border-light)'}`,
                          background: active ? 'var(--primary-soft)' : '#fff',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)' }}>{item.label}</span>
                          <StatusTag status={item.status} size="small" />
                        </div>
                        {item.meta ? (
                          <span style={{ fontSize: 11, lineHeight: 1.5, color: item.hasBlocker ? 'var(--danger)' : 'var(--text-muted)' }}>
                            {item.meta}
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </section>
          )
        })}
      </div>
    </div>
  )
}
