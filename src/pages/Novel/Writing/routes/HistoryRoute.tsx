import React from 'react'

interface Props {
  content: React.ReactNode
}

export default function HistoryRoute({ content }: Props) {
  return <>{content}</>
}
