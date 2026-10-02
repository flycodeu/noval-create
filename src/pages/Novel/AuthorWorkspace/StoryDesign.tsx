import React, { useCallback, useEffect, useState } from 'react'
import { Button, Input, Modal, message } from 'antd'
import { ArrowRightOutlined, EditOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useNovelStore } from '../../../stores/novel.store'
import { buildWorkspaceRoute } from '../../../shared/novel-workspace'
import { parseProjectBriefSnapshot } from '../../../shared/project-brief'
import { parseStorySettingsSnapshot } from '../../../shared/story-settings'
import { parseThemeVoiceSnapshot } from '../../../shared/theme-voice'
import type { Chapter } from '../../../types'
import { AuthorPage, EmptyWork, LoadFailure } from './shared'

export default function StoryDesign({ novelId }: { novelId: number }) {
  const novel = useNovelStore((state) => state.currentNovel)
  const setNovel = useNovelStore((state) => state.setCurrentNovel)
  const navigate = useNavigate()
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [background, setBackground] = useState('')
  const [saving, setSaving] = useState(false)
  const brief = parseProjectBriefSnapshot(novel?.projectBriefJson)
  const story = parseStorySettingsSnapshot(novel?.settingsJson)
  const voice = parseThemeVoiceSnapshot(novel?.themeVoiceJson)
  const load = useCallback(() => window.electron.chapter.list(novelId).then(setChapters).catch((cause) => setError(cause instanceof Error ? cause.message : '读取章节安排失败')), [novelId])
  useEffect(() => { void load() }, [load])
  const discuss = (stage: 'background' | 'outline', request: string) => navigate(buildWorkspaceRoute(novelId, `guide?${new URLSearchParams({ stage, request })}`))
  const notes = [
    { title: '读者为什么读下去', text: brief.readerPromise || story.premise.coreHook },
    { title: '主角从哪里出发', text: story.premise.protagonistStart },
    { title: '故事往哪里走', text: story.mainPlot || story.storyGoal },
    { title: '冲突与边界', text: [story.coreConflict, story.premise.constraints, brief.tabooRules].filter(Boolean).join('\n\n') },
    { title: '作品声音', text: [voice.theme, voice.emotionalCore, voice.styleRules, voice.dialogueRules].filter(Boolean).join('\n\n') },
  ].filter((item) => item.text)
  return <AuthorPage eyebrow="故事设计" title={novel?.title || '给故事一个名字'} description={novel?.synopsis || '背景、人物选择与章节推进，在这里形成一条连贯的故事。'}
    actions={<Button onClick={() => discuss('background', '检查当前背景与故事方向，指出不合理、重复、缺漏或与正文冲突之处，并给出具体修订。')}>讨论与优化 <ArrowRightOutlined /></Button>}>
    <section className="author-paper author-background"><div className="author-section-heading"><h2>故事背景</h2><Button type="text" icon={<EditOutlined />} onClick={() => { setBackground(novel?.userBackground || ''); setEditing(true) }}>编辑</Button></div>
      {novel?.userBackground ? <div className="author-prose">{novel.userBackground}</div> : <EmptyWork title="背景还没有确定" action={() => discuss('background', '根据我的故事需求生成背景，说明主角所处环境与主要冲突。')}>从时代、主角处境和第一个冲突开始。</EmptyWork>}
      {novel?.expandedBackground && <details className="author-disclosure"><summary>补充设定</summary><div className="author-prose">{novel.expandedBackground}</div></details>}
    </section>
    {notes.length > 0 && <div className="author-design-notes">{notes.map((item) => <section key={item.title} className="author-design-note"><h2>{item.title}</h2><p>{item.text}</p></section>)}</div>}
    <section className="author-paper"><div className="author-section-heading"><div><span className="author-eyebrow">从目标到场景</span><h2>章节安排</h2></div><Button onClick={() => discuss('outline', '结合现有背景、人物和已写章节，规划紧接前文的下一阶段章节。每章明确行动、变化和承接，避免重做已有章节。')}>继续规划 <ArrowRightOutlined /></Button></div>
      {error && <LoadFailure message={error} retry={() => void load()} />}
      {chapters.length ? <div className="author-chapter-list">{chapters.map((chapter) => <button key={chapter.id} onClick={() => navigate(buildWorkspaceRoute(novelId, `writing/editor?chapterId=${chapter.id}`))}>
        <span className="author-chapter-number">{String(chapter.chapterNum).padStart(2, '0')}</span><div><strong>{chapter.title || '未命名章节'}</strong><p>{chapter.outline || chapter.summary || '本章安排尚未补充。'}</p></div><small>{chapter.wordCount > 0 ? `${chapter.wordCount.toLocaleString()} 字` : '待写'}</small><ArrowRightOutlined />
      </button>)}</div> : <EmptyWork title="从第一个单元开始" action={() => discuss('outline', '根据现有背景和人物，设计首个单元的章节安排，明确每章发生什么以及如何承接。')}>不用一次铺满全书，先安排能够开始写作的一段故事。</EmptyWork>}
    </section>
    <Modal title="编辑故事背景" open={editing} onCancel={() => setEditing(false)} okText="保存背景" cancelText="取消" confirmLoading={saving} onOk={() => {
      setSaving(true)
      void window.electron.novel.update(novelId, { userBackground: background }).then(() => window.electron.novel.get(novelId)).then((updated) => { if (updated) setNovel(updated); setEditing(false); message.success('背景已保存') }).catch((cause) => message.error(cause instanceof Error ? cause.message : '保存失败')).finally(() => setSaving(false))
    }}><Input.TextArea value={background} onChange={(event) => setBackground(event.target.value)} autoSize={{ minRows: 10, maxRows: 22 }} aria-label="故事背景" /></Modal>
  </AuthorPage>
}
