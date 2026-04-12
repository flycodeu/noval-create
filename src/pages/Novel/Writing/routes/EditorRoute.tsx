import React from 'react'

interface Props {
  content: React.ReactNode
}

export default function EditorRoute({ content }: Props) {
  return <>{content}</>
}
