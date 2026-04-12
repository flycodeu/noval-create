import React from 'react'

interface Props {
  content: React.ReactNode
}

export default function OverviewTab({ content }: Props) {
  return <>{content}</>
}
