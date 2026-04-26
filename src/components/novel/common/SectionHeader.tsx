import React from 'react'

interface SectionHeaderProps {
  title: string
  description?: React.ReactNode
  eyebrow?: React.ReactNode
  extra?: React.ReactNode
}

export default function SectionHeader({
  title,
  description,
  eyebrow,
  extra,
}: SectionHeaderProps) {
  return (
    <div className="novel-section-header">
      <div className="novel-section-header__copy">
        {eyebrow ? <span className="novel-section-header__eyebrow">{eyebrow}</span> : null}
        <strong className="novel-section-header__title">{title}</strong>
        {description ? (
          <span className="novel-section-header__description">{description}</span>
        ) : null}
      </div>
      {extra ? <div className="novel-section-header__extra">{extra}</div> : null}
    </div>
  )
}
