import React from 'react'
import { Button } from 'antd'
import type { StoryDesignSettings } from '../../../shared/story-settings'
import { ContentDocument } from './ContentDocument'

export function StoryDirectionDocument({ story, onEdit }: { story: StoryDesignSettings; onEdit: () => void }) {
  return <div className="story-direction">
    <div className="story-direction-core">{[['故事目标', story.storyGoal], ['主要冲突', story.coreConflict]].map(([title, value]) => <section key={title}><h3>{title}</h3>{value ? <ContentDocument value={value} /> : <Button type="link" onClick={onEdit}>补充{title}</Button>}</section>)}</div>
    <section className="story-direction-main"><h3>主线推进</h3>{story.mainPlot ? <ContentDocument value={story.mainPlot} /> : <Button type="link" onClick={onEdit}>安排主线</Button>}</section>
    <section><div className="author-section-heading"><h3>支线与人物选择</h3><Button size="small" onClick={onEdit}>编辑支线</Button></div>
      {story.subPlotsList.length ? <div className="story-subplots">{story.subPlotsList.map((subplot, index) => <article key={index}><h4>{subplot.name || `支线 ${index + 1}`}</h4><ContentDocument value={{ characters: subplot.characters, conflict: subplot.conflict, mainlineLink: subplot.mainlineLink, endChapter: subplot.endChapter }} /></article>)}</div> : <p className="author-missing">尚未安排支线</p>}
      {story.subPlotsText && <details className="author-disclosure"><summary>单元安排与补充说明</summary><ContentDocument value={story.subPlotsText} /></details>}
    </section>
    <section><h3>收束方向</h3><ContentDocument value={story.ending} /></section>
  </div>
}
