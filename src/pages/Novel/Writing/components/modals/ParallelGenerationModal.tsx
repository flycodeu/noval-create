import { useState } from 'react'
import { Alert, Button, Modal, Tag, message } from 'antd'
import { BranchesOutlined } from '@ant-design/icons'
import { getUserFacingMessage } from '@/utils/user-facing-message'
import type { Chapter, ParallelGenerationPlan } from '../../../../../types'

interface ParallelGenerationModalProps {
  novelId: number
  chapters: Chapter[]
}

/** 多视角并行生成分析 Modal：自带浮动入口按钮，开关 state 内聚在组件内。 */
export default function ParallelGenerationModal({ novelId, chapters: chapterList }: ParallelGenerationModalProps) {
  const [open, setOpen] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [plan, setPlan] = useState<ParallelGenerationPlan | null>(null)

  const handleAnalyze = async () => {
    if (chapterList.length < 2) {
      message.warning(getUserFacingMessage('writing.parallelNeedMoreChapters'))
      return
    }
    setAnalyzing(true)
    try {
      const minNum = Math.min(...chapterList.map((c) => c.chapterNum))
      const maxNum = Math.max(...chapterList.map((c) => c.chapterNum))
      const result = await window.electron.parallel.analyzePlan(novelId, minNum, maxNum)
      setPlan(result)
    } catch (error) {
      message.error(getUserFacingMessage('writing.parallelAnalyzeFailed', {
        detail: error instanceof Error ? error.message : '未知错误',
      }))
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <>
      <div className="writing-layout-floating-entry">
        <Button
          icon={<BranchesOutlined />}
          onClick={() => setOpen(true)}
          shape="circle"
          size="large"
          title="并行生成分析"
        />
      </div>
      <Modal
        title="多视角并行生成分析"
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width={640}
      >
        <div className="writing-layout-parallel-intro">
          <p className="writing-layout-parallel-copy">
            分析故事弧中哪些叙事线可以并行生成。独立叙事线（无共享角色和线索）可以同时生成以加速创作。
          </p>
          <Button
            type="primary"
            icon={<BranchesOutlined />}
            loading={analyzing}
            onClick={() => void handleAnalyze()}
          >
            分析并行可能性
          </Button>
        </div>

        {plan ? (
          <div className="writing-layout-stack writing-layout-stack--lg">
            <div className="writing-layout-parallel-tags">
              <Tag color="blue">预计加速 {plan.estimatedSpeedup}x</Tag>
              <Tag color="green">{plan.parallelGroups.length} 组可并行</Tag>
              <Tag>{plan.sequentialSegments.length} 段需串行</Tag>
            </div>

            {plan.parallelGroups.length > 0 ? (
              <div>
                <div className="writing-layout-parallel-section-title">可并行组</div>
                {plan.parallelGroups.map((group, gi) => (
                  <div key={gi} className="writing-layout-parallel-group">
                    <div className="writing-layout-parallel-group-label">并行组 {gi + 1}</div>
                    {group.map((seg) => (
                      <div key={seg.id} className="writing-layout-row writing-layout-row--wrap">
                        <Tag color="processing">{seg.arcName}</Tag>
                        <span className="writing-layout-parallel-meta">第{seg.chapterRange[0]}-{seg.chapterRange[1]}章</span>
                        <span className="writing-layout-parallel-meta writing-layout-parallel-meta--tiny">
                          {seg.primaryCharacterNames.slice(0, 3).join('、')}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <Alert type="info" message="当前章节范围内未发现可并行的独立叙事线。不同弧共享了相同角色或线索。" />
            )}

            {plan.convergencePoints.length > 0 ? (
              <div>
                <div className="writing-layout-parallel-section-title">汇合点</div>
                <div className="writing-layout-parallel-copy writing-layout-parallel-meta">
                  并行生成完成后需在以下章节做状态合并：
                  {plan.convergencePoints.map((cp) => `第${cp}章`).join('、')}
                </div>
              </div>
            ) : null}

            {plan.sequentialSegments.length > 0 ? (
              <div>
                <div className="writing-layout-parallel-section-title">需串行</div>
                {plan.sequentialSegments.map((seg) => (
                  <div key={seg.id} className="writing-layout-row writing-layout-row--wrap">
                    <Tag>{seg.arcName}</Tag>
                    <span className="writing-layout-parallel-meta">第{seg.chapterRange[0]}-{seg.chapterRange[1]}章</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  )
}
