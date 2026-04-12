import React from 'react'

interface Props {
  content: React.ReactNode
}

export default function ContextRoute({ content }: Props) {
  return <>{content}</>
}
